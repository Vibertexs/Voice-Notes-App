/**
 * The phone's side of cloud sync, against a scripted server.
 *
 * What is checked is the part only the phone can get wrong: that every edit
 * is queued (by the triggers, whatever code path made it), that the queue is
 * turned into documents the server will accept, that the server's documents
 * land in the tables the screens read, and that applying them does not queue
 * them straight back up.
 *
 * sync_e2e.test.mjs runs the same phones against the real server.
 */
import { checker, loadCloudSync, makePhone, recordLecture } from './harness.mjs';

const { check, done } = checker();
const { createCloud, segmentToCloud, segmentFromCloud, toMs } = loadCloudSync();

/** Answers like backend/cloud, scripted. Accepts everything it is sent. */
function fakeServer() {
  const server = {
    pushes: [], replies: [], calls: [], refreshes: 0, googleBodies: [],
    accessValid: true, rejectIds: new Set(), invalidIds: new Set(),
  };
  const json = (status, body) => ({
    ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body,
  });
  const tokens = (n) => ({
    accessToken: `access${n}`, refreshToken: `vfr_refresh${n}`, tokenType: 'bearer', expiresIn: 900,
    user: { id: 'usr_1', email: 'student@example.com', createdAt: '2026-09-01T00:00:00Z', hasPassword: true, appleLinked: false },
  });
  server.fetch = async (url, init) => {
    const path = url.replace('https://cloud.test', '');
    const body = init.body ? JSON.parse(init.body) : null;
    server.calls.push({ path, auth: init.headers.Authorization ?? null, body });
    if (path === '/v1/auth/login' || path === '/v1/auth/register') return json(200, tokens(0));
    if (path === '/v1/auth/google') { server.googleBodies.push(body); return json(200, tokens(0)); }
    if (path === '/v1/auth/refresh') { server.refreshes++; server.accessValid = true; return json(200, tokens(server.refreshes)); }
    if (path === '/v1/auth/logout') return json(204, null);
    if (path === '/v1/sync') {
      if (!server.accessValid) return json(401, { detail: 'Sign in to continue.' });
      const all = Object.values(body.changes).flat();
      if (all.some((doc) => server.invalidIds.has(doc.id))) return json(422, { detail: [{ msg: 'bad' }] });
      server.pushes.push(body);
      const outcome = (kind) => (body.changes[kind] ?? []).map((doc) => doc.id);
      const reply = server.replies.shift() ?? {};
      return json(200, {
        cursor: `c${server.pushes.length}`, more: false, serverTime: new Date().toISOString(),
        applied: Object.fromEntries(['folders', 'recordings', 'transcripts'].map((k) => [k, outcome(k).filter((id) => !server.rejectIds.has(id))])),
        rejected: Object.fromEntries(['folders', 'recordings', 'transcripts'].map((k) => [k, outcome(k).filter((id) => server.rejectIds.has(id))])),
        changes: { folders: [], recordings: [], transcripts: [], ...reply },
      });
    }
    return json(404, { detail: 'no route' });
  };
  return server;
}

function cloudFor(phone, server, extra = {}) {
  let dataEvents = 0;
  const cloud = createCloud({
    openDatabase: phone.api.openDatabase,
    exclusive: phone.api.exclusive,
    fetch: server.fetch,
    apiUrl: 'https://cloud.test/',
    deviceName: 'Test phone',
    audioFile: phone.api.audioFile,
    onData: () => { dataEvents++; },
    ...extra,
  });
  phone.api.ACCOUNT.handler = cloud.handleAccountApi;
  return { cloud, events: () => dataEvents };
}

const outbox = (phone) => phone.sql('SELECT kind, id, op, changed_at FROM sync_outbox ORDER BY kind, id');
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

