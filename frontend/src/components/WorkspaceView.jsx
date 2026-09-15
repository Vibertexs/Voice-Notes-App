import { useEffect, useRef, useState } from 'react';
import { libraryApi } from '../lib/api';
import StudyPanel from './StudyPanel';
import { MaterialList } from './LibraryView';

const formatTime = (seconds = 0) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const formatRemaining = (seconds) => {
  if (seconds == null) return 'working out how long this will take…';
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `about ${Math.max(10, Math.ceil(total / 10) * 10)} seconds left`;
  const minutes = Math.round(total / 60);
  return `about ${minutes} minute${minutes === 1 ? '' : 's'} left`;
};
const formatDate = (date) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));

const PLAYBACK_SPEEDS = [1, 1.25, 1.5, 1.75, 2];

function RecordingReview({ session, onUpdate, notify, seekTo, onSeekHandled }) {
  const audioRef = useRef(null);
  const [retranscribing, setRetranscribing] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [markerLabel, setMarkerLabel] = useState('');

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = PLAYBACK_SPEEDS[speedIndex];
  }, [speedIndex, session.id]);

  useEffect(() => {
    if (seekTo == null || !audioRef.current) return;
    const player = audioRef.current;
    // currentTime only sticks once the browser knows the duration.
    const apply = () => { player.currentTime = seekTo; player.play().catch(() => {}); };
    if (player.readyState >= 1) apply();
    else player.addEventListener('loadedmetadata', apply, { once: true });
    onSeekHandled?.();
  }, [seekTo, session.id, onSeekHandled]);

  function seek(seconds) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    audioRef.current.play().catch(() => {});
  }

  async function addMarker(event) {
    event.preventDefault();
    const label = markerLabel.trim();
    if (!label) return;
    try {
      await libraryApi.addMarker(session.id, {
        label,
        time_seconds: audioRef.current?.currentTime ?? 0,
      });
      setMarkerLabel('');
      notify('Marker added.');
      onUpdate();
    } catch (caught) { notify(caught.message, 'error'); }
  }

  async function removeMarker(marker) {
    try { await libraryApi.deleteMarker(session.id, marker.id); onUpdate(); }
    catch (caught) { notify(caught.message, 'error'); }
  }

  async function retranscribe() {
    setRetranscribing(true);
    try { await libraryApi.retranscribe(session.id); notify('High-accuracy transcription restarted.'); onUpdate(); }
    catch (caught) { notify(caught.message, 'error'); } finally { setRetranscribing(false); }
  }

  return <section className="review-card">
    <div className="session-meta"><span>{formatDate(session.created_at)}</span><span className={`transcription-state ${session.transcription_status}`}>{session.transcription_status === 'ready' ? 'Transcript ready' : session.transcription_status === 'failed' ? 'Transcription needs attention' : 'Transcribing locally…'}</span></div>
    <div className="player-row">
      <audio ref={audioRef} controls src={session.audio_url}>Your browser cannot play this recording.</audio>
      <button
        className="speed-button"
        onClick={() => setSpeedIndex((current) => (current + 1) % PLAYBACK_SPEEDS.length)}
        aria-label={`Playback speed ${PLAYBACK_SPEEDS[speedIndex]} times`}
      >{PLAYBACK_SPEEDS[speedIndex]}×</button>
    </div>
    {session.transcription_status !== 'ready' && <div className="progress-message"><span className="progress-track"><i style={{ width: `${Math.round((session.transcription_progress ?? 0) * 100)}%` }} /></span><p>{session.transcription_status === 'failed'
        ? 'The final transcription did not finish.'
        : `${Math.round((session.transcription_progress ?? 0) * 100)}% · ${formatRemaining(session.transcription_eta_seconds)}`}</p>{session.transcription_status === 'failed' && <button className="text-button" onClick={retranscribe} disabled={retranscribing}>{retranscribing ? 'Starting…' : 'Try again'}</button>}</div>}
    <div className="transcript"><div className="section-heading"><h3>Transcript</h3></div>{session.segments?.length ? <ol>{session.segments.map((segment, index) => <li key={`${segment.start_seconds}-${index}`}><button onClick={() => seek(segment.start_seconds)}><time>{formatTime(segment.start_seconds)}</time><span>{segment.text}</span></button></li>)}</ol> : <p className="empty-copy">{session.transcription_status === 'ready' ? 'No speech detected.' : 'Transcribing…'}</p>}</div>
    <div className="saved-markers">
      <h3>Markers</h3>
      {session.markers?.length
        ? session.markers.map((marker) => <span key={marker.id} className="marker-chip">
            <button onClick={() => seek(marker.time_seconds)}>● {formatTime(marker.time_seconds)} · {marker.label}</button>
            <button className="marker-remove" onClick={() => removeMarker(marker)} aria-label={`Remove marker ${marker.label}`}>×</button>
          </span>)
        : null}
      <form className="marker-form" onSubmit={addMarker}>
        <input
          value={markerLabel}
          maxLength="120"
          placeholder="Mark this moment…"
          onChange={(event) => setMarkerLabel(event.target.value)}
        />
        <button className="button ghost" type="submit" disabled={!markerLabel.trim()}>Add marker</button>
      </form>
    </div>
  </section>;
}

