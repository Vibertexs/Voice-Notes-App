import { useCallback, useEffect, useRef, useState } from 'react';
import ActionSheet from './components/ActionSheet';
import BottomNavigation from './components/BottomNavigation';
import FolderDialog from './components/FolderDialog';
import FolderScreen from './components/FolderScreen';
import FoldersScreen from './components/FoldersScreen';
import PlaybackScreen from './components/PlaybackScreen';
import RecordScreen from './components/RecordScreen';
import RecordingSheet from './components/RecordingSheet';
import SettingsDialog from './components/SettingsDialog';
import { FOLDER_COLORS } from './components/FolderCard';
import { libraryApi } from './lib/api';

function Toast({ toast }) {
  return toast ? <div className={`toast ${toast.kind ?? ''}`} role="status">{toast.message}</div> : null;
}

function Boot() {
  return <main className="boot"><div className="orb" /><p>Opening your recordings…</p></main>;
}

function BootError({ error, retry }) {
  return <main className="boot">
    <h1>Couldn’t open VoiceFlow</h1>
    <p>{error}</p>
    <button className="btn primary" onClick={retry}>Try again</button>
  </main>;
}

/**
 * The shell.
 *
 * Two destinations - folders, and recording - and everything else opens from
 * inside one of them. The shell owns the data, the sheets that can be raised
 * from more than one screen, and nothing else; each screen owns its own layout.
 */
