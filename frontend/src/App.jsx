import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HomeScreen from './screens/HomeScreen';
import FolderScreen from './screens/FolderScreen';
import RecordScreen from './screens/RecordScreen';
import PlaybackScreen from './screens/PlaybackScreen';
import SearchScreen from './screens/SearchScreen';
import MicDeniedScreen from './screens/MicDeniedScreen';
import SignInGate from './screens/SignInGate';
import RecordDock from './components/RecordDock';
import DragGhost from './components/DragGhost';
import DropTray from './components/DropTray';
import VFToast from './components/VFToast';
import FolderEditSheet from './components/FolderEditSheet';
import RecordingActionsSheet from './components/RecordingActionsSheet';
import AccountSheet from './components/AccountSheet';
import { accountApi, libraryApi } from './lib/api';
import useDragToFile from './lib/useDragToFile';

/**
 * A recording in no folder has `folder_id === null` and is simply listed on
 * Home as "Unfiled". There is no Inbox: a folder nobody made and nobody can
 * delete is not one the user asked for. `__out` is the drop strip's id for
 * "take it out of its folder".
 */
const toFolderId = (id) => (id === '__out' ? null : id);

function Boot() {
  return <main className="screen boot"><span className="spinner" /><p>Opening your recordings…</p></main>;
}

function BootError({ error, retry }) {
  return (
    <main className="screen boot">
      <h1>Couldn’t open Ekho</h1>
      <p>{error}</p>
      <button type="button" className="vf-btn vf-btn--primary" onClick={retry}>Try again</button>
    </main>
  );
}

/**
 * The shell.
 *
 * It owns the data, the sheets that can be raised from more than one screen,
 * and the record button - which is a shell concern rather than a screen one,
 * because the whole point of it is that it does not move between screens.
 * Everything else belongs to the screen showing it.
 */
