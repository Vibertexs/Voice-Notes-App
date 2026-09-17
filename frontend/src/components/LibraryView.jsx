import { useRef, useState } from 'react';
import { TONES } from './CoverArt';
import { Icon } from './Icon';

const COLORS = ['blue', 'violet', 'rose', 'coral', 'amber', 'lime', 'mint', 'sky', 'slate'];
const FEATURED_COUNT = 3;

const shortDate = (date) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(date));

function recordingCopy(folder) {
  const count = folder.lecture_count ?? 0;
  return `${count} recording${count === 1 ? '' : 's'}`;
}

function FolderGlyph() {
  return <span className="folder-glyph" aria-hidden="true"><span /></span>;
}

function FolderTile({ folder, compact = false, onOpen, onMenu, menuOpen, onCloseMenu, onArchive, onRecolor, onDelete }) {
  return <article
    className={`folder-tile ${compact ? 'compact' : ''}`}
    style={{ '--folder-tone': TONES[folder.color] ?? TONES.blue }}
  >
    <button className="folder-tile-main" onClick={() => onOpen(folder.id)} aria-label={`Open ${folder.name}`}>
      <FolderGlyph />
      <span className="folder-tile-copy">
        <strong>{folder.name}</strong>
        <small>{recordingCopy(folder)}</small>
      </span>
      {!compact && <span className="folder-open-arrow"><Icon name="arrow" /></span>}
    </button>
    <button
      className="folder-tile-more"
      onClick={() => onMenu(folder.id)}
      aria-label={`Options for ${folder.name}`}
      aria-expanded={menuOpen}
    ><Icon name="more" /></button>
    {menuOpen && (
      <div className="folder-popover" role="menu">
        <div className="folder-popover-swatches" aria-label="Class colour">
          {COLORS.map((color) => (
            <button
              key={color}
              className={`swatch ${color} ${color === folder.color ? 'current' : ''}`}
              onClick={() => { onRecolor(folder.id, color); onCloseMenu(); }}
              aria-label={`Change ${folder.name} to ${color}`}
              role="menuitem"
            />
          ))}
        </div>
        <button role="menuitem" onClick={() => { onArchive(folder.id, !folder.archived); onCloseMenu(); }}>
          {folder.archived ? 'Restore class' : 'Archive class'}
        </button>
        <button className="danger" role="menuitem" onClick={() => { onDelete(folder); onCloseMenu(); }}>Delete class</button>
      </div>
    )}
  </article>;
}

function RecordingRow({ workspace, folder, folders, onOpen }) {
  const folderName = folder?.name ?? folders.find((item) => item.id === workspace.folder_id)?.name;
  const takeCount = workspace.session_count ?? 0;
  return <li>
    <button className="recording-row" onClick={() => onOpen(workspace.id)} aria-label={`Open ${workspace.title}`}>
      <span className="recording-play"><Icon name="play" /></span>
      <span className="recording-row-copy">
        <strong>{workspace.title}</strong>
        <small>{folderName ?? 'Unfiled'} · {shortDate(workspace.updated_at)}</small>
      </span>
      <span className="recording-duration">{takeCount > 1 ? `${takeCount} takes` : 'Open'}</span>
    </button>
  </li>;
}

export function FileList({ materials, onDelete }) {
  if (!materials.length) return <p className="reference-empty">No files here yet.</p>;
  return <ul className="reference-files">
    {materials.map((material) => <li key={material.id} className="reference-file">
      <span className="file-kind">{material.original_filename.split('.').at(-1)?.slice(0, 4).toUpperCase()}</span>
      <a href={`/api/materials/${material.id}/file`} target="_blank" rel="noreferrer">
        <strong>{material.original_filename}</strong>
        <small>{Math.max(1, Math.round(material.size_bytes / 1024))} KB · {material.ai_status === 'ready' ? 'Ready' : 'Processing'}</small>
      </a>
      <button onClick={() => onDelete(material)} aria-label={`Delete ${material.original_filename}`}><Icon name="close" /></button>
    </li>)}</ul>;
}

function HomeView({ data, onOpenFolder, onOpenFolders, onRecord, onOpenSettings, onMenu, menuId, onCloseMenu, onArchiveFolder, onRecolorFolder, onDeleteFolder }) {
  const folders = data.folders.slice(0, FEATURED_COUNT);
  return <main className="reference-screen home-screen">
    <header className="reference-home-head">
      <div><p className="reference-wordmark">VoiceFlow</p><p>Record. Organize. Remember.</p></div>
      <button className="reference-icon-button" onClick={onOpenSettings} aria-label="Settings"><Icon name="gear" /></button>
    </header>
    <button className="home-record-card" onClick={() => onRecord()}>
      <span className="home-record-glow" aria-hidden="true"><Icon name="mic" /></span>
      <strong>Tap to record</strong><small>Start a new recording</small>
    </button>
    <section className="reference-section home-folders">
      <div className="reference-section-head"><h2>Your folders</h2><button onClick={onOpenFolders}>View all <Icon name="arrow" /></button></div>
      <div className="home-folder-list">
        {folders.map((folder) => <FolderTile key={folder.id} folder={folder} compact onOpen={onOpenFolder} onMenu={onMenu} menuOpen={menuId === folder.id} onCloseMenu={onCloseMenu} onArchive={onArchiveFolder} onRecolor={onRecolorFolder} onDelete={onDeleteFolder} />)}
        {folders.length === 0 && <p className="reference-empty">Add a class to keep recordings together.</p>}
      </div>
    </section>
  </main>;
}