export default function App() {
  const [screen, setScreen] = useState({ name: 'folders', folderId: null });
  const [library, setLibrary] = useState(null);
  const [allFolders, setAllFolders] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [captureContext, setCaptureContext] = useState(null);
  const [folderDialog, setFolderDialog] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [folderSheet, setFolderSheet] = useState(null);
  const [colourSheet, setColourSheet] = useState(null);
  const [recordingSheet, setRecordingSheet] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [pendingSeek, setPendingSeek] = useState(null);
  const fileInputRef = useRef(null);
  const fileTargetRef = useRef({});

  const notify = useCallback((message, kind = '') => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  const openLibrary = useCallback(async (folderId = null) => {
    setError('');
    setWorkspace(null);
    setScreen({ name: folderId ? 'folder' : 'folders', folderId });
    try {
      const [nextLibrary, folders] = await Promise.all([
        libraryApi.library(folderId),
        libraryApi.allFolders(),
      ]);
      setLibrary(nextLibrary);
      setAllFolders(folders.folders);
    } catch (caught) { setError(caught.message); }
  }, []);

  const openFolders = useCallback(() => openLibrary(null), [openLibrary]);
  const openFolder = useCallback((folderId) => openLibrary(folderId), [openLibrary]);

  const openWorkspace = useCallback(async (workspaceId) => {
    setError('');
    setScreen({ name: 'workspace', workspaceId });
    try { setWorkspace(await libraryApi.workspace(workspaceId)); }
    catch (caught) { setError(caught.message); }
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!workspace?.id) return;
    try { setWorkspace(await libraryApi.workspace(workspace.id)); }
    catch (caught) { notify(caught.message, 'error'); }
  }, [notify, workspace?.id]);

  /** Reload whatever is currently on screen after something changed under it. */
  const refresh = useCallback(async () => {
    if (screen.name === 'workspace') { await refreshWorkspace(); return; }
    await openLibrary(screen.folderId ?? null);
  }, [openLibrary, refreshWorkspace, screen.folderId, screen.name]);

  useEffect(() => { openFolders(); }, [openFolders]);

  /* ---- folders ---- */
  async function createFolder(folder) {
    await libraryApi.createFolder(folder);
    await openFolders();
    notify('Folder created.');
  }
  async function recolorFolder(folderId, color) {
    try { await libraryApi.updateFolder(folderId, { color }); await refresh(); }
    catch (caught) { notify(caught.message, 'error'); }
  }
  async function archiveFolder(folder, archived) {
    try {
      await libraryApi.archiveFolder(folder.id, archived);
      await openFolders();
      notify(archived ? 'Folder archived.' : 'Folder restored.');
    } catch (caught) { notify(caught.message, 'error'); }
  }
  async function deleteFolder(folder) {
    if (!window.confirm(`Delete the folder “${folder.name}”? Its recordings are kept.`)) return;
    try { await libraryApi.deleteFolder(folder.id); await openFolders(); notify('Folder deleted.'); }
    catch (caught) { notify(caught.message, 'error'); }
  }

  /* ---- recordings ---- */
  async function toggleFavourite(target) {
    try {
      await libraryApi.updateWorkspace(target.id, { favorite: !target.favorite });
      notify(target.favorite ? 'Removed from favourites.' : 'Added to favourites.');
      await refresh();
    } catch (caught) { notify(caught.message, 'error'); }
  }

  /* ---- files ---- */
  function pickFile(target) {
    fileTargetRef.current = target ?? {};
    fileInputRef.current?.click();
  }
  async function uploadFiles(files) {
    if (!files.length) return;
    try {
      await Promise.all(files.map((file) => libraryApi.uploadMaterial(file, fileTargetRef.current)));
      notify(`${files.length} file${files.length === 1 ? '' : 's'} added.`);
      await refresh();
    } catch (caught) { notify(caught.message, 'error'); }
  }
  async function deleteMaterial(material) {
    if (!window.confirm(`Delete ${material.original_filename}?`)) return;
    try { await libraryApi.deleteMaterial(material.id); await refresh(); }
    catch (caught) { notify(caught.message, 'error'); }
  }

  /* ---- capture ---- */
  function startCapture(workspaceTarget = null) {
    setCaptureContext({
      workspace: workspaceTarget,
      folder: workspaceTarget ? null : library?.current_folder ?? null,
    });
    setScreen({ name: 'capture' });
  }
  function cancelCapture() {
    const folderId = captureContext?.workspace?.folder_id ?? captureContext?.folder?.id ?? null;
    setCaptureContext(null);
    if (captureContext?.workspace) openWorkspace(captureContext.workspace.id);
    else openLibrary(folderId);
  }
  function captureSaved(workspaceId) { setCaptureContext(null); openWorkspace(workspaceId); }

  async function openSearchResult(result) {
    if (!result.workspace_id) { notify('That result is no longer available.', 'error'); return; }
    setPendingSeek(result.start_seconds != null
      ? { lectureId: result.lecture_id, seconds: result.start_seconds }
      : null);
    await openWorkspace(result.workspace_id);
  }

  if (error && !library && !workspace) return <BootError error={error} retry={openFolders} />;
  if (!library && screen.name !== 'workspace') return <Boot />;

  const showNav = ['folders', 'folder'].includes(screen.name);

  return (
    <div className="app-shell">
      {error && <div className="banner"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}

      {screen.name === 'folders' && library && (
        <FoldersScreen
          data={library}
          archived={allFolders.filter((folder) => folder.archived)}
          onOpenFolder={openFolder}
          onNewFolder={() => setFolderDialog(true)}
          onFolderMenu={setFolderSheet}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenResult={openSearchResult}
        />
      )}

      {screen.name === 'folder' && library?.current_folder && (
        <FolderScreen
          data={library}
          onBack={openFolders}
          onOpenWorkspace={openWorkspace}
          onFolderMenu={setFolderSheet}
          onWorkspaceMenu={setRecordingSheet}
          onDeleteMaterial={deleteMaterial}
          onAddFile={() => pickFile({ folderId: library.current_folder.id })}
        />
      )}

      {screen.name === 'workspace' && (workspace
        ? <PlaybackScreen
            workspace={workspace}
            folders={allFolders}
            courseName={allFolders.find((folder) => folder.id === workspace.folder_id)?.name ?? 'Unfiled'}
            onBack={() => (workspace.folder_id ? openFolder(workspace.folder_id) : openFolders())}
            onContinue={() => startCapture(workspace)}
            onReload={refreshWorkspace}
            onDelete={() => openLibrary(workspace.folder_id)}
            onToggleFavourite={toggleFavourite}
            onPickFile={pickFile}
            notify={notify}
            pendingSeek={pendingSeek}
            onSeekHandled={() => setPendingSeek(null)}
          />
        : <Boot />)}

      {screen.name === 'capture' && (
        <RecordScreen
          context={captureContext ?? {}}
          onSaved={captureSaved}
          onCancel={cancelCapture}
          notify={notify}
        />
      )}

      {showNav && (
        <BottomNavigation active="folders" onFolders={openFolders} onRecord={() => startCapture()} />
      )}

      {folderDialog && (
        <FolderDialog
          parent={library?.current_folder}
          onClose={() => setFolderDialog(false)}
          onCreate={createFolder}
        />
      )}

      {folderSheet && (
        <ActionSheet
          title={folderSheet.name}
          subtitle="Folder"
          onClose={() => setFolderSheet(null)}
          items={[
            { label: 'Colour', icon: 'levels', chevron: true, keepOpen: true, onSelect: () => { setColourSheet(folderSheet); setFolderSheet(null); } },
            { label: 'Add file', icon: 'upload', onSelect: () => pickFile({ folderId: folderSheet.id }) },
            {
              label: folderSheet.archived ? 'Restore Folder' : 'Archive Folder',
              icon: 'archive',
              onSelect: () => archiveFolder(folderSheet, !folderSheet.archived),
            },
            { label: 'Delete Folder', icon: 'trash', danger: true, onSelect: () => deleteFolder(folderSheet) },
          ]}
        />
      )}

      {colourSheet && (
        <ActionSheet title="Colour" subtitle={colourSheet.name} onClose={() => setColourSheet(null)}>
          <div className="swatch-row">
            {FOLDER_COLORS.map((color) => (
              <button
                key={color}
                data-tone={color}
                className={`swatch ${colourSheet.color === color ? 'on' : ''}`}
                aria-label={`${color} folder`}
                onClick={() => { recolorFolder(colourSheet.id, color); setColourSheet(null); }}
              />
            ))}
          </div>
        </ActionSheet>
      )}

      {recordingSheet && (
        <RecordingSheet
          workspace={recordingSheet}
          folders={allFolders}
          subtitle={allFolders.find((folder) => folder.id === recordingSheet.folder_id)?.name ?? 'Unfiled'}
          notify={notify}
          onClose={() => setRecordingSheet(null)}
          onChanged={refresh}
          onDeleted={() => { setRecordingSheet(null); refresh(); }}
          onToggleFavourite={toggleFavourite}
        />
      )}

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} notify={notify} />}

      <input
        ref={fileInputRef} hidden type="file" multiple
        accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx"
        onChange={(event) => { uploadFiles([...event.target.files]); event.target.value = ''; }}
      />

      <Toast toast={toast} />
    </div>
  );
}
