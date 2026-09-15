import { useEffect, useRef, useState } from 'react';
import { libraryApi, uploadRecording } from '../lib/api';
import DiscardSlider from './DiscardSlider';
import Waveform from './Waveform';

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
  function startClock() { window.clearInterval(timerRef.current); startedAtRef.current = performance.now(); timerRef.current = window.setInterval(updateClock, 100); }
  function pauseClock() { carriedMsRef.current = currentTime(); startedAtRef.current = 0; updateClock(); window.clearInterval(timerRef.current); }
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
      setError('Microphone access was not granted. Allow it in your browser, then try again.');
    }
  }

  function pauseOrResume() {
    const recorder = recorderRef.current;
    if (!recorder) return;
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
    if (!recorder || !chunksRef.current.length) return;
    setPhase('saving');
    setError('');
    const savedElapsed = currentTime();
    pauseClock();
    const blob = await new Promise((resolve) => {
      recorder.addEventListener('stop', () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })), { once: true });
      recorder.stop();
    });
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setLiveStream(null);
    try {
      const recording = await uploadRecording({ blob, title, captureNotes: notes, folderId: context.workspace ? undefined : context.folder?.id, workspaceId: context.workspace?.id });
      await Promise.all(markers.map((marker) => libraryApi.addMarker(recording.id, marker)));
      await Promise.all(files.map((file) => libraryApi.uploadMaterial(file, { workspaceId: recording.workspace_id })));
      notify(`Lecture saved. High-accuracy transcription is now running for ${elapsedLabel(savedElapsed)} of audio.`);
      setPhase('saved');
      // A successful action should be visible before we take the student back to notes.
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
    ? ['Recording discarded', 'Nothing was saved.']
    : phase === 'saved'
      ? ['Recording saved', 'Transcribing with the high-accuracy model…']
      : ['Finishing your recording', 'Saving your audio and notes…'];
  return <main className="page capture-page">
    <header className="capture-heading"><button className="back-link" onClick={onCancel} disabled={isFinalizing}>‹ Back</button><p className="eyebrow">{context.workspace ? 'Continuing lecture' : `New lecture · ${location}`}</p><h1>{context.workspace ? context.workspace.title : 'Capture a lecture'}</h1>{!context.workspace && <label className="capture-title-field">Recording name <small>optional</small><input value={title} maxLength="180" onChange={(event) => setTitle(event.target.value)} placeholder="Leave blank for a dated lecture" disabled={isFinalizing} /></label>}</header>
    <div className="capture-grid">
      <section className={`capture-station ${phase}`}>
        {isFinalizing && <div className={`save-veil ${phase === 'discarding' ? 'discard-veil' : ''} ${phase === 'saved' ? 'saved-veil' : ''}`} role="status" aria-live="polite">
          <span className="save-symbol" aria-hidden="true">
            {phase === 'discarding'
              ? <svg viewBox="0 0 52 52"><path d="M17 18h18M22 18v-4h8v4M20 22v14m6-14v14m6-14v14M18 18l2 22h12l2-22" /></svg>
              : phase === 'saved'
                ? <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" /><path d="M14 27l8 8 16-16" /></svg>
                : <svg className="save-spinner" viewBox="0 0 52 52"><circle cx="26" cy="26" r="22" /></svg>}
          </span>
          <strong>{completionCopy[0]}</strong>
          <span>{completionCopy[1]}</span>
        </div>}
        <div className="transport" data-phase={phase}>
          <div className="phase-label">{phase === 'ready' ? 'Ready' : phase === 'recording' ? 'Recording' : phase === 'paused' ? 'Paused' : phase === 'discarding' ? 'Discarding' : phase === 'saved' ? 'Saved' : 'Saving'}</div>
          <div className="recording-timer">{elapsedLabel(elapsed)}</div>
          <Waveform stream={liveStream} phase={phase} />
        </div>
        {isRecording && <div className="marker-control"><input value={markerLabel} maxLength="120" onChange={(event) => setMarkerLabel(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && addMarker()} placeholder="What should you revisit?" /><button className="button ghost" onClick={addMarker}>＋ Marker</button></div>}
        {markers.length > 0 && <div className="marker-pills">{markers.map((marker, index) => <span key={`${marker.label}-${index}`}>● {elapsedLabel(marker.time_seconds * 1000)} · {marker.label}<button onClick={() => setMarkers((current) => current.filter((_, position) => position !== index))} aria-label={`Remove ${marker.label}`}>×</button></span>)}</div>}
        <div className="capture-controls">
          <div className="transport-controls">
            <button
              className="shutter"
              data-phase={phase}
              onClick={phase === 'ready' ? start : pauseOrResume}
              disabled={phase === 'saving'}
              aria-label={phase === 'ready' ? 'Start recording' : isPaused ? 'Resume recording' : 'Pause recording'}
            ><span className="shutter-glyph" aria-hidden="true" /></button>
            <div className={`finish-group ${isPaused ? 'shown' : ''}`} inert={!isPaused}>
              <button className="finish-button" onClick={done} aria-label="Done — save and transcribe">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </button>
              <span className="finish-caption" aria-hidden="true">Done</span>
            </div>
          </div>
          <p className="transport-hint">{phase === 'ready' ? 'Tap to record' : isRecording ? 'Tap to pause' : isPaused ? 'Tap to resume, or slide to discard' : 'Saving…'}</p>
          <DiscardSlider open={isPaused} onDiscard={discard} />
        </div>
        {phase === 'ready' && <button className="text-button cancel-capture" onClick={onCancel}>Cancel</button>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
      <aside className="capture-notes">
        <div className="section-heading"><div><h2>Notes</h2></div></div>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength="100000" placeholder="Key idea, question, assignment, or something to revisit…" />
        <div className="attachment-picker"><strong>Files</strong><button className="button ghost" onClick={() => fileInputRef.current?.click()}>＋ Add file</button><input ref={fileInputRef} hidden type="file" multiple accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx" onChange={(event) => setFiles([...files, ...event.target.files])} /></div>
        {files.length > 0 && <ul className="pending-files">{files.map((file, index) => <li key={`${file.name}-${index}`}>{file.name}<button onClick={() => setFiles((current) => current.filter((_, position) => position !== index))} aria-label={`Remove ${file.name}`}>×</button></li>)}</ul>}
        <p className="quality-note">Final transcript: <strong>high accuracy</strong></p>
      </aside>
    </div>
  </main>;
}
