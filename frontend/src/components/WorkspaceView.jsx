import { useEffect, useRef, useState } from 'react';
import { libraryApi } from '../lib/api';
import FlashcardDeck from './FlashcardDeck';
import StudyPanel from './StudyPanel';
import SyncedTranscript from './SyncedTranscript';
import WaveScrubber from './WaveScrubber';
import { FileList } from './LibraryView';
import { Icon } from './Icon';

const mmss = (seconds = 0) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const longDate = (date) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

export default function WorkspaceView({
  workspace, courseName = 'Unfiled', onBack, onContinue, onReload, onDelete, notify, pendingSeek, onSeekHandled,
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [tab, setTab] = useState('recording');
  const [notes, setNotes] = useState(workspace.note_body ?? '');
  const [selectedId, setSelectedId] = useState(workspace.sessions[0]?.id ?? null);
  const [savingNotes, setSavingNotes] = useState(false);
  const [filesBusy, setFilesBusy] = useState(false);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [markerLabel, setMarkerLabel] = useState('');
  const [retranscribing, setRetranscribing] = useState(false);
  const audioRef = useRef(null);
  const scrubRef = useRef(false);
  const fileRef = useRef(null);

  const selected = workspace.sessions.find((session) => session.id === selectedId) ?? workspace.sessions[0];
  const status = selected?.transcription_status;
  const statusCopy = status === 'ready' ? 'Transcript ready'
    : status === 'failed' ? 'Transcript failed'
      : `Transcribing · ${Math.round((selected?.transcription_progress ?? 0) * 100)}%`;

  useEffect(() => {
    setNotes(workspace.note_body ?? '');
    setSelectedId((current) => workspace.sessions.some((session) => session.id === current) ? current : workspace.sessions[0]?.id ?? null);
  }, [workspace]);
  useEffect(() => {
    if (!workspace.sessions.some((session) => ['pending', 'running'].includes(session.transcription_status))) return undefined;
    const timer = window.setInterval(onReload, 3000);
    return () => window.clearInterval(timer);
  }, [workspace, onReload]);
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = SPEEDS[speedIndex]; }, [speedIndex, selected?.id]);
  useEffect(() => { setPosition(0); setDuration(selected?.duration_seconds ?? 0); }, [selected?.id, selected?.duration_seconds]);
  useEffect(() => {
    if (!pendingSeek?.lectureId || pendingSeek.lectureId !== selected?.id || !audioRef.current) return;
    const player = audioRef.current;
    const apply = () => { player.currentTime = pendingSeek.seconds; player.play().catch(() => {}); };
    if (player.readyState >= 1) apply(); else player.addEventListener('loadedmetadata', apply, { once: true });
    onSeekHandled?.();
  }, [pendingSeek, selected?.id, onSeekHandled]);

  function seek(seconds) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(duration || Infinity, seconds));
    audioRef.current.play().catch(() => {});
  }
  function togglePlay() {
    const player = audioRef.current;
    if (!player) return;
    if (player.paused) player.play().catch(() => {}); else player.pause();
  }
  async function saveNotes() {
    setSavingNotes(true);
    try { await libraryApi.saveNotes(workspace.id, notes); notify('Notes saved.'); onReload(); }
    catch (caught) { notify(caught.message, 'error'); }
    finally { setSavingNotes(false); }
  }
  async function uploadFiles(files) {
    if (!files?.length) return;
    setFilesBusy(true);
    try { await Promise.all([...files].map((file) => libraryApi.uploadMaterial(file, { workspaceId: workspace.id }))); notify('File added.'); onReload(); }
    catch (caught) { notify(caught.message, 'error'); }
    finally { setFilesBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function deleteMaterial(material) {
    if (!window.confirm(`Delete ${material.original_filename}?`)) return;
    try { await libraryApi.deleteMaterial(material.id); onReload(); } catch (caught) { notify(caught.message, 'error'); }
  }
  async function removeWorkspace() {
    if (!window.confirm(`Delete “${workspace.title}” and every recording inside it? This cannot be undone.`)) return;
    try { await libraryApi.deleteWorkspace(workspace.id); notify('Lecture deleted.'); onDelete(); }
    catch (caught) { notify(caught.message, 'error'); }
  }
  async function addMarker(event) {
    event.preventDefault();
    if (!markerLabel.trim() || !selected) return;
    try { await libraryApi.addMarker(selected.id, { label: markerLabel.trim(), time_seconds: audioRef.current?.currentTime ?? 0 }); setMarkerLabel(''); notify('Marker added.'); onReload(); }
    catch (caught) { notify(caught.message, 'error'); }
  }
  async function removeMarker(marker) {
    try { await libraryApi.deleteMarker(selected.id, marker.id); onReload(); }
    catch (caught) { notify(caught.message, 'error'); }
  }
  async function retranscribe() {
    setRetranscribing(true);
    try { await libraryApi.retranscribe(selected.id); notify('Transcription restarted.'); onReload(); }
    catch (caught) { notify(caught.message, 'error'); }
    finally { setRetranscribing(false); }
  }

  return <main className="lyrics-page">
    <header className="lyrics-topbar">
      <button className="lyrics-back" onClick={onBack} aria-label="Back to folder"><Icon name="back" /></button>
      <div><h1>{workspace.title}</h1><p>{courseName} · {selected ? longDate(selected.created_at) : 'No recordings yet'}</p></div>
      <button className={`lyrics-more ${detailsOpen ? 'open' : ''}`} onClick={() => setDetailsOpen((open) => !open)} aria-label="Lecture options" aria-expanded={detailsOpen}><Icon name="more" /></button>
    </header>

    <section className="lyrics-body">
      {selected ? <>
        <p className="lyrics-take-name">{workspace.title}</p>
        <SyncedTranscript segments={selected.segments} currentSeconds={position} status={status} onSeek={seek} />
      </> : <div className="lyrics-no-audio"><Icon name="mic" /><strong>No recordings yet</strong><p>Record a take to see the transcript here.</p></div>}
    </section>

    {selected && <section className="lyrics-player" aria-label="Recording controls">
      <audio ref={audioRef} src={selected.audio_url} preload="metadata" onLoadedMetadata={(event) => { const value = event.currentTarget.duration; if (Number.isFinite(value) && value > 0) setDuration(value); }} onTimeUpdate={(event) => { if (!scrubRef.current) setPosition(event.currentTarget.currentTime); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <WaveScrubber durationSeconds={duration} currentSeconds={position} segments={selected.segments} playing={playing} variant="spectrum" onScrub={(seconds) => { scrubRef.current = true; setPosition(seconds); }} onScrubEnd={() => { if (audioRef.current) audioRef.current.currentTime = position; scrubRef.current = false; }} />
      <div className="lyrics-progress"><span>{mmss(position)}</span><span>{statusCopy}</span><span>-{mmss(Math.max(0, duration - position))}</span></div>
      <div className="lyrics-controls">
        <button onClick={() => seek(position - 15)} aria-label="Back 15 seconds"><Icon name="back15" /></button>
        <button className="lyrics-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} /></button>
        <button onClick={() => seek(position + 15)} aria-label="Forward 15 seconds"><Icon name="fwd15" /></button>
      </div>
      <div className="lyrics-tools">
        <button onClick={() => setSpeedIndex((index) => (index + 1) % SPEEDS.length)}>{SPEEDS[speedIndex]}×</button>
        <button onClick={() => setDetailsOpen(true)} aria-label="Open markers"><Icon name="bookmark" /></button>
        <button onClick={removeWorkspace} aria-label="Delete lecture"><Icon name="trash" /></button>
      </div>
    </section>}

    {!selected && <button className="lyrics-record-button" onClick={onContinue}><Icon name="mic" />Start recording</button>}

    {detailsOpen && <section className="lyrics-details">
      <div className="lyrics-detail-actions">
        <button className="primary-record-button" onClick={onContinue}><Icon name="mic" />Continue recording</button>
        <button className="lyrics-file-button" onClick={() => fileRef.current?.click()}><Icon name="file" />{filesBusy ? 'Adding…' : 'Add file'}</button>
        <input ref={fileRef} hidden type="file" multiple accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx" onChange={(event) => uploadFiles(event.target.files)} />
      </div>
      <nav className="lyrics-tabs" aria-label="Lecture details">
        <button className={tab === 'recording' ? 'active' : ''} onClick={() => setTab('recording')}>Markers</button>
        <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>Notes & study</button>
      </nav>
      {tab === 'recording' && <div className="lyrics-detail-panel">
        {status === 'failed' && <button className="lyrics-retry" onClick={retranscribe} disabled={retranscribing}>{retranscribing ? 'Starting…' : 'Retry transcription'}</button>}
        <div className="marks">
          {selected?.markers?.map((marker) => <span key={marker.id} className="mark"><button onClick={() => seek(marker.time_seconds)}>{mmss(marker.time_seconds)} · {marker.label}</button><button className="mark-x" onClick={() => removeMarker(marker)} aria-label={`Remove ${marker.label}`}>×</button></span>)}
          {!selected?.markers?.length && <p className="reference-empty">No marked moments yet.</p>}
        </div>
        {selected && <form className="mark-form" onSubmit={addMarker}><input className="field" value={markerLabel} maxLength="120" placeholder="Mark this moment…" onChange={(event) => setMarkerLabel(event.target.value)} /><button className="btn" type="submit" disabled={!markerLabel.trim()}>Add</button></form>}
      </div>}
      {tab === 'notes' && <>
        <section className="lyrics-detail-panel"><div className="panel-head"><h2 className="panel-title">Notes</h2><button className="linkbtn" onClick={saveNotes} disabled={savingNotes}>{savingNotes ? 'Saving…' : 'Save'}</button></div><textarea className="field" value={notes} maxLength="100000" placeholder="Capture the ideas you want to remember…" onChange={(event) => setNotes(event.target.value)} /></section>
        <FlashcardDeck workspace={workspace} onReload={onReload} notify={notify} />
        <StudyPanel workspace={workspace} onReload={onReload} notify={notify} />
        {workspace.materials.length > 0 && <section className="lyrics-detail-panel"><div className="panel-head"><h2 className="panel-title">Files</h2></div><FileList materials={workspace.materials} onDelete={deleteMaterial} /></section>}
      </>}
    </section>}
  </main>;
}
