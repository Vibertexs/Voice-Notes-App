import { useRef, useState } from 'react';
import ClassCard from './ClassCard';

const readableDate = (date) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(date));

function MaterialList({ materials, onDelete }) {
  if (!materials.length) return <p className="empty-copy">No imported files here yet.</p>;
  return <ul className="material-list">
    {materials.map((material) => <li key={material.id} className="material-item">
      <a href={`/api/materials/${material.id}/file`} target="_blank" rel="noreferrer">
        <span className="file-icon">{material.original_filename.split('.').at(-1)?.toUpperCase()}</span>
        <span>
          <strong>{material.original_filename}</strong>
          <small>{Math.max(1, Math.round(material.size_bytes / 1024))} KB · {material.extraction_status === 'ready' ? 'Ready for AI' : 'Needs extraction'}</small>
        </span>
      </a>
      <button className="icon-button subtle" onClick={() => onDelete(material)} aria-label={`Delete ${material.original_filename}`}>×</button>
    </li>)}
  </ul>;
}

export default function LibraryView({
  data, allFolders, onOpenFolder, onOpenWorkspace, onNewFolder, onRecord, onUpload,
  onDeleteMaterial, onMoveWorkspace, showArchived, onToggleArchived, onArchiveFolder,
  onRecolorFolder, onDeleteFolder,
}) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dropping, setDropping] = useState(false);
  const folder = data.current_folder;

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

  const recordingCount = data.workspaces.reduce((sum, item) => sum + item.session_count, 0);

  return <main className="page library-page">
    <header className="page-header">
      <div>
        <p className="eyebrow">{folder ? 'Class' : 'Private lecture library'}</p>
        <h1>{folder?.name ?? 'Your classes'}</h1>
        <p className="muted">{folder
          ? `${data.workspaces.length} lecture${data.workspaces.length === 1 ? '' : 's'} · ${recordingCount} recording${recordingCount === 1 ? '' : 's'}`
          : 'Everything you need for class, in one place.'}</p>
      </div>
      <div className="header-actions">
        {!folder && <button className="button ghost" onClick={onNewFolder}>＋ Class</button>}
        <button className="button primary capture-shortcut" onClick={onRecord}>Record &amp; note</button>
      </div>
    </header>

    {folder && <button
      className={`parent-target ${dropping ? 'drop-active' : ''}`}
      onClick={() => onOpenFolder(null)}
      onDragOver={(event) => { event.preventDefault(); setDropping(true); }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => { event.preventDefault(); setDropping(false); receiveWorkspace(event, null); }}
    >
      <span className="parent-icon" aria-hidden="true">↰</span>
      <span className="parent-copy">
        <strong>All classes</strong>
        <small>{dropping ? 'Drop to take this lecture out of the class' : 'Tap to go back · drag a lecture here to take it out'}</small>
      </span>
      <span className="parent-arrow" aria-hidden="true">›</span>
    </button>}

    {!folder && <section className="library-section">
      <div className="section-heading">
        <div><p className="eyebrow">Classes</p><h2>{showArchived ? 'Archived' : 'This term'}</h2></div>
        <button className="text-button" onClick={() => onToggleArchived(!showArchived)}>
          {showArchived ? 'Back to current classes' : 'View archived'}
        </button>
      </div>
      <div className="class-grid">
        {data.folders.map((child, position) => <ClassCard
          key={child.id}
          index={position}
          folder={{ ...child, archived: showArchived || child.archived }}
          onOpen={onOpenFolder}
          onArchive={onArchiveFolder}
          onRecolor={onRecolorFolder}
          onDelete={onDeleteFolder}
          onDropWorkspace={receiveWorkspace}
        />)}
        {!data.folders.length && (showArchived
          ? <p className="empty-copy">Nothing archived yet.</p>
          : <button className="add-card" onClick={onNewFolder}>
            <span>＋</span><strong>Add a class</strong><small>Biology, Algorithms, whatever you are taking</small>
          </button>)}
      </div>
    </section>}

    {!showArchived && <section className="library-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Lecture notes</p>
          <h2>{data.workspaces.length ? `${data.workspaces.length} lecture${data.workspaces.length === 1 ? '' : 's'}` : 'Start your first lecture'}</h2>
        </div>

      </div>
      <div className="workspace-grid">
        {data.workspaces.map((workspace) => <button
          type="button"
          key={workspace.id}
          className="workspace-card"
          draggable
          onDragStart={(event) => event.dataTransfer.setData('application/x-class-notes-workspace', workspace.id)}
          onClick={() => onOpenWorkspace(workspace.id)}
          aria-label={`Open lecture ${workspace.title}`}
        >
          <span className="workspace-card-top"><span>LECTURE</span><span>↗</span></span>
          <strong className="workspace-card-title">{workspace.title}</strong>
          <span className="workspace-card-copy">{workspace.session_count} recording{workspace.session_count === 1 ? '' : 's'} · continue anytime</span>
          <span className="workspace-card-footer"><span>{readableDate(workspace.updated_at)}</span><strong>Open notes</strong></span>
        </button>)}
      </div>
      {!data.workspaces.length && <div className="empty-state">
        <span className="empty-orb">●</span>
        <h3>No lectures here yet</h3>
        <p>Record once, then keep adding to the same lecture whenever class picks back up.</p>
        <button className="button primary" onClick={onRecord}>Record &amp; note</button>
      </div>}
    </section>}

    {!showArchived && <section className="library-section files-section">
      <div className="section-heading"><div><p className="eyebrow">Materials</p><h2>Imported files</h2></div></div>
      <button
        className="drop-zone"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); chooseFiles(event.dataTransfer.files); }}
      >
        <strong>{uploading ? 'Adding files…' : 'Drop PDFs, slides, or notes here'}</strong>
        <span>or choose files from this device</span>
      </button>
      <input ref={inputRef} hidden type="file" accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx" multiple onChange={(event) => chooseFiles(event.target.files)} />
      <MaterialList materials={data.materials} onDelete={onDeleteMaterial} />
    </section>}

    {allFolders.length > 0 && !folder && <p className="library-footnote">
      Drag a lecture onto a class to file it. Archive a class when the term ends — nothing is deleted.
    </p>}
  </main>;
}

export { MaterialList };
