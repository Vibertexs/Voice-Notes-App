import { useCallback, useEffect, useState } from 'react';
import CaptureView from './components/CaptureView';
import FolderDialog from './components/FolderDialog';
import LibraryView from './components/LibraryView';
import SearchView from './components/SearchView';
import WorkspaceView from './components/WorkspaceView';
import { libraryApi } from './lib/api';

function Toast({ toast }) {
  return toast ? <div className={`toast ${toast.kind ?? ''}`} role="status">{toast.message}</div> : null;
}

function Loading() { return <main className="loading-screen"><div className="loader-orb"/><p>Opening your lecture library…</p></main>; }

function ErrorState({ error, retry }) { return <main className="loading-screen"><div><h1>Couldn’t open Class Notes</h1><p className="muted">{error}</p><button className="button primary" onClick={retry}>Try again</button></div></main>; }

export default function App() {
  const [screen, setScreen] = useState({ name: 'library', folderId: null });
  const [library, setLibrary] = useState(null);
  const [allFolders, setAllFolders] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [folderDialog, setFolderDialog] = useState(false);
  const [captureContext, setCaptureContext] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [pendingSeek, setPendingSeek] = useState(null);
  const [showArchived, setShowArchived] = useState(false);

  const notify = useCallback((message, kind = '') => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  const loadFolders = useCallback(async () => {
    const result = await libraryApi.allFolders();
    setAllFolders(result.folders);
  }, []);

  const openLibrary = useCallback(async (folderId = null, { archived } = {}) => {
    setError('');
    setWorkspace(null);
    const wantArchived = archived ?? (folderId ? false : showArchived);
    if (!folderId) setShowArchived(wantArchived);
    setScreen({ name: 'library', folderId });
    try {
      const [nextLibrary] = await Promise.all([
        libraryApi.library(folderId, { archived: folderId ? false : wantArchived }),
        loadFolders(),
      ]);
      setLibrary(nextLibrary);
    } catch (caught) { setError(caught.message); }
  }, [loadFolders, showArchived]);

  const openWorkspace = useCallback(async (workspaceId) => {
    setError('');
    setScreen({ name: 'workspace', workspaceId });
    try { setWorkspace(await libraryApi.workspace(workspaceId)); } catch (caught) { setError(caught.message); }
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!workspace?.id) return;
    try { setWorkspace(await libraryApi.workspace(workspace.id)); } catch (caught) { notify(caught.message, 'error'); }
  }, [notify, workspace?.id]);

  useEffect(() => { openLibrary(null); }, [openLibrary]);

  async function createFolder(folder) {
    await libraryApi.createFolder(folder);
    await openLibrary(screen.folderId);
    notify('Folder created.');
  }
  async function uploadFiles(files) {
    await Promise.all(files.map((file) => libraryApi.uploadMaterial(file, { folderId: library.current_folder?.id })));
    await openLibrary(screen.folderId);
    notify(`${files.length} file${files.length === 1 ? '' : 's'} added.`);
  }
  async function deleteMaterial(material) {
    if (!window.confirm(`Delete ${material.original_filename}?`)) return;
    try { await libraryApi.deleteMaterial(material.id); await openLibrary(screen.folderId); } catch (caught) { notify(caught.message, 'error'); }
  }
  async function setFolderArchived(folderId, archived) {
    try {
      await libraryApi.archiveFolder(folderId, archived);
      await openLibrary(null, { archived: false });
      notify(archived ? 'Class archived.' : 'Class is back in your library.');
    } catch (caught) { notify(caught.message, 'error'); }
  }
  async function recolorFolder(folderId, color) {
    try { await libraryApi.updateFolder(folderId, { color }); await openLibrary(null); }
    catch (caught) { notify(caught.message, 'error'); }
  }
  async function moveWorkspace(workspaceId, folderId) {
    try { await libraryApi.updateWorkspace(workspaceId, { folder_id: folderId }); await openLibrary(screen.folderId); notify(folderId ? 'Lecture moved to the folder.' : 'Lecture moved back to Library.'); } catch (caught) { notify(caught.message, 'error'); }
  }
  function startCapture(workspaceTarget = null) {
    setCaptureContext({ workspace: workspaceTarget, folder: workspaceTarget ? null : library?.current_folder ?? null });
    setScreen({ name: 'capture' });
  }
  function cancelCapture() {
    if (captureContext?.workspace) openWorkspace(captureContext.workspace.id);
    else openLibrary(captureContext?.folder?.id ?? screen.folderId ?? null);
    setCaptureContext(null);
  }
  function captureSaved(workspaceId) { setCaptureContext(null); openWorkspace(workspaceId); }

  async function openSearchResult(result) {
    if (!result.workspace_id) { notify('That result is no longer available.', 'error'); return; }
    // The workspace view reads this on mount and seeks the player to the moment.
    setPendingSeek(result.kind === 'transcript'
      ? { lectureId: result.lecture_id, seconds: result.start_seconds }
      : null);
    await openWorkspace(result.workspace_id);
  }

  if (error && !library && !workspace) return <ErrorState error={error} retry={() => openLibrary(null)} />;
  if (!library && screen.name !== 'workspace') return <Loading />;

  return <div className="app-shell">
    <header className="topbar"><button className="brand" onClick={() => openLibrary(null)}><span>C</span><b>Class Notes</b></button><div className="topbar-copy"><span>Private, local lecture library</span><button onClick={() => setScreen({ name: 'search' })}>Search</button><button onClick={() => openLibrary(null)}>Library</button></div></header>
    {error && <div className="inline-error"><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
    {screen.name === 'library' && library && <LibraryView data={library} allFolders={allFolders} onOpenFolder={openLibrary} onOpenWorkspace={openWorkspace} onNewFolder={() => setFolderDialog(true)} onRecord={() => startCapture()} onUpload={uploadFiles} onDeleteMaterial={deleteMaterial} onMoveWorkspace={moveWorkspace} showArchived={showArchived} onToggleArchived={(next) => openLibrary(null, { archived: next })} onArchiveFolder={setFolderArchived} onRecolorFolder={recolorFolder} />}
    {screen.name === 'workspace' && (workspace ? <WorkspaceView workspace={workspace} onBack={() => openLibrary(workspace.folder_id)} onContinue={() => startCapture(workspace)} onReload={refreshWorkspace} onDelete={() => openLibrary(workspace.folder_id)} notify={notify} pendingSeek={pendingSeek} onSeekHandled={() => setPendingSeek(null)} /> : <Loading />)}
    {screen.name === 'search' && <SearchView onOpenResult={openSearchResult} onBack={() => openLibrary(screen.folderId ?? null)} />}
    {screen.name === 'capture' && <CaptureView context={captureContext ?? {}} onSaved={captureSaved} onCancel={cancelCapture} notify={notify} />}
    {folderDialog && <FolderDialog parent={library?.current_folder} onClose={() => setFolderDialog(false)} onCreate={createFolder} />}
    <Toast toast={toast} />
  </div>;
}