// ---------------------------------------------------------------------------
console.log('== word timings survive the trip in compact form ==');
const whisper = {
  text: 'Cells divide.', start_seconds: 3.2, end_seconds: 4.9,
  words: [{ start: 3.2, end: 3.6, word: 'Cells' }, { start: 3.7, end: 4.9, word: ' divide.' }],
};
const compact = segmentToCloud(whisper);
check('stored as {w, s, e}', JSON.stringify(compact.words[1]) === JSON.stringify({ w: ' divide.', s: 3.7, e: 4.9 }), compact);
check('round-trips exactly, leading space and all', JSON.stringify(segmentFromCloud(compact)) === JSON.stringify(whisper), segmentFromCloud(compact));
const plain = segmentFromCloud(segmentToCloud({ text: 'Whole sentence.', start_seconds: 0, end_seconds: 2 }));
check('a segment without word timings stays without them', !('words' in plain), plain);
check('bad numbers are clamped, not sent', segmentToCloud({ text: 'x', start_seconds: -4, words: [{ start: 'nan', word: 'x' }] }).start === 0);
check('microsecond timestamps parse', toMs('2026-10-02T06:07:19.149123Z') === Date.parse('2026-10-02T06:07:19.149Z'));

// ---------------------------------------------------------------------------
console.log('\n== every edit is queued, by the database itself ==');
const phone = makePhone();
await phone.api.openDatabase();
let res = await phone.POST('/api/folders', { name: 'Biology', color: 'red' });
const bio = res.body.id;
check('a new folder is queued', outbox(phone).some((e) => e.kind === 'folders' && e.id === bio && e.op === 'upsert'), outbox(phone));
const firstStamp = outbox(phone).find((e) => e.id === bio).changed_at;
await tick();
await phone.PATCH(`/api/folders/${bio}`, { name: 'Bio 101' });
const folderRows = outbox(phone).filter((e) => e.id === bio);
check('editing it again coalesces to one entry', folderRows.length === 1, folderRows);
check('...stamped with the later edit', folderRows[0].changed_at > firstStamp, folderRows);

const lecture = await recordLecture(phone, { title: 'Mitosis', folderId: bio });
check('a recording is queued', outbox(phone).some((e) => e.kind === 'recordings' && e.id === lecture.workspaceId), outbox(phone));
check('its transcript is queued', outbox(phone).some((e) => e.kind === 'transcripts' && e.id === lecture.workspaceId), outbox(phone));
const before = outbox(phone).length;
await phone.api.markTranscriptionProgress(lecture.lectureId, 0.5);
check('progress ticks are not sync-worthy', outbox(phone).length === before);

phone.sql("DELETE FROM sync_outbox");
await phone.POST(`/api/lectures/${lecture.lectureId}/markers`, { label: 'Exam', time_seconds: 12 });
check('a bookmark queues its recording', outbox(phone).some((e) => e.kind === 'recordings' && e.id === lecture.workspaceId), outbox(phone));
phone.sql("DELETE FROM sync_outbox");
await phone.PUT(`/api/workspaces/${lecture.workspaceId}/notes`, { note_body: 'prophase first' });
check('notes queue their recording', outbox(phone).some((e) => e.kind === 'recordings' && e.id === lecture.workspaceId), outbox(phone));

phone.sql("INSERT INTO cloud_state (key, value) VALUES ('applying', '1')");
phone.sql("DELETE FROM sync_outbox");
await phone.PATCH(`/api/folders/${bio}`, { name: 'Applied from server' });
check('nothing is queued while sync applies server changes', outbox(phone).length === 0, outbox(phone));
phone.sql("DELETE FROM cloud_state WHERE key = 'applying'");
await phone.PATCH(`/api/folders/${bio}`, { name: 'Bio 101' });

