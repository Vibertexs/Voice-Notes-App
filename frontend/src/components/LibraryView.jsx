import { useRef, useState } from 'react';
import ClassCard from './ClassCard';
import CoverArt from './CoverArt';
import { Icon } from './Icon';
import { colorForWorkspace } from '../lib/palette';

const shortDate = (date) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(date));

const clock = (seconds) => {
  if (!seconds && seconds !== 0) return '';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
};

function FileList({ materials, onDelete }) {
  if (!materials.length) return <p className="dim">No files here yet.</p>;
  return <ul className="files">
    {materials.map((material) => <li key={material.id} className="file">
      <span className="file-kind">{material.original_filename.split('.').at(-1)?.slice(0, 4).toUpperCase()}</span>
      <a href={`/api/materials/${material.id}/file`} target="_blank" rel="noreferrer">
        <strong>{material.original_filename}</strong>
        <small>{Math.max(1, Math.round(material.size_bytes / 1024))} KB · {material.ai_status === 'ready' ? 'Ready' : 'Not extracted'}</small>
      </a>
      <button className="iconbtn ghost" onClick={() => onDelete(material)} aria-label={`Delete ${material.original_filename}`}>
        <Icon name="close" />
      </button>
    </li>)}
  </ul>;
}

export default function LibraryView({
  data, onOpenFolder, onOpenWorkspace, onNewFolder, onRecord, onUpload,
  onDeleteMaterial, onMoveWorkspace, showArchived, onToggleArchived,
  onArchiveFolder, onRecolorFolder, onDeleteFolder, onOpenSettings,
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);
  const [backOver, setBackOver] = useState(false);

  const folder = data.current_folder;
  const lectures = data.workspaces;
  const [featured, ...rest] = lectures;
  const upNext = rest[0];

  async function chooseFiles(files) {
    if (!files?.length) return;
    setUploading(true);
    try { await onUpload([...files]); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ''; }
  }

  function receiveWorkspace(event, targetFolderId) {
    const id = event.dataTransfer.getData('application/x-class-notes-workspace');
    if (id) onMoveWorkspace(id, targetFolderId);
  }

  const totalTakes = lectures.reduce((sum, item) => sum + item.session_count, 0);

  return <main className="screen">
    {/* ---- Yellow hero ------------------------------------ */}
    <header className="hero" style={{ '--hang': featured ? '3.25rem' : '1.25rem' }}>
      <div className="hero-top">
        <div>
          {folder
            ? <button
                className="hero-sub"
                onClick={() => onOpenFolder(null)}
                onDragOver={(event) => { event.preventDefault(); setBackOver(true); }}
                onDragLeave={() => setBackOver(false)}
                onDrop={(event) => { event.preventDefault(); setBackOver(false); receiveWorkspace(event, null); }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', marginBottom: '.2rem' }}
              >
                <Icon name="back" size={13} />
                {backOver ? 'Drop to move out' : 'All classes'}
              </button>
            : null}
          <h1 className="hero-title">{folder?.name ?? 'Your classes'}</h1>
          <p className="hero-sub">
            {folder
              ? `${lectures.length} lecture${lectures.length === 1 ? '' : 's'} · ${totalTakes} recording${totalTakes === 1 ? '' : 's'}`
              : showArchived ? 'Archived classes' : 'Everything you have recorded'}
          </p>
        </div>
        <button className="hero-menu" onClick={onOpenSettings} aria-label="Settings">
          <Icon name="gear" />
        </button>
      </div>

      {featured && (
        <div className="hero-stage">
          <div className="hero-rail">
            <span className="hero-rail-label">Latest</span>
          </div>
          <button
            className="feature"
            onClick={() => onOpenWorkspace(featured.id)}
            aria-label={`Open ${featured.title}`}
          >
            <CoverArt id={featured.id} color={colorForWorkspace(featured, data.folders, folder)} />
            <span className="feature-body">
              <span className="feature-copy">
                <span className="feature-title">{featured.title}</span>
                <span className="feature-sub">
                  {featured.session_count} recording{featured.session_count === 1 ? '' : 's'} · {shortDate(featured.updated_at)}
                </span>
              </span>
              <span className="feature-play"><Icon name="play" /></span>
            </span>
          </button>
          {upNext && (
            <span className="feature-peek" aria-hidden="true">
              <CoverArt id={upNext.id} color={colorForWorkspace(upNext, data.folders, folder)} />
            </span>
          )}
        </div>
      )}
    </header>
    {featured && <div className="hero-spill" style={{ '--hang': '3.25rem' }} />}

    {/* ---- Classes ---------------------------------------- */}
    {!folder && (
      <section className="sheet">
        <div className="row-head">
          <h2 className="row-title">{showArchived ? 'Archived' : 'Classes'}</h2>
          <button className="row-link" onClick={() => onToggleArchived(!showArchived)}>
            {showArchived ? 'Current classes' : 'See archived'}
          </button>
        </div>
        {data.folders.length ? (
          <div className="cover-row">
            {data.folders.map((child) => (
              <ClassCard
                key={child.id}
                folder={{ ...child, archived: showArchived || child.archived }}
                onOpen={onOpenFolder}
                onArchive={onArchiveFolder}
                onRecolor={onRecolorFolder}
                onDelete={onDeleteFolder}
                onDropWorkspace={receiveWorkspace}
              />
            ))}
            {!showArchived && (
              <div className="tile">
                <button className="tile-add" onClick={onNewFolder}>
                  <Icon name="plus" /><span>New class</span>
                </button>
              </div>
            )}
          </div>
        ) : showArchived ? (
          <p className="dim">Nothing archived yet.</p>
        ) : (
          <button className="dropzone" onClick={onNewFolder}>
            <Icon name="plus" />
            <strong>Add your first class</strong>
            <span>Biology, Algorithms, whatever you are taking</span>
          </button>
        )}
      </section>
    )}

    {/* ---- Lectures --------------------------------------- */}
    {!showArchived && (
      <section className="sheet">
        <div className="row-head">
          <h2 className="row-title">{featured ? 'All lectures' : 'Lectures'}</h2>
          {lectures.length > 0 && (
            <span className="row-link" style={{ pointerEvents: 'none' }}>
              {lectures.length}
            </span>
          )}
        </div>

        {lectures.length ? (
          <ul className="track-list">
            {lectures.map((workspace) => (
              <li key={workspace.id}>
                <button
                  className="track"
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('application/x-class-notes-workspace', workspace.id)}
                  onClick={() => onOpenWorkspace(workspace.id)}
                  aria-label={`Open ${workspace.title}`}
                >
                  <span className="track-art">
                    <CoverArt id={workspace.id} color={colorForWorkspace(workspace, data.folders, folder)} />
                  </span>
                  <span className="track-body">
                    <span className="track-title">{workspace.title}</span>
                    <span className="track-sub">
                      {workspace.session_count} recording{workspace.session_count === 1 ? '' : 's'} · {shortDate(workspace.updated_at)}
                    </span>
                  </span>
                  <span className="track-time">{clock(workspace.duration_seconds) || shortDate(workspace.updated_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">
            <span className="empty-orb"><Icon name="mic" /></span>
            <h3>Nothing recorded yet</h3>
            <p>Record once, then keep adding takes to the same lecture.</p>
            <button className="btn primary" onClick={onRecord}>Start recording</button>
          </div>
        )}
      </section>
    )}

    {/* ---- Files ------------------------------------------ */}
    {!showArchived && (
      <section className="sheet">
        <div className="row-head"><h2 className="row-title">Files</h2></div>
        <button
          className={`dropzone ${over ? 'over' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => { event.preventDefault(); setOver(false); chooseFiles(event.dataTransfer.files); }}
        >
          <Icon name="upload" />
          <strong>{uploading ? 'Adding…' : 'Add files'}</strong>
          <span>PDF · Word · PowerPoint · Markdown</span>
        </button>
        <input
          ref={inputRef} hidden type="file" multiple
          accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx"
          onChange={(event) => chooseFiles(event.target.files)}
        />
        <FileList materials={data.materials} onDelete={onDeleteMaterial} />
      </section>
    )}
  </main>;
}

export { FileList };
