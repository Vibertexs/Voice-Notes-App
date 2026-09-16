import { useEffect, useRef, useState } from 'react';
import { libraryApi } from '../lib/api';
import CoverArt from './CoverArt';
import FlashcardDeck from './FlashcardDeck';
import StudyPanel from './StudyPanel';
import SyncedTranscript from './SyncedTranscript';
import WaveScrubber from './WaveScrubber';
import { FileList } from './LibraryView';
import { Icon } from './Icon';

const mmss = (seconds = 0) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const longDate = (date) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
const shortDate = (date) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(date));

const remaining = (seconds) => {
  if (seconds == null) return 'estimating…';
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `~${Math.max(10, Math.ceil(total / 10) * 10)}s left`;
  const minutes = Math.round(total / 60);
  return `~${minutes} min left`;
};

const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

export default function WorkspaceView({
  workspace, color = 'slate', onBack, onContinue, onReload, onDelete, notify, pendingSeek, onSeekHandled,
}) {
  const [tab, setTab] = useState('recording');
  const [title, setTitle] = useState(workspace.title);
  const [notes, setNotes] = useState(workspace.note_body ?? '');
  const [selectedId, setSelectedId] = useState(workspace.sessions[0]?.id ?? null);
  const [savingNotes, setSavingNotes] = useState(false);
  const [filesBusy, setFilesBusy] = useState(false);
  const fileRef = useRef(null);

  // player state
  const audioRef = useRef(null);
  const scrubbingRef = useRef(false);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(0);
  const [markerLabel, setMarkerLabel] = useState('');
  const [retranscribing, setRetranscribing] = useState(false);

  const selected = workspace.sessions.find((session) => session.id === selectedId) ?? workspace.sessions[0];

  useEffect(() => {
    setTitle(workspace.title);
    setNotes(workspace.note_body ?? '');
    setSelectedId((current) => workspace.sessions.some((s) => s.id === current) ? current : workspace.sessions[0]?.id ?? null);
  }, [workspace]);

  // Arriving from a search result: open that take and seek to the moment.
  useEffect(() => {
    if (!pendingSeek?.lectureId) return;
    if (!workspace.sessions.some((session) => session.id === pendingSeek.lectureId)) return;
    setSelectedId(pendingSeek.lectureId);
    setTab('recording');
  }, [pendingSeek, workspace.sessions]);

  useEffect(() => {
    if (!workspace.sessions.some((s) => ['pending', 'running'].includes(s.transcription_status))) return undefined;
    const timer = window.setInterval(onReload, 3000);
    return () => window.clearInterval(timer);
  }, [workspace, onReload]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[speedIndex];
  }, [speedIndex, selected?.id]);

  useEffect(() => {
    setPosition(0);
    setDuration(selected?.duration_seconds ?? 0);
  }, [selected?.id, selected?.duration_seconds]);

  useEffect(() => {
    const seconds = pendingSeek?.lectureId === selected?.id ? pendingSeek?.seconds : null;
    if (seconds == null || !audioRef.current) return;
    const player = audioRef.current;
    const apply = () => { player.currentTime = seconds; player.play().catch(() => {}); };
    if (player.readyState >= 1) apply();
    else player.addEventListener('loadedmetadata', apply, { once: true });
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

  async function saveTitle() {
    if (!title.trim() || title === workspace.title) return;
    try { await libraryApi.updateWorkspace(workspace.id, { title: title.trim() }); notify('Title saved.'); onReload(); }
    catch (caught) { notify(caught.message, 'error'); setTitle(workspace.title); }
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
    try {
      await Promise.all([...files].map((file) => libraryApi.uploadMaterial(file, { workspaceId: workspace.id })));
      notify('File added.'); onReload();
    } catch (caught) { notify(caught.message, 'error'); }
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
    const label = markerLabel.trim();
    if (!label || !selected) return;
    try {
      await libraryApi.addMarker(selected.id, { label, time_seconds: audioRef.current?.currentTime ?? 0 });
      setMarkerLabel(''); notify('Marker added.'); onReload();
    } catch (caught) { notify(caught.message, 'error'); }
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

  const status = selected?.transcription_status;
  const statusCopy = status === 'ready' ? 'Transcript ready'
    : status === 'failed' ? 'Transcript failed'
    : `Transcribing · ${Math.round((selected?.transcription_progress ?? 0) * 100)}%`;
  const statusTone = status === 'ready' ? '' : status === 'failed' ? 'bad' : 'warn';

  return <main className="player-screen">
    {/* ---- Artwork stage with glass card ------------------ */}
    <section className="stage">
      <CoverArt id={workspace.id} color={color} />
      <div className="stage-top">
        <button className="blur-btn" onClick={onBack} aria-label="Back to library"><Icon name="back" /></button>
        <div className="stage-actions">
          <button className="blur-btn" onClick={() => fileRef.current?.click()} aria-label={filesBusy ? 'Adding file' : 'Add file'}>
            <Icon name={filesBusy ? 'upload' : 'file'} />
          </button>
          <button className="blur-btn danger" onClick={removeWorkspace} aria-label="Delete lecture"><Icon name="trash" /></button>
          <input ref={fileRef} hidden type="file" multiple accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx" onChange={(event) => uploadFiles(event.target.files)} />
        </div>
      </div>

      <div className="glass">
        <input
          className="glass-title"
          value={title}
          title={title}
          aria-label="Lecture title"
          maxLength="180"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={saveTitle}
        />
        <p className="glass-sub">
          {workspace.sessions.length} recording{workspace.sessions.length === 1 ? '' : 's'}
          {selected ? ` · ${shortDate(selected.created_at)}` : ''}
        </p>

        {selected ? <>
          <audio
            ref={audioRef}
            src={selected.audio_url}
            preload="metadata"
            onLoadedMetadata={(event) => {
              const value = event.currentTarget.duration;
              if (Number.isFinite(value) && value > 0) setDuration(value);
            }}
            onTimeUpdate={(event) => { if (!scrubbingRef.current) setPosition(event.currentTarget.currentTime); }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
          <div className="glass-wave">
            <WaveScrubber
              durationSeconds={duration}
              currentSeconds={position}
              segments={selected.segments}
              playing={playing}
              onScrub={(seconds) => { scrubbingRef.current = true; setPosition(seconds); }}
              onScrubEnd={() => {
                if (audioRef.current) audioRef.current.currentTime = position;
                scrubbingRef.current = false;
              }}
            />
          </div>
          <div className="glass-meta">
            <span>{mmss(position)} / {mmss(duration)}</span>
            <span className={`state ${statusTone}`}>
              {statusCopy}
              {status !== 'ready' && status !== 'failed' && selected.transcription_eta_seconds != null
                ? ` · ${remaining(selected.transcription_eta_seconds)}` : ''}
            </span>
          </div>
        </> : (
          <p className="glass-meta"><span>No audio in this lecture yet.</span></p>
        )}
      </div>
    </section>

    {/* ---- Transport -------------------------------------- */}
    {selected && (
      <div className="transport-dock">
        <button className="tbtn" onClick={() => seek(position - 15)} aria-label="Back 15 seconds">15</button>
        <button className="tbtn play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <button className="tbtn" onClick={() => seek(position + 15)} aria-label="Forward 15 seconds">15</button>
        <button
          className="tbtn"
          onClick={() => setSpeedIndex((current) => (current + 1) % SPEEDS.length)}
          aria-label={`Playback speed ${SPEEDS[speedIndex]}x`}
        >{SPEEDS[speedIndex]}×</button>
      </div>
    )}

    <div className="stage-cta">
      <button className="btn primary block" onClick={onContinue}>
        <span className="dot" />Continue recording
      </button>
    </div>

    {/* ---- Takes ------------------------------------------ */}
    {workspace.sessions.length > 1 && (
      <div className="takes">
        {workspace.sessions.map((session, index) => (
          <button
            key={session.id}
            className={`take ${session.id === selected?.id ? 'active' : ''}`}
            onClick={() => setSelectedId(session.id)}
          >
            <strong>Take {index + 1}</strong>
            <small>{longDate(session.created_at)}</small>
          </button>
        ))}
      </div>
    )}

    {/* ---- Tabs ------------------------------------------- */}
    <nav className="seg" aria-label="Lecture sections">
      {[['recording', 'Transcript'], ['notes', 'Notes & study']].map(([id, label]) => (
        <button key={id} className={`seg-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
      ))}
    </nav>

    {tab === 'recording' && selected && <>
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Transcript</h2>
          {status === 'failed' && (
            <button className="linkbtn" onClick={retranscribe} disabled={retranscribing}>
              {retranscribing ? 'Starting…' : 'Try again'}
            </button>
          )}
        </div>
        <SyncedTranscript
          segments={selected.segments}
          currentSeconds={position}
          status={status}
          onSeek={seek}
        />
      </section>

      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">Markers</h2></div>
        <div className="marks">
          {selected.markers?.map((marker) => (
            <span key={marker.id} className="mark">
              <button onClick={() => seek(marker.time_seconds)}>
                {mmss(marker.time_seconds)} · {marker.label}
              </button>
              <button className="mark-x" onClick={() => removeMarker(marker)} aria-label={`Remove ${marker.label}`}>×</button>
            </span>
          ))}
          {!selected.markers?.length && <p className="dim">Nothing marked in this take.</p>}
          <form className="mark-form" onSubmit={addMarker}>
            <input
              className="field"
              value={markerLabel}
              maxLength="120"
              placeholder="Mark this moment…"
              onChange={(event) => setMarkerLabel(event.target.value)}
            />
            <button className="btn" type="submit" disabled={!markerLabel.trim()}>Add</button>
          </form>
        </div>
      </section>
    </>}

    {tab === 'recording' && !selected && (
      <section className="panel">
        <div className="empty">
          <span className="empty-orb"><Icon name="mic" /></span>
          <h3>No recordings yet</h3>
          <p>Start a take and it will show up here with its transcript.</p>
          <button className="btn primary" onClick={onContinue}>Start recording</button>
        </div>
      </section>
    )}

    {tab === 'notes' && <>
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Notes</h2>
          <button className="linkbtn" onClick={saveNotes} disabled={savingNotes}>
            {savingNotes ? 'Saving…' : 'Save'}
          </button>
        </div>
        <textarea
          className="field"
          value={notes}
          maxLength="100000"
          placeholder="Start with the big idea, then add details from class…"
          onChange={(event) => setNotes(event.target.value)}
        />
      </section>

      <FlashcardDeck workspace={workspace} onReload={onReload} notify={notify} />
      <StudyPanel workspace={workspace} onReload={onReload} notify={notify} />

      {workspace.materials.length > 0 && (
        <section className="panel">
          <div className="panel-head"><h2 className="panel-title">Files</h2></div>
          <FileList materials={workspace.materials} onDelete={deleteMaterial} />
        </section>
      )}
    </>}
  </main>;
}
