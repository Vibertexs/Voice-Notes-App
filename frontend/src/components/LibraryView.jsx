import { useRef, useState } from 'react';
import ClassCard from './ClassCard';
import CoverArt from './CoverArt';
import { Icon } from './Icon';
import { colorForWorkspace } from '../lib/palette';

const shortDate = (date) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(date));

/**
 * A lecture sits under its class the way a song sits under its artist. The
 * take count only earns its place when there is more than one, and a lecture
 * with no class at all is the one case worth flagging rather than describing
 * - it is the thing the reader may want to act on.
 */
function TrackSub({ workspace, folders, currentFolder }) {
  const className = currentFolder?.name
    ?? folders.find((folder) => folder.id === workspace.folder_id)?.name
    ?? null;
  const takes = workspace.session_count ?? 0;
  return <span className="track-sub">
    {className
      ? <span className="track-class">{className}</span>
      : <span className="track-tag">Unfiled</span>}
    {takes > 1 && <span>· {takes} recordings</span>}
  </span>;
}

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
  // The carousel is the way into a class, so it only appears at the top
  // level. Inside a class there is nothing left to swipe between.
  const showCarousel = !folder;
  const classCount = data.folders.length;

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
    <header className={`hero ${showCarousel ? '' : 'pad'}`}>
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
            {!folder && (
              <button className="hero-link" onClick={() => onToggleArchived(!showArchived)}>
                {showArchived ? 'Show current' : 'View archived'}
              </button>
            )}
          </p>
        </div>
        <button className="hero-menu" onClick={onOpenSettings} aria-label="Settings">
          <Icon name="gear" />
        </button>
      </div>

      {showCarousel && (
        <div className="hero-stage">
          <div className="hero-carousel">
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
              <div className="slide">
                <button className="slide-add" onClick={onNewFolder}>
                  <Icon name="plus" />
                  <span>{classCount === 0 ? 'Add your first class' : 'New class'}</span>
                </button>
              </div>
            )}
            {showArchived && classCount === 0 && (
              <div className="slide">
                <div className="slide-add" style={{ cursor: 'default' }}>
                  <span>Nothing archived</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
    {showCarousel && <div className="hero-spill" />}

    {/* ---- Lectures --------------------------------------- */}
    {!showArchived && (
      <section className="sheet">
        <div className="row-head">
          <h2 className="row-title">All lectures</h2>
          {lectures.length > 0 && <span className="row-count">{lectures.length}</span>}
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
                    <CoverArt color={colorForWorkspace(workspace, data.folders, folder)} />
                  </span>
                  <span className="track-body">
                    <span className="track-title">{workspace.title}</span>
                    <TrackSub workspace={workspace} folders={data.folders} currentFolder={folder} />
                  </span>
                  <span className="track-time">{shortDate(workspace.updated_at)}</span>
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
