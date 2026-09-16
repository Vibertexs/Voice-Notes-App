import { useEffect, useRef, useState } from 'react';
import { libraryApi, uploadRecording } from '../lib/api';
import DiscardSlider from './DiscardSlider';
import Waveform from './Waveform';
import { Icon } from './Icon';

function elapsedLabel(milliseconds) {
  const tenths = Math.floor(milliseconds / 100);
  const seconds = Math.floor(tenths / 10);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`;
}

export default function CaptureView({ context, onSaved, onCancel, notify }) {
  const [phase, setPhase] = useState('ready');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [markers, setMarkers] = useState([]);
  const [markerLabel, setMarkerLabel] = useState('');
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [liveStream, setLiveStream] = useState(null);
  const [transcript, setTranscript] = useState({ text: '', interim: '' });
  // Holds the finished audio when capture was ended early. In recogniser mode
  // the take really stops rather than pausing, so the blob exists before Done
  // is ever pressed.
  const stoppedBlobRef = useRef(null);

  // The native shell advertises what this build can actually do. In a browser
  // neither flag is set, so both default to the browser's own behaviour.
  // The shell corrects these once it knows whether the recogniser really
  // works, which can happen well after load - an offline language pack may
  // still be downloading. Re-read on its signal rather than only at mount.
  const [caps, setCaps] = useState(
    () => (typeof window !== 'undefined' && window.__CN_CAPS__) || {});
  useEffect(() => {
    const refresh = () => setCaps({ ...(window.__CN_CAPS__ || {}) });
    window.addEventListener('cn:caps', refresh);
    return () => window.removeEventListener('cn:caps', refresh);
  }, []);
  const canPause = caps.pause !== false;
  const isNativeShell = typeof window !== 'undefined' && window.__CN_NATIVE__ === true;
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
  const carriedMsRef = useRef(0);
  const timerRef = useRef(0);
  const completionTimerRef = useRef(0);
  const fileInputRef = useRef(null);

  const location = context.workspace ? context.workspace.title : context.folder?.name ?? 'Library';
  const currentTime = () => carriedMsRef.current + (startedAtRef.current ? performance.now() - startedAtRef.current : 0);

  useEffect(() => () => {
    window.clearInterval(timerRef.current);
    window.clearTimeout(completionTimerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  function updateClock() { setElapsed(currentTime()); }
  function startClock() {
    window.clearInterval(timerRef.current);
    startedAtRef.current = performance.now();
    timerRef.current = window.setInterval(updateClock, 100);
  }
  function pauseClock() {
    carriedMsRef.current = currentTime();
    startedAtRef.current = 0;
    updateClock();
    window.clearInterval(timerRef.current);
  }
  function holdCompletion(milliseconds) {
    return new Promise((resolve) => { completionTimerRef.current = window.setTimeout(resolve, milliseconds); });
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
      recorder.addEventListener('error', () => setError('The microphone stopped unexpectedly. You can retry or discard this capture.'));
      recorder.start(1000);
      startClock();
      setPhase('recording');
    } catch {
      setError('Microphone access was not granted. Allow it, then try again.');
    }
  }

  function pauseOrResume() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (!canPause) {
      // The recogniser writes one audio file per session, so resuming would
      // start a second one and split the lecture. The control is a stop, not
      // a pause: capture really ends here, the clock really stops, and the
      // only choices left are to save or discard.
      if (phase !== 'recording') return;
      pauseClock();
      setPhase('paused');
      new Promise((resolve) => {
        recorder.addEventListener('stop', () => resolve(
          new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }),
        ), { once: true });
        recorder.stop();
      }).then((blob) => {
        stoppedBlobRef.current = blob;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        setLiveStream(null);
      });
      return;
    }
    if (phase === 'recording') { recorder.pause(); pauseClock(); setPhase('paused'); }
    else { recorder.resume(); startClock(); setPhase('recording'); }
  }

  function addMarker() {
    const label = markerLabel.trim() || `Marker at ${elapsedLabel(currentTime())}`;
    setMarkers((current) => [...current, { label, time_seconds: Math.round(currentTime() / 100) / 10 }]);
    setMarkerLabel('');
  }

  async function done() {
    const recorder = recorderRef.current;
    // Browsers emit a chunk on the chosen timeslice. The Expo shell keeps the
    // audio file native and emits its single file token only when stop() is
    // called, so waiting for a chunk here would make Done a no-op on mobile.
    const nativeRecorderDeliversOnStop = typeof window !== 'undefined' && window.__CN_NATIVE__ === true;
    if (!recorder || (!chunksRef.current.length && !nativeRecorderDeliversOnStop)) return;
    setPhase('saving');
    setError('');
    const savedElapsed = currentTime();
    pauseClock();
    // Capture may already have ended: in recogniser mode the stop control
    // finishes the take, so stopping again here would fail.
    const blob = stoppedBlobRef.current ?? await new Promise((resolve) => {
      recorder.addEventListener('stop', () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })), { once: true });
      recorder.stop();
    });
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setLiveStream(null);
    try {
      const recording = await uploadRecording({
        blob, title, captureNotes: notes,
        folderId: context.workspace ? undefined : context.folder?.id,
        workspaceId: context.workspace?.id,
      });
      await Promise.all(markers.map((marker) => libraryApi.addMarker(recording.id, marker)));
      await Promise.all(files.map((file) => libraryApi.uploadMaterial(file, { workspaceId: recording.workspace_id })));
      notify(`Saved ${elapsedLabel(savedElapsed)} of audio.`);
      setPhase('saved');
      // A successful action should be visible before we take the student back.
      await holdCompletion(900);
      onSaved(recording.workspace_id);
    } catch (caught) {
      setError(caught.message);
      setPhase('paused');
    }
  }

  function discard() {
    setPhase('discarding');
    window.clearInterval(timerRef.current);
    recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setLiveStream(null);
    // The slider is intentionally consequential; acknowledge it before leaving.
    completionTimerRef.current = window.setTimeout(onCancel, 700);
  }

  const isRecording = phase === 'recording';
  const isPaused = phase === 'paused';
  const isFinalizing = ['saving', 'saved', 'discarding'].includes(phase);
  const completionCopy = phase === 'discarding'
    ? ['Discarded', 'Nothing was saved.']
    : phase === 'saved'
      ? ['Saved', 'Transcribing now…']
      : ['Finishing', 'Saving your audio and notes…'];

  return <main className="capture-screen">
    <div className="capture-top">
      <button className="blur-btn" onClick={onCancel} disabled={isFinalizing} aria-label="Cancel and go back">
        <Icon name="back" />
      </button>
      <span className="kicker">{context.workspace ? 'Continuing' : location}</span>
      <span style={{ width: '2.4rem' }} />
    </div>

    <header className="capture-heading">
      <h1>{context.workspace ? context.workspace.title : 'New lecture'}</h1>
    </header>

    <section className={`rec-stage ${phase}`} data-phase={phase}>
      {isFinalizing && (
        <div
          className={`veil ${phase === 'discarding' ? 'bad' : ''} ${phase === 'saved' ? 'ok' : ''}`}
          role="status" aria-live="polite"
        >
          <span className="veil-mark">
            {phase === 'discarding'
              ? <svg viewBox="0 0 52 52"><path d="M17 18h18M22 18v-4h8v4M20 22v14m6-14v14m6-14v14M18 18l2 22h12l2-22" /></svg>
              : phase === 'saved'
                ? <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" /><path d="M14 27l8 8 16-16" /></svg>
                : <svg className="spin" viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" /></svg>}
          </span>
          <strong>{completionCopy[0]}</strong>
          <span>{completionCopy[1]}</span>
        </div>
      )}

      <div className="phase-label">
        {phase === 'ready' ? 'Ready'
          : phase === 'recording' ? 'Recording'
          : phase === 'paused' ? (canPause ? 'Paused' : 'Stopped')
          : phase === 'discarding' ? 'Discarding'
          : phase === 'saved' ? 'Saved' : 'Saving'}
      </div>
      <div className="clock">{elapsedLabel(elapsed)}</div>
      <Waveform stream={liveStream} phase={phase} />

      <div className="marker-slot">
        {isRecording
          ? <div className="marker-control">
              <input
                value={markerLabel}
                maxLength="120"
                placeholder="Mark this moment…"
                onChange={(event) => setMarkerLabel(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && addMarker()}
              />
              <button className="btn quiet" onClick={addMarker}>Mark</button>
            </div>
          : <span className="marker-slot-copy">
              {markers.length
                ? `${markers.length} marker${markers.length === 1 ? '' : 's'} saved`
                : 'Mark important moments while recording'}
            </span>}
      </div>

      <div className="shutter-row">
        <button
          className="shutter"
          data-phase={phase}
          onClick={phase === 'ready' ? start : pauseOrResume}
          disabled={phase === 'saving'}
          aria-label={phase === 'ready' ? 'Start recording'
            : isPaused ? (canPause ? 'Resume recording' : 'Recording finished')
            : canPause ? 'Pause recording' : 'Stop recording'}
        ><span className="shutter-glyph" aria-hidden="true" /></button>

        <div className={`finish-group ${isPaused ? 'shown' : ''}`} inert={!isPaused ? '' : undefined}>
          <button className="finish-btn" onClick={done} aria-label="Save and transcribe">
            <Icon name="check" />
          </button>
          <span className="finish-caption" aria-hidden="true">Done</span>
        </div>
      </div>

      <p className="hint">
        {phase === 'ready' ? 'Tap to record'
          : isRecording ? (canPause ? 'Tap to pause' : 'Tap to stop')
          : isPaused ? (canPause ? 'Tap to resume, or slide to discard' : 'Save it, or slide to discard')
          : 'Saving…'}
      </p>

      <DiscardSlider open={isPaused} onDiscard={discard} />

      {markers.length > 0 && (
        <div className="chips">
          {markers.map((marker, index) => (
            <span key={`${marker.label}-${index}`}>
              {elapsedLabel(marker.time_seconds * 1000)} · {marker.label}
              <button
                onClick={() => setMarkers((current) => current.filter((_, position) => position !== index))}
                aria-label={`Remove ${marker.label}`}
              >×</button>
            </span>
          ))}
        </div>
      )}

      {error && <p className="err" role="alert">{error}</p>}
    </section>

    {!context.workspace && (
      <section className="panel">
        <label className="field-label" htmlFor="capture-title">Recording name <span className="dim">optional</span></label>
        <input
          id="capture-title"
          className="field"
          value={title}
          maxLength="180"
          placeholder="Leave blank for a dated lecture"
          disabled={isFinalizing}
          onChange={(event) => setTitle(event.target.value)}
        />
      </section>
    )}

    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Notes</h2>
        <button className="linkbtn" onClick={() => fileInputRef.current?.click()}>Add file</button>
        <input
          ref={fileInputRef} hidden type="file" multiple
          accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx"
          onChange={(event) => setFiles([...files, ...event.target.files])}
        />
      </div>
      <textarea
        className="field"
        value={notes}
        maxLength="100000"
        placeholder="Key idea, question, assignment, or something to revisit…"
        onChange={(event) => setNotes(event.target.value)}
      />
      {files.length > 0 && (
        <ul className="files">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="file">
              <span className="file-kind">{file.name.split('.').at(-1)?.slice(0, 4).toUpperCase()}</span>
              <span><strong>{file.name}</strong></span>
              <button
                className="iconbtn ghost"
                onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}
                aria-label={`Remove ${file.name}`}
              ><Icon name="close" /></button>
            </li>
          ))}
        </ul>
      )}
    </section>

    {hasLiveTranscript && (
      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">Live transcript</h2></div>
        <div className="live-body" aria-live="polite">
          {transcript.text || transcript.interim
            ? <p>{transcript.text}{transcript.interim && <em> {transcript.interim}</em>}</p>
            : <p className="dim">{isRecording ? 'Listening…' : 'Starts when you do.'}</p>}
        </div>
      </section>
    )}

    <p className="capture-note">
      {hasLiveTranscript
        ? <>Transcript: <strong>on this device</strong></>
        : isNativeShell
          // Saying "high accuracy" here would promise a transcript this
          // build cannot produce at all.
          ? <>Transcript: <strong>not in this build</strong> — audio and notes are saved</>
          : <>Final transcript: <strong>high accuracy</strong></>}
    </p>
  </main>;
}
