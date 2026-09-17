import { useCallback, useEffect, useState } from 'react';
import CaptureView from './components/CaptureView';
import FolderDialog from './components/FolderDialog';
import LibraryView from './components/LibraryView';
import SearchView from './components/SearchView';
import SettingsDialog from './components/SettingsDialog';
import WorkspaceView from './components/WorkspaceView';
import { Icon } from './components/Icon';
import { libraryApi } from './lib/api';
import { colorForWorkspace } from './lib/palette';

function Toast({ toast }) {
  return toast ? <div className={`toast ${toast.kind ?? ''}`} role="status">{toast.message}</div> : null;
}

function Boot() {
  return <main className="boot"><div className="orb" /><p>Opening your library…</p></main>;
}

function BootError({ error, retry }) {
  return <main className="boot">
    <h1>Couldn’t open Class Notes</h1>
    <p>{error}</p>
    <button className="btn primary" onClick={retry}>Try again</button>
  </main>;
}

export default function App() {
  const [screen, setScreen] = useState({ name: 'home', folderId: null });
  const [library, setLibrary] = useState(null);
  const [allFolders, setAllFolders] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [folderDialog, setFolderDialog] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

  const openLibrary = useCallback(async (folderId = null, { archived, view } = {}) => {
    setError('');
    setWorkspace(null);
    const wantArchived = archived ?? (folderId ? false : showArchived);
    if (!folderId) setShowArchived(wantArchived);
    setScreen({ name: view ?? (folderId ? 'folder' : 'home'), folderId });
    try {
      const [nextLibrary] = await Promise.all([
        libraryApi.library(folderId, { archived: folderId ? false : wantArchived }),
        loadFolders(),
      ]);
      setLibrary(nextLibrary);
    } catch (caught) { setError(caught.message); }
  }, [loadFolders, showArchived]);

  const openHome = useCallback(() => openLibrary(null, { archived: false, view: 'home' }), [openLibrary]);
  const openFolders = useCallback((archived = false) => openLibrary(null, { archived, view: 'folders' }), [openLibrary]);
  const openFolder = useCallback((folderId) => openLibrary(folderId, { view: 'folder' }), [openLibrary]);

  const openWorkspace = useCallback(async (workspaceId) => {
    setError('');
    setScreen({ name: 'workspace', workspaceId });
    try { setWorkspace(await libraryApi.workspace(workspaceId)); } catch (caught) { setError(caught.message); }
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!workspace?.id) return;
    try { setWorkspace(await libraryApi.workspace(workspace.id)); } catch (caught) { notify(caught.message, 'error'); }
  }, [notify, workspace?.id]);

  useEffect(() => { openHome(); }, [openHome]);

  async function createFolder(folder) {
    await libraryApi.createFolder(folder);
    await openFolders();
    notify('Class created.');
  }
  async function uploadFiles(files) {
    await Promise.all(files.map((file) => libraryApi.uploadMaterial(file, { folderId: library.current_folder?.id })));
    await openLibrary(screen.folderId, { view: screen.name });
    notify(`${files.length} file${files.length === 1 ? '' : 's'} added.`);
  }
  async function deleteMaterial(material) {
    if (!window.confirm(`Delete ${material.original_filename}?`)) return;
    try { await libraryApi.deleteMaterial(material.id); await openLibrary(screen.folderId, { view: screen.name }); } catch (caught) { notify(caught.message, 'error'); }
  }
  async function setFolderArchived(folderId, archived) {
    try {
      await libraryApi.archiveFolder(folderId, archived);
      await openFolders(false);
      notify(archived ? 'Class archived.' : 'Class is back in your library.');
    } catch (caught) { notify(caught.message, 'error'); }
  }
  async function deleteFolder(folder) {
    if (!window.confirm(`Delete the class "${folder.name}"?`)) return;
    try {
      await libraryApi.deleteFolder(folder.id);
      await openFolders();
      notify('Class deleted.');
    } catch (caught) { notify(caught.message, 'error'); }
  }
  async function recolorFolder(folderId, color) {
    try { await libraryApi.updateFolder(folderId, { color }); await openLibrary(screen.folderId, { view: screen.name }); }
    catch (caught) { notify(caught.message, 'error'); }
  }
  async function moveWorkspace(workspaceId, folderId) {
    try {
      await libraryApi.updateWorkspace(workspaceId, { folder_id: folderId });
      await openLibrary(screen.folderId, { view: screen.name });
      notify(folderId ? 'Lecture filed.' : 'Lecture moved out.');
    } catch (caught) { notify(caught.message, 'error'); }
  }
  function startCapture(workspaceTarget = null) {
    setCaptureContext({ workspace: workspaceTarget, folder: workspaceTarget ? null : library?.current_folder ?? null });
    setScreen({ name: 'capture' });
  }
  function cancelCapture() {
    if (captureContext?.workspace) openWorkspace(captureContext.workspace.id);
    else if (captureContext?.folder?.id ?? screen.folderId) openFolder(captureContext?.folder?.id ?? screen.folderId);
    else openHome();
    setCaptureContext(null);
  }
  function captureSaved(workspaceId) { setCaptureContext(null); openWorkspace(workspaceId); }

  async function openSearchResult(result) {
    if (!result.workspace_id) { notify('That result is no longer available.', 'error'); return; }
    setPendingSeek(result.kind === 'transcript'
      ? { lectureId: result.lecture_id, seconds: result.start_seconds }
      : null);
    await openWorkspace(result.workspace_id);
  }

  if (error && !library && !workspace) return <BootError error={error} retry={openHome} />;
  if (!library && screen.name !== 'workspace') return <Boot />;

  const showDock = !['workspace', 'capture'].includes(screen.name);

  return (
    <div className="app-shell">
      {error && <div className="banner"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}

      {['home', 'folders', 'folder'].includes(screen.name) && library && (
        <LibraryView
          mode={screen.name}
          data={library}
          onOpenFolder={openFolder}
          onOpenFolders={openFolders}
          onOpenWorkspace={openWorkspace}
          onNewFolder={() => setFolderDialog(true)}
          onRecord={() => startCapture()}
          onUpload={uploadFiles}
          onDeleteMaterial={deleteMaterial}
          onMoveWorkspace={moveWorkspace}
          showArchived={showArchived}
          onToggleArchived={openFolders}
          onArchiveFolder={setFolderArchived}
          onRecolorFolder={recolorFolder}
          onDeleteFolder={deleteFolder}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {screen.name === 'workspace' && (workspace
        ? <WorkspaceView
            workspace={workspace}
            color={colorForWorkspace(workspace, allFolders)}
            courseName={allFolders.find((folder) => folder.id === workspace.folder_id)?.name ?? 'Unfiled'}
            onBack={() => workspace.folder_id ? openFolder(workspace.folder_id) : openHome()}
            onContinue={() => startCapture(workspace)}
            onReload={refreshWorkspace}
            onDelete={() => openLibrary(workspace.folder_id)}
            notify={notify}
            pendingSeek={pendingSeek}
            onSeekHandled={() => setPendingSeek(null)}
          />
        : <Boot />)}
      {screen.name === 'search' && (
        <SearchView onOpenResult={openSearchResult} onBack={openHome} />
      )}
      {screen.name === 'capture' && (
        <CaptureView context={captureContext ?? {}} onSaved={captureSaved} onCancel={cancelCapture} notify={notify} />
      )}

      {showDock && (
        <nav className="dock" aria-label="Main">
          <button
            className={`dock-btn ${screen.name === 'home' ? 'active' : ''}`}
            onClick={openHome}
            aria-label="Home"
            aria-current={screen.name === 'home' ? 'page' : undefined}
          ><Icon name="home" /><span>Home</span></button>

          <button
            className={`dock-btn ${screen.name === 'folders' || screen.name === 'folder' ? 'active' : ''}`}
            onClick={() => openFolders()}
            aria-label="Folders"
            aria-current={screen.name === 'folders' ? 'page' : undefined}
          ><Icon name="folder" /><span>Folders</span></button>

          <button className={`dock-btn ${screen.name === 'search' ? 'active' : ''}`} onClick={() => setScreen({ name: 'search' })} aria-label="Library" aria-current={screen.name === 'search' ? 'page' : undefined}>
            <Icon name="library" /><span>Library</span>
          </button>
        </nav>
      )}

      {folderDialog && <FolderDialog parent={library?.current_folder} onClose={() => setFolderDialog(false)} onCreate={createFolder} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} notify={notify} />}
      <Toast toast={toast} />
    </div>
  );
}
