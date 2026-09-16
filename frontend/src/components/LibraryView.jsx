import { useRef, useState } from 'react';
import ClassCard from './ClassCard';
import { TONES } from './CoverArt';
import { Icon } from './Icon';

const shortDate = (date) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(date));

function rgbFor(hex) {
  const value = String(hex).replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function heroPalette(from, to = from, amount = 0) {
  const start = rgbFor(from);
  const end = rgbFor(to);
  const rgb = start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount));
  // Perceived brightness, not a simple RGB average: yellow needs dark type,
  // while red and blue need white. Keeping this in the same calculation as
  // the blended background prevents text from flipping at the wrong time.
  const brightness = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
  const darkInk = brightness > 156;
  return {
    tone: `rgb(${rgb.join(' ')})`,
    ink: darkInk ? '#0A0A0D' : '#FFFFFF',
    muted: darkInk ? 'rgba(10,10,13,.64)' : 'rgba(255,255,255,.78)',
    chip: darkInk ? 'rgba(10,10,13,.14)' : 'rgba(255,255,255,.18)',
  };
}

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
  const screenRef = useRef(null);
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

  function updateHeroTone(event) {
    if (folder || data.folders.length === 0 || !screenRef.current) return;
    const rail = event.currentTarget;
    const cards = Array.from(rail.children).slice(0, data.folders.length);
    const centre = rail.scrollLeft + rail.clientWidth / 2;
    const centres = cards.map((card) => card.offsetLeft + card.offsetWidth / 2);
    let index = centres.findIndex((point) => centre <= point);
    if (index < 0) index = centres.length - 1;

    const right = Math.max(0, index);
    const left = Math.max(0, right - 1);
    const span = Math.max(1, centres[right] - centres[left]);
    const progress = left === right ? 0 : Math.min(1, Math.max(0, (centre - centres[left]) / span));
    const palette = heroPalette(
      TONES[data.folders[left].color] ?? TONES.blue,
      TONES[data.folders[right].color] ?? TONES.blue,
      progress,
    );
    const root = screenRef.current;
    root.style.setProperty('--hero-tone', palette.tone);
    root.style.setProperty('--hero-ink', palette.ink);
    root.style.setProperty('--hero-muted', palette.muted);
    root.style.setProperty('--hero-chip', palette.chip);
  }

  const totalTakes = lectures.reduce((sum, item) => sum + item.session_count, 0);
  // A class earns a colour on its own page. Letting the home screen change
  // colour while its carousel moves makes the library feel unstable.
  const classTone = folder ? (TONES[folder.color] ?? TONES.blue) : null;
  const firstHomeTone = data.folders.length ? (TONES[data.folders[0].color] ?? TONES.blue) : null;
  const initialPalette = heroPalette(classTone ?? firstHomeTone ?? '#ECEF5E');
  const hasHeroTone = Boolean(classTone ?? firstHomeTone);

  return <main
    ref={screenRef}
    className={`screen ${folder ? 'class-screen' : ''}`}
    style={{
      '--class-tone': classTone ?? firstHomeTone ?? '#ECEF5E',
      '--hero-tone': initialPalette.tone,
      '--hero-ink': initialPalette.ink,
      '--hero-muted': initialPalette.muted,
      '--hero-chip': initialPalette.chip,
    }}
  >
    {/* ---- Yellow hero ------------------------------------ */}
    <header
      className={`hero ${showCarousel ? '' : 'pad'} ${hasHeroTone ? 'class-hero' : ''}`}
    >
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
          <div className="hero-carousel" onScroll={updateHeroTone}>
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
                  <span className="track-art"><Icon name="wave" /></span>
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
