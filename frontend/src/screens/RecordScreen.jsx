import { useCallback, useEffect, useRef, useState } from 'react';
import VFBottomSheet from '../components/VFBottomSheet';
import VFButton from '../components/VFButton';
import VFRecordButton from '../components/VFRecordButton';
import VFSlideToCancel from '../components/VFSlideToCancel';
import VFWaveform from '../components/VFWaveform';
import { Icon } from '../components/Icon';
import { COPY, fill } from '../lib/copy';
import { clock } from '../lib/format';
import { libraryApi, uploadRecording } from '../lib/api';
import useLiveLevels from '../lib/useLiveLevels';

/**
 * Recording, and the four ways it ends.
 *
 * One screen owns the whole take - running, paused, saving, saved, canceled -
 * because they are one continuous thing to the person holding the phone. Only
 * the two questions (finish, storage) are sheets, since those are the moments
 * the take is still recoverable.
 *
 * Finishing stays pause-gated. The × does not stop anything; it raises the
 * finish sheet. An accidental tap while someone is still talking must not be
 * able to end a lecture, so ending is always two deliberate actions.
 *
 * The transcript is the screen while words are arriving. What you want to see
 * during a lecture is what was said, not how long it has been going, so the
 * clock shrinks to a status line and the words take the space.
 */

/** The last finished sentences, plus whatever is still being said. */
function splitLines(text = '', interim = '') {
  const done = String(text).match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const current = interim.trim() || done.pop() || '';
  return { past: done.slice(-2), current };
}

/** How long the microphone may take before we stop pretending it is coming. */
const OPEN_TIMEOUT_MS = 5000;