export default function WorkspaceView({ workspace, onBack, onContinue, onReload, onDelete, notify, pendingSeek, onSeekHandled }) {
  // Audio is the center of the product, so opening a lecture starts at its recordings.
  const [tab, setTab] = useState('notes');
  const [title, setTitle] = useState(workspace.title);
  const [notes, setNotes] = useState(workspace.note_body ?? '');
  const [selectedId, setSelectedId] = useState(workspace.sessions[0]?.id ?? null);
  // Arriving from a search result: open that recording on the Recordings tab.
  useEffect(() => {
    if (!pendingSeek?.lectureId) return;
    if (!workspace.sessions.some((session) => session.id === pendingSeek.lectureId)) return;
    setSelectedId(pendingSeek.lectureId);
    setTab('review');
  }, [pendingSeek, workspace.sessions]);
  const [saving, setSaving] = useState(false);
  const [filesBusy, setFilesBusy] = useState(false);
  const materialInputRef = useRef(null);

  useEffect(() => { setTitle(workspace.title); setNotes(workspace.note_body ?? ''); setSelectedId((current) => workspace.sessions.some((session) => session.id === current) ? current : workspace.sessions[0]?.id ?? null); }, [workspace]);
  useEffect(() => {
    if (!workspace.sessions.some((session) => ['pending', 'running'].includes(session.transcription_status))) return undefined;
    const timer = window.setInterval(onReload, 3000);
    return () => window.clearInterval(timer);
  }, [workspace, onReload]);

  async function saveTitle() {
    if (!title.trim() || title === workspace.title) return;
    try { await libraryApi.updateWorkspace(workspace.id, { title: title.trim() }); notify('Lecture title saved.'); onReload(); } catch (caught) { notify(caught.message, 'error'); setTitle(workspace.title); }
  }
  async function saveNotes() {
    setSaving(true);
    try { await libraryApi.saveNotes(workspace.id, notes); notify('Notes saved.'); onReload(); } catch (caught) { notify(caught.message, 'error'); } finally { setSaving(false); }
  }
  async function uploadFiles(files) {
    if (!files?.length) return;
    setFilesBusy(true);
    try { await Promise.all([...files].map((file) => libraryApi.uploadMaterial(file, { workspaceId: workspace.id }))); notify('File added to this lecture.'); onReload(); } catch (caught) { notify(caught.message, 'error'); } finally { setFilesBusy(false); if (materialInputRef.current) materialInputRef.current.value = ''; }
  }
  async function deleteMaterial(material) {
    if (!window.confirm(`Delete ${material.original_filename}?`)) return;
    try { await libraryApi.deleteMaterial(material.id); onReload(); } catch (caught) { notify(caught.message, 'error'); }
  }
  async function removeWorkspace() {
    if (!window.confirm(`Delete “${workspace.title}” and every recording inside it? This cannot be undone.`)) return;
    try { await libraryApi.deleteWorkspace(workspace.id); notify('Lecture deleted.'); onDelete(); } catch (caught) { notify(caught.message, 'error'); }
  }
  const selected = workspace.sessions.find((session) => session.id === selectedId) ?? workspace.sessions[0];

  return <main className="page workspace-page">
    <header className="workspace-header"><div><button className="back-link" onClick={onBack}><svg className="back-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="M12 4.5 6.5 10l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>Back to library</button><input className="title-input" title={title} aria-label="Lecture title" value={title} maxLength="180" onChange={(event) => setTitle(event.target.value)} onBlur={saveTitle} /></div><div className="header-actions">
      <button className="button quiet" onClick={() => materialInputRef.current?.click()}>{filesBusy ? 'Adding…' : 'Add file'}</button>
      <button className="button quiet danger" onClick={removeWorkspace}>Delete</button>
      <button className="button primary" onClick={onContinue}><span className="rec-dot" aria-hidden="true" />Continue recording</button>
      <input ref={materialInputRef} hidden type="file" multiple accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx" onChange={(event) => uploadFiles(event.target.files)} />
    </div></header>
    <nav className="tab-list" aria-label="Lecture sections">{[['review', `Recordings (${workspace.sessions.length})`], ['notes', 'Notes & study']].map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'notes' && <section className="notes-study-layout"><StudyPanel workspace={workspace} onReload={onReload} notify={notify} />{workspace.materials.length > 0 && <section className="lecture-files"><h3>Files</h3><MaterialList materials={workspace.materials} onDelete={deleteMaterial} /></section>}<article className="note-editor"><div className="section-heading"><h2>Notes</h2><button className="button ghost" onClick={saveNotes} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></div><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength="100000" placeholder="Start with the big idea, then add details from class…" /></article></section>}
    {tab === 'review' && <section className="review-layout"><aside className="session-list">{workspace.sessions.map((session) => <button key={session.id} className={session.id === selected?.id ? 'selected' : ''} onClick={() => setSelectedId(session.id)}><strong>{session.title}</strong><small>{formatDate(session.created_at)}</small></button>)}</aside>{selected ? <RecordingReview session={selected} onUpdate={onReload} notify={notify} seekTo={pendingSeek?.lectureId === selected.id ? pendingSeek.seconds : null} onSeekHandled={onSeekHandled} /> : <div className="empty-state"><h3>No recordings yet</h3><button className="button primary" onClick={onContinue}>Continue recording</button></div>}</section>}
  </main>;
}