const doomed = await recordLecture(phone, { title: 'Doomed' });
await phone.DELETE(`/api/workspaces/${doomed.workspaceId}`);
check('deleting queues a delete', outbox(phone).some((e) => e.id === doomed.workspaceId && e.kind === 'recordings' && e.op === 'delete'), outbox(phone));
check('...and a later child-table trigger cannot turn it back into an update',
  (await phone.api.exclusive(async () => {
    phone.sql(`INSERT OR REPLACE INTO sync_outbox (kind, id, op, changed_at) VALUES ('recordings', '${doomed.workspaceId}',
      COALESCE((SELECT op FROM sync_outbox WHERE kind = 'recordings' AND id = '${doomed.workspaceId}' AND op = 'delete'), 'upsert'), '${new Date().toISOString()}')`);
    return outbox(phone).find((e) => e.id === doomed.workspaceId && e.kind === 'recordings').op;
  })) === 'delete');

// ---------------------------------------------------------------------------
console.log('\n== /api/account without a server says so ==');
const bare = makePhone();
await bare.api.openDatabase();
res = await bare.GET('/api/account');
check('no handler installed: 404, which the page reads as "no sync here"', res.status === 404, res);
const unconfigured = createCloud({ openDatabase: bare.api.openDatabase, exclusive: bare.api.exclusive, fetch: () => { throw new Error('no'); }, apiUrl: '' });
bare.api.ACCOUNT.handler = unconfigured.handleAccountApi;
res = await bare.GET('/api/account');
check('handler without a URL reports configured: false', res.status === 200 && res.body.configured === false, res);

// ---------------------------------------------------------------------------
console.log('\n== signing in uploads what is already on the phone ==');
const server = fakeServer();
const { cloud, events } = cloudFor(phone, server);
res = await phone.GET('/api/account');
check('signed out to start with', res.body.signedIn === false && res.body.configured === true, res.body);
res = await phone.POST('/api/account/login', { email: 'student@example.com', password: 'pw' });
check('login answers with the signed-in status', res.status === 200 && res.body.signedIn === true && res.body.user.email === 'student@example.com', res);
await cloud.syncNow();
const pushed = server.pushes.flatMap((p) => Object.entries(p.changes).flatMap(([kind, docs]) => docs.map((d) => ({ kind, ...d }))));
const sentRecording = pushed.find((d) => d.kind === 'recordings' && d.id === lecture.workspaceId);
check('the recording went up', Boolean(sentRecording), pushed.map((d) => d.kind + ':' + d.id));
check('...in its folder', sentRecording?.folderId === bio, sentRecording);
check('...with its bookmark', sentRecording?.markers?.[0]?.label === 'Exam', sentRecording?.markers);
check('...and notes', sentRecording?.notes === 'prophase first', sentRecording?.notes);
check('...describing where the audio is, not the audio', sentRecording?.audio?.fileName?.endsWith('.wav') && !('data' in (sentRecording?.audio ?? {})), sentRecording?.audio);
const sentWords = pushed.find((d) => d.kind === 'transcripts' && d.id === lecture.workspaceId);
check('the transcript went up with compact words', sentWords?.segments?.[0]?.words?.[0]?.w === 'the', sentWords?.segments?.[0]);
check('the delete went up as a tombstone', pushed.some((d) => d.id === doomed.workspaceId && d.deletedAt), pushed.filter((d) => d.id === doomed.workspaceId));
check('the outbox is empty afterwards', outbox(phone).length === 0, outbox(phone));
check('the cursor was saved', phone.sql("SELECT value FROM cloud_state WHERE key = 'cursor'")[0]?.value === `c${server.pushes.length}`);
check('every call carried the access token', server.calls.filter((c) => c.path === '/v1/sync').every((c) => c.auth === 'Bearer access0'));

