/**
 * The transcription service client.
 *
 * The phone does not care what is behind the URL. Today it points at a laptop
 * over Tailscale; tomorrow it points at a hosted service. That is a settings
 * change rather than a rewrite, which is the whole reason this is a client
 * against a base URL and not a laptop-shaped special case.
 *
 * Two rules shape the rest:
 *
 *   A recording is never at risk. The audio is already on disk and in the
 *   database before any of this runs. Upload failure downgrades the lecture to
 *   'pending', never loses it.
 *
 *   Audio is never held in memory. React Native's FormData streams a file from
 *   its uri, so a 96MB lecture does not become a 130MB base64 string first.
 */

const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;  // a long lecture over slow campus wifi
const POLL_TIMEOUT_MS = 30 * 60 * 1000;    // transcription runs about 2x realtime
const POLL_INTERVAL_MS = 4000;
const PROBE_TIMEOUT_MS = 4000;

/** Trailing slashes and a missing scheme are the two things users type wrong. */
export function normalizeBaseUrl(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

async function withTimeout(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Is a server actually there? Used before queueing work and to decide whether
 * a lecture should wait for a good transcript or settle for the on-device one.
 */
export async function probe(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return { ok: false, reason: 'No transcription server is configured.' };
  try {
    const response = await withTimeout(
      fetch(`${base}/health`, { method: 'GET' }),
      PROBE_TIMEOUT_MS,
      'The server did not respond.',
    );
    if (!response.ok) return { ok: false, reason: `The server answered ${response.status}.` };
    return { ok: true };
  } catch (caught) {
    return { ok: false, reason: String(caught?.message ?? caught) };
  }
}

/**
 * Sends one recording for transcription and waits for the text.
 *
 * `onProgress` reports what the server says so a long lecture does not look
 * frozen. `signal` lets the caller abandon the wait without cancelling the
 * work the server has already started.
 */
export async function transcribeRemotely({
  baseUrl, fileUri, fileName, mimeType, title, notes, onProgress, signal,
}) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error('No transcription server is configured.');

  const form = new FormData();
  // The { uri, name, type } shape is how React Native streams a file from disk
  // rather than loading it. Passing the bytes would be fatal at lecture length.
  form.append('audio', { uri: fileUri, name: fileName, type: mimeType });
  form.append('title', title ?? '');
  form.append('capture_notes', notes ?? '');
  form.append('create_workspace', 'true');

  onProgress?.({ stage: 'uploading', progress: 0 });

  const created = await withTimeout(
    fetch(`${base}/api/lectures`, { method: 'POST', body: form, signal }),
    UPLOAD_TIMEOUT_MS,
    'The upload timed out.',
  );

  if (!created.ok) {
    const detail = await created.json().catch(() => null);
    throw new Error(detail?.detail ?? `The server rejected the upload (${created.status}).`);
  }

  const lecture = await created.json();
  const remoteId = lecture?.id;
  if (!remoteId) throw new Error('The server did not return a lecture.');

  // Transcription is queued server-side, so the upload returning does not mean
  // the text exists yet.
  if (lecture.transcription_status === 'ready' && lecture.transcript) {
    return { transcript: lecture.transcript, remoteId, model: lecture.model };
  }

  const startedAt = Date.now();
  for (;;) {
    if (signal?.aborted) throw new Error('Cancelled.');
    if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
      throw new Error('The server is still transcribing. It will be here next time you open the app.');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    let status;
    try {
      const response = await withTimeout(
        fetch(`${base}/api/lectures/${remoteId}`, { signal }),
        PROBE_TIMEOUT_MS * 4,
        'The server stopped responding.',
      );
      if (!response.ok) continue;  // a blip, not a failure; keep waiting
      status = await response.json();
    } catch {
      continue;
    }

    onProgress?.({
      stage: 'transcribing',
      progress: status.transcription_progress ?? 0,
      etaSeconds: status.transcription_eta_seconds ?? null,
    });

    if (status.transcription_status === 'ready') {
      return { transcript: status.transcript ?? '', remoteId, model: status.model };
    }
    if (status.transcription_status === 'failed') {
      throw new Error('The server could not transcribe that recording.');
    }
  }
}
