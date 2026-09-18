import { useEffect, useRef, useState } from 'react';
import ActionSheet from './ActionSheet';
import Waveform from './Waveform';
import { Icon } from './Icon';
import { IconButton } from './ui';
import { libraryApi, uploadRecording } from '../lib/api';
import { clock } from '../lib/format';

/**
 * Recording.
 *
 * The screen has one job, so it has one clock, one trace and three controls:
 * bookmark, stop, pause. Stop is twice the size of the other two because it is
 * the only one that ends anything.
 *
 * The moment words start arriving, the transcript takes the screen over and
 * the clock shrinks into the status line - what you want to see while someone
 * is talking is what they said, not how long they have been talking. The
 * chevron puts the clock back.
 *
 * Nothing here asks for a name or a note. A recording is named after the fact,
 * from its own screen, because the thing being recorded does not wait.
 */
export default function RecordScreen({ context, onSaved, onCancel, notify }) {
  const [phase, setPhase] = useState('ready'); // ready | recording | paused | saving | saved
  const [elapsed, setElapsed] = useState(0);
  const [markers, setMarkers] = useState([]);
  const [error, setError] = useState('');
  const [liveStream, setLiveStream] = useState(null);
  const [transcript, setTranscript] = useState({ text: '', interim: '' });
  const [showLyrics, setShowLyrics] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saved, setSaved] = useState(null);

  // The native shell says what this build can actually do; a browser sets
  // neither flag and gets the browser's own behaviour. The shell corrects
  // these once it knows - an offline language pack may still be downloading -
  // so this listens rather than reading once at mount.
  const [caps, setCaps] = useState(() => (typeof window !== 'undefined' && window.__CN_CAPS__) || {});
  useEffect(() => {
    const refresh = () => setCaps({ ...(window.__CN_CAPS__ || {}) });
    window.addEventListener('cn:caps', refresh);
    return () => window.removeEventListener('cn:caps', refresh);
  }, []);
  const canPause = caps.pause !== false;
  const hasLiveTranscript = caps.transcription === true;

  useEffect(() => {
    if (!hasLiveTranscript) return undefined;
    const receive = (event) => setTranscript(event.detail ?? { text: '', interim: '' });
    window.addEventListener('cn:transcript', receive);
    return () => window.removeEventListener('cn:transcript', receive);
  }, [hasLiveTranscript]);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const carriedRef = useRef(0);
  const timerRef = useRef(0);

  const destination = context.workspace ? context.workspace.title : context.folder?.name ?? null;
  const now = () => carriedRef.current + (startedAtRef.current ? performance.now() - startedAtRef.current : 0);

  useEffect(() => () => {
    window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function startClock() {
    window.clearInterval(timerRef.current);
    startedAtRef.current = performance.now();
    timerRef.current = window.setInterval(() => setElapsed(now()), 100);
  }
  function stopClock() {
    carriedRef.current = now();
    startedAtRef.current = 0;
    setElapsed(carriedRef.current);
    window.clearInterval(timerRef.current);
  }

  async function start() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      setLiveStream(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunksRef.current.push(event.data); });
      recorder.addEventListener('error', () => setError('The microphone stopped unexpectedly.'));
      recorder.start(1000);
      startClock();
      setPhase('recording');
    } catch {
      setError('Microphone access was not granted. Allow it, then try again.');
    }
  }

  function pauseOrResume() {
    const recorder = recorderRef.current;
    if (!recorder || !canPause) return;
    if (phase === 'recording') { recorder.pause(); stopClock(); setPhase('paused'); }
    else { recorder.resume(); startClock(); setPhase('recording'); }
  }

  function addMarker() {
    const at = Math.round(now() / 100) / 10;
    setMarkers((current) => [...current, { label: `Bookmark at ${clock(at * 1000)}`, time_seconds: at }]);
    notify(`Bookmarked ${clock(at * 1000)}.`);
  }

  async function stop() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    // Browsers emit a chunk on the timeslice; the native shell keeps the audio
    // on disk and only emits its file token on stop. Either way the page must
    // never refuse to stop for want of a chunk - stopping a second early used
    // to do nothing at all, with the screen still saying Recording.
    const nativeDeliversOnStop = typeof window !== 'undefined' && window.__CN_NATIVE__ === true;
    setPhase('saving');
    setError('');
    stopClock();
    const finished = () => new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
    const blob = await new Promise((resolve) => {
      if (recorder.state === 'inactive') { resolve(finished()); return; }
      recorder.addEventListener('stop', () => resolve(finished()), { once: true });
      recorder.stop();
    });
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setLiveStream(null);
    if (!blob.size && !nativeDeliversOnStop) {
      setError('That take did not capture any audio.');
      setPhase('paused');
      return;
    }
    try {
      const recording = await uploadRecording({
        blob,
        title: '',
        captureNotes: '',
        folderId: context.workspace ? undefined : context.folder?.id,
        workspaceId: context.workspace?.id,
      });
      await Promise.all(markers.map((marker) => libraryApi.addMarker(recording.id, marker)));
      setSaved(recording);
      setPhase('saved');
    } catch (caught) {
      setError(caught.message);
      setPhase('paused');
    }
  }

  function discard() {
    window.clearInterval(timerRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setLiveStream(null);
    onCancel();
  }

  function leave() {
    if (phase === 'ready' || window.confirm('Discard this recording?')) discard();
  }

  /* ---- Saved (the confirmation the board calls "Recording Saved") ---- */
  if (phase === 'saved' && saved) {
    return (
      <main className="centred">
        <span className="saved-mark"><Icon name="check" /></span>
        <h2>Recording Saved</h2>
        <p>
          {saved.title ? <>“{saved.title}”</> : 'Your recording'} has been
          saved{destination ? <> to {destination}</> : null}.
        </p>
        <div className="stack">
          <button className="btn primary" onClick={() => onSaved(saved.workspace_id)}>View Recording</button>
          <button className="btn" onClick={onCancel}>Continue</button>
        </div>
      </main>
    );
  }

  const recording = phase === 'recording';
  const words = `${transcript.text} ${transcript.interim}`.trim();
  const lyricsMode = hasLiveTranscript && showLyrics && Boolean(words);
  const stateCopy = phase === 'ready' ? 'Ready'
    : recording ? 'Recording…'
      : phase === 'paused' ? 'Paused' : 'Saving…';

  return (
    <main className="rec">
      <header className="head">
        <IconButton
          name={lyricsMode ? 'down' : 'close'}
          label={lyricsMode ? 'Show the timer' : 'Close'}
          variant="plain"
          onClick={lyricsMode ? () => setShowLyrics(false) : leave}
        />
        <IconButton name="more" label="Recording options" variant="plain" onClick={() => setSheetOpen(true)} />
      </header>

      {lyricsMode
        ? <section className="rec-lyrics">
            <span className={`rec-state ${recording ? '' : 'idle'}`}>
              <i />{stateCopy}<b>{clock(elapsed)}</b>
            </span>
            <LiveWords text={transcript.text} interim={transcript.interim} />
          </section>
        : <section className="rec-stage">
            <div className="rec-clock">{clock(elapsed)}</div>
            <span className={`rec-state ${recording ? '' : 'idle'}`}><i />{stateCopy}</span>
            <Waveform stream={liveStream} phase={phase} className="rec-trace" />
            {error && <p className="rec-error" role="alert">{error}</p>}
          </section>}

      <section>
        {lyricsMode && <Waveform stream={liveStream} phase={phase} className="rec-trace" />}
        <div className="rec-controls">
          <span className="side-l">
            <IconButton name="bookmark" label="Bookmark this moment" onClick={addMarker} disabled={phase === 'ready'} />
          </span>

          <button
            type="button"
            className={`stop-btn ${phase === 'ready' ? 'idle' : ''}`}
            onClick={phase === 'ready' ? start : stop}
            disabled={phase === 'saving'}
            aria-label={phase === 'ready' ? 'Start recording' : 'Stop and save'}
          >{phase === 'ready' ? null : <Icon name="stop" />}</button>

          <span className="side-r">
            <IconButton
              name={phase === 'paused' ? 'play' : 'pause'}
              label={phase === 'paused' ? 'Resume' : 'Pause'}
              onClick={pauseOrResume}
              disabled={phase === 'ready' || phase === 'saving' || !canPause}
            />
          </span>
        </div>
        <p className="rec-hint">
          {phase === 'ready' ? 'Tap to record'
            : phase === 'saving' ? 'Saving your recording…'
              : markers.length ? `${markers.length} bookmark${markers.length === 1 ? '' : 's'}`
                : 'Tap stop when you are done'}
        </p>
      </section>

      {sheetOpen && (
        <ActionSheet
          title="Recording"
          subtitle={destination ? `Saving to ${destination}` : 'Saving to your library'}
          onClose={() => setSheetOpen(false)}
          items={[
            hasLiveTranscript && !lyricsMode && words
              ? { label: 'Show live transcript', icon: 'text', onSelect: () => setShowLyrics(true) }
              : null,
            { label: 'Discard recording', icon: 'trash', danger: true, onSelect: leave },
          ]}
        />
      )}
    </main>
  );
}

/**
 * The words, while they are being said.
 *
 * What has been recognised is white and what is still settling is dimmer, so
 * the line in progress reads as provisional without moving anything. The block
 * is anchored to the bottom, which is what makes new text push the old text up
 * rather than appear underneath it.
 */
function LiveWords({ text, interim }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [text, interim]);
  return (
    <div className="transcript live" aria-live="polite">
      <p className="line active">
        <span className="w on">{text}</span>{' '}
        <span className="w">{interim}</span>
      </p>
      <div ref={endRef} />
    </div>
  );
}