function FoldersView({ data, onOpenFolder, onNewFolder, onMenu, menuId, onCloseMenu, onArchiveFolder, onRecolorFolder, onDeleteFolder, showArchived, onToggleArchived }) {
  const [query, setQuery] = useState('');
  const visible = data.folders.filter((folder) => folder.name.toLowerCase().includes(query.trim().toLowerCase()));
  const featured = visible.slice(0, FEATURED_COUNT);
  const remaining = visible.slice(FEATURED_COUNT);
  return <main className="reference-screen folders-screen">
    <header className="reference-view-head">
      <div><h1>Folders</h1><p>{showArchived ? 'Archived folders' : 'Keep every class in one place.'}</p></div>
      <button className="reference-icon-button" onClick={onNewFolder} aria-label="New folder"><Icon name="plus" /></button>
    </header>
    <label className="folder-search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search folders…" aria-label="Search folders" /></label>
    <section className="folder-grid" aria-label="Folders">
      {featured.map((folder) => <FolderTile key={folder.id} folder={folder} onOpen={onOpenFolder} onMenu={onMenu} menuOpen={menuId === folder.id} onCloseMenu={onCloseMenu} onArchive={onArchiveFolder} onRecolor={onRecolorFolder} onDelete={onDeleteFolder} />)}
    </section>
    <section className="reference-section other-folders">
      <div className="reference-section-head"><h2>{featured.length ? 'Other' : 'Your folders'}</h2><button onClick={() => onToggleArchived(!showArchived)}>{showArchived ? 'Current' : 'Archived'}</button></div>
      <div className="other-folder-list">
        {remaining.map((folder) => <FolderTile key={folder.id} folder={folder} compact onOpen={onOpenFolder} onMenu={onMenu} menuOpen={menuId === folder.id} onCloseMenu={onCloseMenu} onArchive={onArchiveFolder} onRecolor={onRecolorFolder} onDelete={onDeleteFolder} />)}
        {!visible.length && <p className="reference-empty">No folders found.</p>}
      </div>
    </section>
  </main>;
}

function FolderDetailView({ data, onOpenFolders, onOpenWorkspace, onRecord, onUpload, onDeleteMaterial }) {
  const folder = data.current_folder;
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const lectures = data.workspaces;
  const recordingCount = lectures.reduce((total, lecture) => total + (lecture.session_count ?? 0), 0);
  async function chooseFiles(files) {
    if (!files?.length) return;
    setUploading(true);
    try { await onUpload([...files]); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ''; }
  }
  return <main className="reference-screen folder-detail-screen" style={{ '--folder-tone': TONES[folder.color] ?? TONES.blue }}>
    <header className="folder-detail-top">
      <button className="reference-back" onClick={onOpenFolders}><Icon name="back" />Folders</button>
      <button className="reference-icon-button" onClick={() => inputRef.current?.click()} aria-label="Add file"><Icon name="file" /></button>
    </header>
    <section className="folder-detail-art"><FolderGlyph /><div><h1>{folder.name}</h1><p>{recordingCount} recording{recordingCount === 1 ? '' : 's'}</p></div></section>
    <button className="primary-record-button" onClick={() => onRecord()}><Icon name="plus" />New recording</button>
    <section className="reference-section folder-recordings">
      <div className="reference-section-head"><h2>Recordings</h2><span>{lectures.length}</span></div>
      {lectures.length ? <ul className="reference-recording-list">{lectures.map((workspace) => <RecordingRow key={workspace.id} workspace={workspace} folder={folder} folders={data.folders} onOpen={onOpenWorkspace} />)}</ul> : <p className="reference-empty">Start recording to add the first lecture.</p>}
    </section>
    <section className="reference-section folder-files-section">
      <div className="reference-section-head"><h2>Files</h2><button onClick={() => inputRef.current?.click()}>{uploading ? 'Adding…' : 'Add file'}</button></div>
      <FileList materials={data.materials} onDelete={onDeleteMaterial} />
      <input ref={inputRef} hidden type="file" multiple accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx" onChange={(event) => chooseFiles(event.target.files)} />
    </section>
  </main>;
}

export default function LibraryView({ mode, data, onOpenFolder, onOpenFolders, onOpenWorkspace, onNewFolder, onRecord, onUpload, onDeleteMaterial, showArchived, onToggleArchived, onArchiveFolder, onRecolorFolder, onDeleteFolder, onOpenSettings }) {
  const [menuId, setMenuId] = useState(null);
  const folderProps = { data, onOpenFolder, onNewFolder, onMenu: setMenuId, menuId, onCloseMenu: () => setMenuId(null), onArchiveFolder, onRecolorFolder, onDeleteFolder };
  if (mode === 'folders') return <FoldersView {...folderProps} showArchived={showArchived} onToggleArchived={onToggleArchived} />;
  if (mode === 'folder' && data.current_folder) return <FolderDetailView data={data} onOpenFolders={onOpenFolders} onOpenWorkspace={onOpenWorkspace} onRecord={onRecord} onUpload={onUpload} onDeleteMaterial={onDeleteMaterial} />;
  return <HomeView {...folderProps} onOpenFolders={onOpenFolders} onRecord={onRecord} onOpenSettings={onOpenSettings} />;
}