// ---------------------------------------------------------------------------
console.log('\n== changes from elsewhere land where the screens read them ==');
const later = new Date(Date.now() + 60_000).toISOString();
const remoteId = 'remoteRec1';
server.replies.push({
  // The transcript arrives a page before its recording.
  transcripts: [{ id: remoteId, updatedAt: later, deletedAt: null, text: 'from the other phone', segments: [segmentToCloud(whisper)] }],
});
server.replies.push({
  folders: [{ id: 'remoteFolder', name: 'Chemistry', color: 'violet', icon: null, updatedAt: later, createdAt: later, deletedAt: null, archivedAt: null }],
  recordings: [{
    id: remoteId, title: 'Recorded elsewhere', folderId: 'remoteFolder', favorite: true, createdAt: later, updatedAt: later,
    deletedAt: null, durationSeconds: 1800, transcription: { status: 'ready', model: 'small.en' },
    audio: { fileName: 'x.wav', bytes: 5, deviceId: 'dev_other' },
    markers: [{ id: 'mk1', label: 'Key idea', timeSeconds: 42, createdAt: later }], notes: 'their notes',
  }],
});
await cloud.syncNow();
check('the early transcript waits in the stash', phone.sql('SELECT id FROM cloud_stash').length === 1);
await cloud.syncNow();
check('...and is claimed when its recording arrives', phone.sql('SELECT id FROM cloud_stash').length === 0);
res = await phone.GET('/api/library?folder_id=remoteFolder');
check('the folder and its recording appear', res.body.current_folder?.name === 'Chemistry' && res.body.workspaces[0]?.id === remoteId, res.body);
res = await phone.GET(`/api/workspaces/${remoteId}`);
const session = res.body.sessions?.[0];
check('the playback screen gets the transcript', session?.segments?.[0]?.words?.[1]?.word === ' divide.', session?.segments);
check('...the bookmark', session?.markers?.[0]?.label === 'Key idea', session?.markers);
check('...the notes', res.body.note_body === 'their notes', res.body.note_body);
check('...and no audio, because it is on the other phone', session?.audio_url === null, session?.audio_url);
check('the favourite came across', res.body.favorite === true);
check('applying it queued nothing to send back', outbox(phone).length === 0, outbox(phone));
check('the page was told to refresh', events() > 0);

// ---------------------------------------------------------------------------
console.log('\n== last write wins on the phone too ==');
await tick();
await phone.PATCH(`/api/workspaces/${remoteId}`, { title: 'My newer title' });
server.replies.push({ recordings: [{ ...(server.pushes.at(-1)?.changes?.recordings?.[0] ?? {}), id: remoteId, title: 'Older server title', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null, markers: [], notes: '' }] });
server.rejectIds.add('never');
await cloud.syncNow();
res = await phone.GET(`/api/workspaces/${remoteId}`);
check('an older server copy does not overwrite a newer local edit', res.body.title === 'My newer title', res.body.title);

// ---------------------------------------------------------------------------
console.log('\n== deletes from elsewhere ==');
server.replies.push({ folders: [{ id: 'remoteFolder', updatedAt: later, deletedAt: later, name: '' }] });
await cloud.syncNow();
res = await phone.GET(`/api/workspaces/${remoteId}`);
check('a deleted folder leaves its recording, unfiled', res.status === 200 && res.body.folder_id === null, res.body.folder_id);
const audioPath = `file:///doc/recordings/${lecture.lectureId}.wav`;
check('(this phone has the audio for its own lecture)', phone.disk.has(audioPath));
server.replies.push({ recordings: [{ id: lecture.workspaceId, updatedAt: new Date(Date.now() + 120_000).toISOString(), deletedAt: later, title: '' }] });
await cloud.syncNow();
res = await phone.GET(`/api/workspaces/${lecture.workspaceId}`);
check('a recording deleted elsewhere is deleted here', res.status === 404, res.status);
check('...with its audio, as deleting it here would', !phone.disk.has(audioPath));

// ---------------------------------------------------------------------------
console.log('\n== tokens ==');
server.accessValid = false;
await phone.PATCH(`/api/folders/${bio}`, { name: 'Renamed offline' });
await cloud.syncNow();
check('a 401 refreshes the token and retries', server.refreshes === 1 && server.calls.at(-1).auth === 'Bearer access1', server.calls.at(-1));