export default function RecordScreen({ folder, onSaved, onLeave, onDenied, notify }) {
  const [phase, setPhase] = useState('ready'); // ready|recording|paused|saving|saved|canceled
  const [elapsed, setElapsed] = useState(0);
  const [sheet, setSheet] = useState('none'); // none|finish|storage
  const [error, setError] = useState('');
  const [slow, setSlow] = useState(false);
  const [stream, setStream] = useState(null);
  const [transcript, setTranscript] = useState({ text: '', interim: '' });
  const [saved, setSaved] = useState(null);

  const [markers, setMarkers] = useState([]);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteAt, setNoteAt] = useState(0);
  const noteField = useRef(null);

  // The native shell says what this build can actually do; a browser sets
  // neither flag and gets the browser's own behaviour. The shell corrects these
  // once it knows - an offline language pack may still be downloading - so this
  // listens rather than reading once at mount.
  const [caps, setCaps] = useState(() => (typeof window !== 'undefined' && window.__CN_CAPS__) || {});
  useEffect(() => {
    const refresh = () => setCaps({ ...(window.__CN_CAPS__ || {}) });
    window.addEventListener('cn:caps', refresh);
    return () => window.removeEventListener('cn:caps', refresh);
  }, []);
  const canPause = caps.pause !== false;
  const hasLiveTranscript = caps.transcription === true;
  const noRecorder = caps.recorder === false;

  useEffect(() => {
    if (!hasLiveTranscript) return undefined;
    const receive = (event) => setTranscript(event.detail ?? { text: '', interim: '' });
    window.addEventListener('cn:transcript', receive);
    return () => window.removeEventListener('cn:transcript', receive);
  }, [hasLiveTranscript]);

  const recorder = useRef(null);
  const tracks = useRef(null);
  const chunks = useRef([]);
  const stopFailure = useRef('');
  const startedAt = useRef(0);
  const carried = useRef(0);
  const timer = useRef(0);

  const levels = useLiveLevels(stream, phase === 'recording');
  const destination = folder?.name ?? 'Inbox';

  /**
   * Warn once, before the take gets long enough to be worth losing.
   *
   * The recorder writes 16kHz mono PCM WAV, which is 32KB a second, so free
   * bytes convert straight into minutes. Anything under ten of them is worth
   * saying out loud; the estimate is a browser API that a WebView may not
   * answer, and a missing answer is not a reason to interrupt.
   */
  const [minutesLeft, setMinutesLeft] = useState(null);
  useEffect(() => {
    let cancelled = false;
    navigator.storage?.estimate?.().then(({ quota = 0, usage = 0 }) => {
      const free = Math.max(0, quota - usage);
      const minutes = Math.floor(free / (32 * 1024 * 60));
      if (cancelled || !Number.isFinite(minutes)) return;
      setMinutesLeft(minutes);
      if (minutes < 10) setSheet('storage');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const now = () => carried.current + (startedAt.current ? performance.now() - startedAt.current : 0);

  const startClock = () => {
    window.clearInterval(timer.current);
    startedAt.current = performance.now();
    timer.current = window.setInterval(() => setElapsed(now()), 100);
  };
  const stopClock = () => {
    carried.current = now();
    startedAt.current = 0;
    setElapsed(carried.current);
    window.clearInterval(timer.current);
  };

  useEffect(() => () => {
    window.clearInterval(timer.current);
    tracks.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!noteOpen) return undefined;
    const focus = window.setTimeout(() => noteField.current?.focus(), 80);
    return () => window.clearTimeout(focus);
  }, [noteOpen]);

  const start = useCallback(async () => {
    setError('');
    setSlow(false);
    // Opening the microphone is a native round trip on the phone, and a round
    // trip can simply not come back. Without this the screen sat at 00:00 with
    // no clock, no error and no way to retry, which reads as "recording is
    // broken" rather than "the microphone has not answered".
    const nudge = window.setTimeout(() => setSlow(true), OPEN_TIMEOUT_MS);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      const next = new MediaRecorder(media);
      tracks.current = media;
      setStream(media);
      recorder.current = next;
      chunks.current = [];
      stopFailure.current = '';
      next.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.current.push(event.data); });
      next.addEventListener('error', (event) => {
        // The shell reports why it could not record - that the file was never
        // written, that the build has no recorder. Replacing that with one
        // generic sentence threw away the only account of what went wrong.
        const detail = String(event?.message ?? '').trim();
        stopFailure.current = detail;
        setError(detail || 'The microphone stopped unexpectedly.');
      });
      next.start(1000);
      startClock();
      setPhase('recording');
    } catch (caught) {
      const detail = String(caught?.message ?? '');
      if (/denied|not allowed|permission/i.test(detail)) { onDenied?.(); return; }
      setError(detail.trim() || 'The microphone could not be opened.');
    } finally {
      window.clearTimeout(nudge);
      setSlow(false);
    }
  }, [onDenied]);

  // Arriving here is already the decision to record - the button that got you
  // here was the record button - so nothing waits for a second tap. The guard
  // is not belt and braces: `start` is rebuilt whenever the callbacks this
  // screen is given change identity, and without the ref that made the effect
  // re-run and open a second recorder on top of the first.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (phase !== 'ready' || noRecorder || autoStarted.current) return;
    autoStarted.current = true;
    start();
  }, [phase, noRecorder, start]);

  function toggle() {
    // Before anything is open, the button is the way to try again.
    if (phase === 'ready') { start(); return; }
    const current = recorder.current;
    if (!current || !canPause) return;
    if (phase === 'recording') { current.pause(); stopClock(); setPhase('paused'); }
    else if (phase === 'paused') { current.resume(); startClock(); setPhase('recording'); }
  }

  /* ---- bookmarks ----------------------------------------------------
     A lecture does not stop while you write something down, so a bookmark is
     one tap now and a label afterwards. They are held here and written to the
     recording once it has an id for them to belong to.                    */
  function openNote() {
    if (phase !== 'recording' && phase !== 'paused') return;
    setNoteAt(Math.round(now() / 100) / 10);
    setNoteDraft('');
    setNoteOpen(true);
  }
  function saveNote(event) {
    event.preventDefault();
    const label = noteDraft.trim() || `Bookmark at ${clock(noteAt * 1000)}`;
    setMarkers((current) => [...current, { label, time_seconds: noteAt }]);
    setNoteOpen(false);
    setNoteDraft('');
    notify?.(`Bookmark added at ${clock(noteAt * 1000)}.`);
  }

  async function finish() {
    const current = recorder.current;
    if (!current || phase !== 'paused') return;
    setSheet('none');
    setPhase('saving');
    setError('');
    stopClock();
    // Browsers emit a chunk on the timeslice; the shell keeps the audio on disk
    // and only emits its file token on stop. Either way the page must never
    // refuse to stop for want of a chunk.
    const collected = () => new Blob(chunks.current, { type: current.mimeType || 'audio/webm' });
    const blob = await new Promise((resolve) => {
      if (current.state === 'inactive') { resolve(collected()); return; }
      current.addEventListener('stop', () => resolve(collected()), { once: true });
      current.stop();
    });
    tracks.current?.getTracks().forEach((track) => track.stop());
    setStream(null);
    if (!blob.size) {
      // The shell emits its file token before it emits stop, so an empty blob
      // here means the recorder failed rather than that the take was silent.
      setError(stopFailure.current || 'That take did not capture any audio.');
      setPhase('paused');
      return;
    }
    try {
      const recording = await uploadRecording({
        blob, title: '', captureNotes: '', folderId: folder?.id,
      });
      // Bookmarks attach afterwards, because until now there was no recording
      // for them to hang on. A failed bookmark must not lose the take.
      try {
        await Promise.all(markers.map((marker) => libraryApi.addMarker(recording.id, marker)));
      } catch {
        notify?.('The recording saved, but its bookmarks did not.', 'error');
      }
      setSaved(recording);
      setPhase('saved');
    } catch (caught) {
      setError(caught.message);
      setPhase('paused');
    }
  }

  function discard() {
    window.clearInterval(timer.current);
    // The native recorder owns a pre-claimed local row. Its discard hook deletes
    // that row and its temporary audio instead of treating cancel as a finished
    // recording with no page open.
    const current = recorder.current;
    if (current && current.state !== 'inactive') {
      if (typeof current.discard === 'function') current.discard();
      else current.stop();
    }
    tracks.current?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setSheet('none');
    setPhase('canceled');
  }

  /* ---- 8. Saving ---- */
  if (phase === 'saving') {
    return (
      <main className="screen outcome">
        <span className="spinner" aria-hidden="true" />
        <h1>{COPY.savingTitle}</h1>
        <p>{COPY.savingSub}</p>
      </main>
    );
  }

  /* ---- 9. Saved ---- */
  if (phase === 'saved' && saved) {
    const queued = ['pending', 'running'].includes(saved.transcription_status);
    return (
      <main className="screen outcome">
        <span className="outcome-mark outcome-mark--ok"><Icon name="check" strokeWidth={2.6} /></span>
        <h1>{COPY.savedTitle}</h1>
        <p>{fill(COPY.savedSub, { title: saved.title || 'Your recording', folder: destination })}</p>
        {queued && <p className="outcome-note"><i />Transcribing a more accurate version now. You can keep using the app.</p>}
        {saved.transcription_status === 'unavailable' && (
          <p className="outcome-note quiet">No speech was detected in this take, so there is no transcript yet.</p>
        )}
        {markers.length > 0 && (
          <p className="outcome-note quiet">
            {markers.length} bookmark{markers.length === 1 ? '' : 's'} saved with it.
          </p>
        )}
        <div className="outcome-actions">
          <VFButton label="View Recording" icon="play" onPress={() => onSaved(saved.workspace_id, saved)} />
          <VFButton label={`Back to ${destination}`} variant="secondary" onPress={() => onLeave(saved)} />
        </div>
      </main>
    );
  }

  /* ---- 10. Canceled ---- */
  if (phase === 'canceled') {
    return (
      <main className="screen outcome">
        <span className="outcome-mark outcome-mark--off"><Icon name="close" strokeWidth={2.4} /></span>
        <h1>{COPY.canceledTitle}</h1>
        <p>{COPY.canceledSub}</p>
        <div className="outcome-actions">
          <VFButton label="Record again" onPress={() => {
            carried.current = 0; autoStarted.current = false;
            setMarkers([]); setElapsed(0); setTranscript({ text: '', interim: '' }); setPhase('ready');
          }} />
          <VFButton label="Back to Folders" variant="secondary" onPress={() => onLeave(null)} />
        </div>
      </main>
    );
  }

  /* ---- 5. Recording ---- */
  const running = phase === 'recording';
  const opening = phase === 'ready';
  const { past, current } = splitLines(transcript.text, transcript.interim);
  const hasWords = Boolean(past.length || current);

  const waiting = noRecorder
    ? 'This build has no recorder yet — rebuild the development client to record.'
    : slow ? 'The microphone has not answered. Tap the button to try again.'
      : opening ? 'Opening the microphone…'
        : hasLiveTranscript ? 'Listening…'
          : 'Recording. The transcript is made when you finish.';

  return (
    <main className="screen rec">
      <header className="vf-bar">
        <button type="button" className="vf-round vf-round--plain" aria-label="Finish recording"
          onClick={() => (opening ? onLeave(null) : setSheet('finish'))}>
          <Icon name="close" strokeWidth={2.2} />
        </button>
        <span className="vf-bar-copy rec-dest">
          <strong>New recording</strong>
          <small>{destination}</small>
        </span>
        <button type="button" className="vf-round vf-round--plain" aria-label="Recording continues when locked"
          onClick={() => notify?.('Recording keeps going with the screen off.')}>
          <Icon name="lock" strokeWidth={2.2} />
        </button>
      </header>

      <div className="rec-status">
        <span className={`rec-dot${running ? ' is-live' : ''}`} aria-hidden="true" />
        <span className="rec-clock">{clock(elapsed)}</span>
        <span className="rec-state">{opening ? '' : running ? COPY.live : COPY.paused}</span>
      </div>

      {hasWords ? (
        <section className="rec-words" aria-live="polite">
          {past.map((line, i) => <p key={i} className="rec-past">{line}</p>)}
          <p className="rec-now">{current}</p>
        </section>
      ) : (
        <section className="rec-words rec-words--waiting">
          <p className="rec-past">{waiting}</p>
        </section>
      )}

      {error && <p className="rec-error" role="alert">{error}</p>}

      <div className="rec-foot">
        {noteOpen ? (
          <form className="note-composer" onSubmit={saveNote}>
            <span className="note-at"><Icon name="bookmark" strokeWidth={2} />{clock(noteAt * 1000)}</span>
            <input
              ref={noteField} value={noteDraft} maxLength={80}
              placeholder="What just happened?" aria-label="Bookmark label"
              onChange={(event) => setNoteDraft(event.target.value)}
            />
            <button type="button" className="note-close" aria-label="Cancel bookmark"
              onClick={() => setNoteOpen(false)}><Icon name="close" strokeWidth={2.4} /></button>
            <button type="submit" className="note-save">Add</button>
          </form>
        ) : markers.length > 0 && (
          <div className="note-rack" aria-label="Recent bookmarks">
            {markers.slice(-2).reverse().map((marker, i) => (
              <span className="note-chip" key={`${marker.time_seconds}-${i}`}>
                <Icon name="bookmark" strokeWidth={2} />
                <b>{marker.label}</b>
                <small>{clock(marker.time_seconds * 1000)}</small>
              </span>
            ))}
          </div>
        )}

        <VFWaveform
          height={120}
          levels={levels.length ? levels : new Array(64).fill(0.04)}
          dim={!running}
        />

        <div className="rec-controls">
          {/* Both side slots stay in the layout and only change opacity, so the
              record button never moves when the take is paused. */}
          <span className="rec-side">
            <button
              type="button" className={`rec-bookmark${opening ? ' is-hidden' : ''}`}
              aria-label="Add a bookmark" aria-hidden={opening} onClick={openNote}
            ><Icon name="bookmark" strokeWidth={2} /></button>
          </span>

          <VFRecordButton state={opening ? 'idle' : running ? 'recording' : 'paused'} onPress={toggle} />

          <span className="rec-side">
            <button
              type="button" className={`rec-finish${phase === 'paused' ? '' : ' is-hidden'}`}
              aria-hidden={phase !== 'paused'} onClick={() => setSheet('finish')}
            >Finish</button>
          </span>
        </div>
      </div>

      {/* ---- 6. Finish sheet ---- */}
      <VFBottomSheet
        open={sheet === 'finish'} icon="check"
        title={COPY.finishTitle}
        subtitle={fill(COPY.finishSub, { folder: destination })}
        onClose={() => setSheet('none')}
      >
        <VFButton label={COPY.finishBtn} disabled={phase === 'recording'} onPress={finish} />
        {phase === 'recording' && <p className="sheet-note">Pause before you finish this recording.</p>}
        <VFSlideToCancel label={COPY.slide} releaseLabel={COPY.release} onCancel={discard} />
      </VFBottomSheet>

      {/* ---- 7. Storage almost full ---- */}
      <VFBottomSheet
        open={sheet === 'storage'} icon="warn"
        title={COPY.storageTitle}
        subtitle={fill(COPY.storageSub, { minutes: minutesLeft ?? 9 })}
        onClose={() => setSheet('none')}
      >
        <div className="storage-bar" aria-hidden="true"><i style={{ width: '62%' }} /><em style={{ width: '24%' }} /></div>
        <VFButton label="Free up space" onPress={() => setSheet('none')} />
        <VFButton label="Keep recording" variant="secondary" onPress={() => setSheet('none')} />
      </VFBottomSheet>
    </main>
  );
}