export default function App() {
  const [screen, setScreen] = useState({ name: 'home' });
  const [library, setLibrary] = useState(null);
  const [allFolders, setAllFolders] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [folderSheet, setFolderSheet] = useState(null);   // {folder} | {} for new
  const [actionSheet, setActionSheet] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const [pendingSeek, setPendingSeek] = useState(null);
  const undo = useRef(null);

  const notify = useCallback((message, kind = 'success', action = null) => {
    setToast({ message, kind, action, id: Date.now() });
  }, []);

  /* ---- data ---------------------------------------------------------- */

  const load = useCallback(async (folderId = null) => {
    setError('');
    try {
      const [next, folders] = await Promise.all([
        libraryApi.library(toFolderId(folderId)),
        libraryApi.allFolders(),
      ]);
      setLibrary(next);
      setAllFolders(folders.folders ?? []);
      return next;
    } catch (caught) { setError(caught.message); return null; }
  }, []);

  useEffect(() => { load(null); }, [load]);

  /**
   * Whether to ask for sign-in before anything else.
   *
   * Only where Google sign-in exists: a build without it (older binary, no
   * Google Play, the desktop app, no server configured) opens straight in, so
   * the gate can never be a wall with no door. The status comes from the phone
   * shell, not the network, so this is answered at once. The shell announces
   * every change (cn:account), which is how signing out, deleting the account
   * or an expired session bring the gate back.
   */
  const [signIn, setSignIn] = useState('checking');   // checking | needed | open
  useEffect(() => {
    let alive = true;
    const decide = (status) => {
      if (!alive || !status) return;
      setSignIn(status.configured && status.google && !status.signedIn ? 'needed' : 'open');
    };
    accountApi.status().then(decide).catch(() => { if (alive) setSignIn('open'); });
    const onAccount = (event) => decide(event.detail);
    window.addEventListener('cn:account', onAccount);
    return () => { alive = false; window.removeEventListener('cn:account', onAccount); };
  }, []);

  const openHome = useCallback(async () => {
    setWorkspace(null);
    setScreen({ name: 'home' });
    await load(null);
  }, [load]);

  const openFolder = useCallback(async (folderId) => {
    setWorkspace(null);
    setScreen({ name: 'folder', folderId });
    await load(folderId);
  }, [load]);

  const openWorkspace = useCallback(async (workspaceId) => {
    setError('');
    setScreen({ name: 'play', workspaceId });
    try { setWorkspace(await libraryApi.workspace(workspaceId)); }
    catch (caught) { setError(caught.message); }
  }, []);

  const refresh = useCallback(async () => {
    if (screen.name === 'play' && workspace?.id) {
      try { setWorkspace(await libraryApi.workspace(workspace.id)); } catch { /* keep what we have */ }
      return;
    }
    await load(screen.folderId ?? null);
  }, [load, screen.name, screen.folderId, workspace?.id]);

  // Another device's changes have landed (the phone shell announces it after
  // a sync). Reload whatever is on screen - except mid-recording, where the
  // screen holds nothing from the library and must not be disturbed.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const screenRef = useRef(screen.name);
  screenRef.current = screen.name;
  useEffect(() => {
    const onData = () => { if (screenRef.current !== 'record') refreshRef.current(); };
    window.addEventListener('cn:data', onData);
    return () => window.removeEventListener('cn:data', onData);
  }, []);

  /* ---- folders -------------------------------------------------------- */

  // Every folder is a row, in the order the store returns them (by name).
  const folders = useMemo(() => allFolders.filter((folder) => !folder.archived), [allFolders]);

  const currentFolder = screen.name === 'folder' ? library?.current_folder : null;

  /* ---- actions -------------------------------------------------------- */

  const moveWorkspace = useCallback(async (item, targetId, { quiet = false } = {}) => {
    const folderId = toFolderId(targetId);
    const from = item.folder_id ?? null;
    if (from === folderId) return;
    try {
      await libraryApi.updateWorkspace(item.id, { folder_id: folderId });
      const name = folderId ? allFolders.find((f) => f.id === folderId)?.name : null;
      undo.current = { id: item.id, folderId: from };
      if (!quiet) {
        notify(folderId ? `Moved to ${name ?? 'the folder'}` : 'Taken out of the folder', 'success', 'Undo');
      }
      await refresh();
    } catch (caught) { notify(caught.message, 'error'); }
  }, [allFolders, notify, refresh]);

  const { drag, beginDrag, blockClick } = useDragToFile((item, targetId) => moveWorkspace(item, targetId));

  async function saveFolder({ name, color, icon = null }) {
    try {
      if (folderSheet?.folder) {
        await libraryApi.updateFolder(folderSheet.folder.id, { name, color, icon });
        notify('Folder updated');
      } else {
        await libraryApi.createFolder({ name, color, icon });
        notify('Folder created');
      }
      await refresh();
      const next = await libraryApi.allFolders();
      setAllFolders(next.folders ?? []);
    } catch (caught) { notify(caught.message, 'error'); }
  }

  async function deleteFolder(folder) {
    try {
      await libraryApi.deleteFolder(folder.id);
      notify(`“${folder.name}” deleted. Its recordings are now unfiled.`);
      await openHome();
    } catch (caught) { notify(caught.message, 'error'); }
  }

  async function deleteWorkspace(item) {
    try {
      await libraryApi.deleteWorkspace(item.id);
      notify('Recording deleted', 'error');
      if (screen.name === 'play') await openHome(); else await refresh();
    } catch (caught) { notify(caught.message, 'error'); }
  }

  async function runUndo() {
    const last = undo.current;
    setToast(null);
    if (!last) return;
    undo.current = null;
    try {
      await libraryApi.updateWorkspace(last.id, { folder_id: last.folderId });
      await refresh();
    } catch (caught) { notify(caught.message, 'error'); }
  }

  /* ---- record --------------------------------------------------------- */

  // Where a press records: Home leaves it unfiled, a folder records into that folder.
  function recordTarget() {
    return screen.name === 'folder' ? currentFolder : null;
  }
  const [recordFolder, setRecordFolder] = useState(null);
  function startRecording() {
    setRecordFolder(recordTarget());
    setScreen({ name: 'record', folderId: screen.folderId });
  }

  /* ---- render --------------------------------------------------------- */

  if (signIn === 'checking') return <Boot />;
  // Never over a recording in progress: the phone keeps recording whatever the
  // page shows, and unmounting the screen would lose the take's controls.
  if (signIn === 'needed' && screen.name !== 'record') {
    return (
      <div className="app-shell">
        <SignInGate onSignedIn={() => setSignIn('open')} />
      </div>
    );
  }

  // The microphone is asked for when someone first taps record, not before they
  // have seen the app. This is where a refusal lands.
  if (screen.name === 'denied') {
    return (
      <div className="app-shell">
        <MicDeniedScreen
          onOpenSettings={() => notify('Open Settings › Apps › Ekho › Permissions.', 'info')}
          onSkip={() => setScreen({ name: 'home' })}
        />
        {toast && (
          <VFToast key={toast.id} message={toast.message} kind={toast.kind} action="" visible
            lift="edge" onHide={() => setToast(null)} />
        )}
      </div>
    );
  }

  if (error && !library) return <BootError error={error} retry={() => load(null)} />;
  if (!library && screen.name !== 'play' && screen.name !== 'record') return <Boot />;

  const showDock = ['home', 'folder'].includes(screen.name);
  const dragFrom = drag?.item?.folder_id ?? null;
  const overLabel = drag?.over
    ? (drag.over === '__out'
        ? `Remove from ${currentFolder?.name ?? 'folder'}`
        : `Move to ${folders.find((f) => f.id === drag.over)?.name ?? 'folder'}`)
    : undefined;

  return (
    <div className="app-shell">
      {error && library && (
        <div className="banner"><span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="Dismiss">×</button>
        </div>
      )}

      {screen.name === 'home' && (
        <HomeScreen
          folders={folders}
          unfiled={library?.workspaces ?? []}
          onOpenFolder={openFolder}
          onNewFolder={() => setFolderSheet({ folder: null })}
          onAccount={() => setAccountOpen(true)}
          onOpenSearch={() => setScreen({ name: 'search' })}
          onOpenWorkspace={openWorkspace}
          onWorkspaceMenu={(item) => setActionSheet({ recording: item })}
          onPickUp={beginDrag}
          blockClick={blockClick}
          draggingId={drag?.item?.id}
        />
      )}

      {screen.name === 'folder' && (
        <FolderScreen
          folder={currentFolder}
          recordings={library?.workspaces ?? []}
          highlightId={highlightId}
          onBack={openHome}
          onEdit={() => setFolderSheet({ folder: currentFolder })}
          onOpenWorkspace={openWorkspace}
          onWorkspaceMenu={(item) => setActionSheet({ recording: item })}
          onPickUp={beginDrag}
          blockClick={blockClick}
          draggingId={drag?.item?.id}
        />
      )}

      {screen.name === 'search' && (
        <SearchScreen
          folders={folders}
          onBack={openHome}
          onOpenResult={async (result, term) => {
            setPendingSeek({ seconds: result.start_seconds ?? 0, term });
            await openWorkspace(result.workspace_id);
          }}
        />
      )}

      {screen.name === 'record' && (
        <RecordScreen
          folder={recordFolder}
          notify={notify}
          onDenied={() => setScreen({ name: 'denied' })}
          onSaved={(workspaceId) => openWorkspace(workspaceId)}
          onLeave={async (saved) => {
            setHighlightId(saved?.workspace_id ?? null);
            if (recordFolder) await openFolder(recordFolder.id); else await openHome();
          }}
        />
      )}

      {screen.name === 'play' && (workspace
        ? (
          <PlaybackScreen
            workspace={workspace}
            folders={folders}
            notify={notify}
            pendingSeek={pendingSeek}
            onSeekHandled={() => setPendingSeek(null)}
            onBack={() => (workspace.folder_id ? openFolder(workspace.folder_id) : openHome())}
            onReload={refresh}
            onShare={() => setActionSheet({ recording: workspace })}
            onMore={(context) => setActionSheet({ recording: workspace, ...context })}
          />
        )
        : <Boot />)}

      {showDock && (
        <RecordDock
          onPress={startRecording}
          drag={drag}
          dropOut={Boolean(drag) && dragFrom !== null}
          over={drag?.over === '__out'}
        />
      )}

      <FolderEditSheet
        open={Boolean(folderSheet)}
        folder={folderSheet?.folder ?? null}
        onClose={() => setFolderSheet(null)}
        onSave={saveFolder}
        onDelete={deleteFolder}
      />

      <RecordingActionsSheet
        open={Boolean(actionSheet)}
        recording={actionSheet?.recording}
        audioUrl={actionSheet?.audioUrl}
        subtitle={actionSheet?.subtitle}
        extras={actionSheet?.extras ?? []}
        notify={notify}
        onChanged={refresh}
        onClose={() => setActionSheet(null)}
        onDelete={() => deleteWorkspace(actionSheet.recording)}
      />

      <AccountSheet open={accountOpen} onClose={() => setAccountOpen(false)} notify={notify} />

      <DropTray drag={drag} folders={folders} />
      <DragGhost drag={drag} label={overLabel} />

      {toast && (
        <VFToast
          key={toast.id}
          message={toast.message}
          kind={toast.kind}
          action={toast.action ?? ''}
          visible
          lift={screen.name === 'play' ? 'play' : showDock ? 'record' : 'edge'}
          onAction={toast.action === 'Undo' ? runUndo : () => setToast(null)}
          onHide={() => setToast(null)}
        />
      )}
    </div>
  );
}