// ---------------------------------------------------------------------------
console.log('\n== one bad row cannot block everything else ==');
await phone.PATCH(`/api/folders/${bio}`, { name: 'Fine' });
const bad = await phone.POST('/api/folders', { name: 'Poison' });
server.invalidIds.add(bad.body.id);
await cloud.syncNow();
check('the bad row is set aside', !outbox(phone).some((e) => e.id === bad.body.id), outbox(phone));
check('the good row still went up', server.pushes.some((p) => (p.changes.folders ?? []).some((f) => f.id === bio && f.name === 'Fine')));
res = await phone.GET('/api/account');
check('...and the user is told', /could not be synced/.test(res.body.lastError ?? ''), res.body.lastError);

// ---------------------------------------------------------------------------
console.log('\n== signing out keeps everything on the phone ==');
res = await phone.POST('/api/account/logout');
check('signed out', res.body.signedIn === false, res.body);
res = await phone.GET('/api/library');
check('the library is still here', res.body.folders.length > 0, res.body.folders);
check('the server was told', server.calls.some((c) => c.path === '/v1/auth/logout'));

// ---------------------------------------------------------------------------
console.log('\n== signing in with Google ==');
{
  const gPhone = makePhone();
  await gPhone.api.openDatabase();
  const gServer = fakeServer();
  let signedOut = 0;
  const behaviour = { token: 'google-id-token-from-the-picker', fail: null };
  const fakeGoogle = {
    available: () => true,
    idToken: async () => { if (behaviour.fail) throw behaviour.fail; return behaviour.token; },
    signOut: async () => { signedOut++; },
  };
  const { cloud: gCloud } = cloudFor(gPhone, gServer, { google: fakeGoogle });
  await gPhone.POST('/api/folders', { name: 'Before Google' });

  res = await gPhone.GET('/api/account');
  check('the page is told Google is available', res.body.google === true, res.body);

  behaviour.fail = Object.assign(new Error('Google sign-in was cancelled.'), { cancelled: true });
  res = await gPhone.POST('/api/account/google');
  check('backing out of the picker is not an error', res.status === 200 && res.body.cancelled === true && res.body.signedIn === false, res);
  check('...and nothing was sent to the server', gServer.googleBodies.length === 0);

  behaviour.fail = new Error('Google Play services are missing or out of date on this phone.');
  res = await gPhone.POST('/api/account/google');
  check('a real failure is reported in words', res.status === 502 && /Play services/.test(res.body.detail), res);

  behaviour.fail = null;
  res = await gPhone.POST('/api/account/google');
  check('signing in succeeds', res.status === 200 && res.body.signedIn === true && res.body.user?.email === 'student@example.com', res);
  check('the ID token went to the server, with the device name',
    gServer.googleBodies[0]?.idToken === 'google-id-token-from-the-picker' && gServer.googleBodies[0]?.deviceName === 'Test phone',
    gServer.googleBodies);
  await gCloud.syncNow();
  check('what was already on the phone uploaded, as with a password sign-in',
    gServer.pushes.some((push) => (push.changes.folders ?? []).some((folder) => folder.name === 'Before Google')), gServer.pushes);

  res = await gPhone.POST('/api/account/logout');
  check('signing out also signs out of Google, so the picker shows next time', signedOut === 1 && res.body.signedIn === false, { signedOut, res });
  gCloud.stop();

  // A binary built before the library existed.
  const oldPhone = makePhone();
  await oldPhone.api.openDatabase();
  const { cloud: oldCloud } = cloudFor(oldPhone, fakeServer(), { google: { available: () => false } });
  res = await oldPhone.GET('/api/account');
  check('without the library the page is told not to offer it', res.body.google === false, res.body);
  res = await oldPhone.POST('/api/account/google');
  check('...and a direct call is refused politely', res.status === 503 && /isn't available/.test(res.body.detail), res);
  oldCloud.stop();
}

cloud.stop();
done();
