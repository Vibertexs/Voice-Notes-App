import { useRef, useState } from 'react';

const folderCopy = (count) => `${count} ${count === 1 ? 'lecture' : 'lectures'}`;
const readableDate = (date) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(date));

function MaterialList({ materials, onDelete }) {
  if (!materials.length) return <p className="empty-copy">No imported files here yet.</p>;
  return <ul className="material-list">{materials.map((material) => <li key={material.id} className="material-item"><a href={`/api/materials/${material.id}/file`} target="_blank" rel="noreferrer"><span className="file-icon">{material.original_filename.split('.').at(-1)?.toUpperCase()}</span><span><strong>{material.original_filename}</strong><small>{Math.max(1, Math.round(material.size_bytes / 1024))} KB · {material.extraction_status === 'ready' ? 'Ready for AI' : 'Needs extraction'}</small></span></a><button className="icon-button subtle" onClick={() => onDelete(material)} aria-label={`Delete ${material.original_filename}`}>×</button></li>)}</ul>;
}

export default function LibraryView({ data, allFolders, onOpenFolder, onOpenWorkspace, onNewFolder, onRecord, onUpload, onDeleteMaterial, onMoveWorkspace }) {
  const inputRef = useRef(null);
  const [dropping, setDropping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const folder = data.current_folder;

  async function chooseFiles(files) {
    if (!files?.length) return;
    setUploading(true);
    try { await onUpload([...files]); } finally { setUploading(false); if (inputRef.current) inputRef.current.value = ''; }
  }

  function receiveWorkspace(event, targetFolderId) {
    event.preventDefault();
    const id = event.dataTransfer.getData('application/x-class-notes-workspace');
    if (id) onMoveWorkspace(id, targetFolderId);
    setDropping(false);
  }

  return <main className="page library-page">
    <header className="page-header">
      <div><p className="eyebrow">Private lecture library</p><h1>{folder?.name ?? 'Library'}</h1><p className="muted">{folder ? 'Keep each class organized in one focused place.' : 'Everything you need for class, in one place.'}</p></div>
      <div className="header-actions"><button className="button ghost" onClick={onNewFolder}>＋ Folder</button><button className="button primary" onClick={onRecord}>● Record & note</button></div>
    </header>

    <nav className="breadcrumbs" aria-label="Folder path"><button onClick={() => onOpenFolder(null)}>Library</button>{data.breadcrumbs.map((crumb) => <span key={crumb.id}><b>›</b><button onClick={() => onOpenFolder(crumb.id)}>{crumb.name}</button></span>)}</nav>

    <section className="library-section">
      <div className="section-heading"><div><p className="eyebrow">Folders</p><h2>{folder ? `Inside ${folder.name}` : 'Your classes'}</h2></div><button className="text-button" onClick={onNewFolder}>Add folder</button></div>
      <div className="folder-grid">
        {data.folders.map((child, index) => <button key={child.id} className={`folder-card ${child.color} ${dropping ? 'drop-active' : ''}`} onClick={() => onOpenFolder(child.id)} onDragOver={(event) => { event.preventDefault(); setDropping(true); }} onDragLeave={() => setDropping(false)} onDrop={(event) => receiveWorkspace(event, child.id)}>
          <span className="folder-sky"/><span className="folder-inlay"><span className="folder-row"><span>{String(index + 1).padStart(2, '0')}</span><span>↗</span></span><span className="folder-title">{child.name}</span><span className="folder-subtitle">Open folder</span></span>
        </button>)}
        {!data.folders.length && <button className="add-card" onClick={onNewFolder}><span>＋</span><strong>Create a folder</strong><small>Organize a class or topic</small></button>}
      </div>
    </section>

    <section className="library-section">
      <div className="section-heading"><div><p className="eyebrow">Lecture notes</p><h2>{data.workspaces.length ? folderCopy(data.workspaces.reduce((sum, workspace) => sum + workspace.session_count, 0)) : 'Start your first lecture'}</h2></div>{folder && <button className={`unfiled-target ${dropping ? 'drop-active' : ''}`} onDragOver={(event) => { event.preventDefault(); setDropping(true); }} onDragLeave={() => setDropping(false)} onDrop={(event) => receiveWorkspace(event, null)}>Move to Library</button>}</div>
      <div className="workspace-grid">{data.workspaces.map((workspace) => <button type="button" key={workspace.id} className="workspace-card" draggable onDragStart={(event) => event.dataTransfer.setData('application/x-class-notes-workspace', workspace.id)} onClick={() => onOpenWorkspace(workspace.id)} aria-label={`Open lecture ${workspace.title}`}><span className="workspace-card-top"><span>LECTURE NOTES</span><span>↗</span></span><strong className="workspace-card-title">{workspace.title}</strong><span className="workspace-card-copy">{workspace.session_count} recording{workspace.session_count === 1 ? '' : 's'} attached · continue anytime</span><span className="workspace-card-footer"><span>{readableDate(workspace.updated_at)}</span><strong>Open notes</strong></span></button>)}</div>
      {!data.workspaces.length && <div className="empty-state"><span className="empty-orb">●</span><h3>No lectures here yet</h3><p>Record once, then keep adding to the same lecture whenever class picks back up.</p><button className="button primary" onClick={onRecord}>Record & note</button></div>}
    </section>

    <section className="library-section files-section"><div className="section-heading"><div><p className="eyebrow">Materials</p><h2>Imported files</h2></div></div><button className="drop-zone" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => chooseFiles(event.dataTransfer.files)}><strong>{uploading ? 'Adding files…' : 'Drop PDFs, slides, or notes here'}</strong><span>or choose files from this device</span></button><input ref={inputRef} hidden type="file" accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx" multiple onChange={(event) => chooseFiles(event.target.files)} /><MaterialList materials={data.materials} onDelete={onDeleteMaterial} /></section>
    {allFolders.length > 0 && <p className="library-footnote">Drag a lecture card into a folder to organize it. Your audio, notes, and files always stay together.</p>}
  </main>;
}

export { MaterialList };
