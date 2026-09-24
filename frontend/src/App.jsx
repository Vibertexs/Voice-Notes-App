import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HomeScreen from './screens/HomeScreen';
import FolderScreen from './screens/FolderScreen';
import RecordScreen from './screens/RecordScreen';
import PlaybackScreen from './screens/PlaybackScreen';
import SearchScreen from './screens/SearchScreen';
import OrganizeScreen from './screens/OrganizeScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import RecordDock from './components/RecordDock';
import DragGhost from './components/DragGhost';
import VFToast from './components/VFToast';
import FolderEditSheet from './components/FolderEditSheet';
import MoveToFolderSheet from './components/MoveToFolderSheet';
import RecordingActionsSheet from './components/RecordingActionsSheet';
import SettingsDialog from './components/SettingsDialog';
import { libraryApi } from './lib/api';
import useDragToFile from './lib/useDragToFile';

const SEEN_KEY = 'vf.onboarded';
const PINNED_KEY = 'vf.pinned';

/**
 * Which folders lead the bento.
 *
 * The handoff's folder model has a `pinned` flag; the store has nowhere to put
 * one and `backend/` is off limits, so the choice is kept per device. Nothing
 * chosen yet means the first three, which is what it looked like before. A
 * folder you just made is pinned straight away - landing a new folder under
 * "Other", below the ones it was made to sit beside, is not what making it
 * meant.
 */
const PIN_LIMIT = 5;
function readPinned() {
  try { return JSON.parse(window.localStorage.getItem(PINNED_KEY) ?? 'null'); }
  catch { return null; }
}
function writePinned(ids) {
  try { window.localStorage.setItem(PINNED_KEY, JSON.stringify(ids)); }
  catch { /* private mode */ }
}

/**
 * Inbox is where a recording is when it is nowhere: `folder_id === null`.
 *
 * The handoff treats Inbox as a folder you can drop onto and record into, but
 * the store has no such row - unfiled recordings simply have no folder. Making
 * one real would mean a migration and a folder nobody can delete, so it is a
 * folder here and null underneath, in one place.
 */
const INBOX = { id: '__inbox', name: 'Inbox', color: 'graphite', virtual: true };
const toFolderId = (id) => (id === INBOX.id || id === '__out' ? null : id);

function Boot() {
  return <main className="screen boot"><span className="spinner" /><p>Opening your recordings…</p></main>;
}

function BootError({ error, retry }) {
  return (
    <main className="screen boot">
      <h1>Couldn’t open VoiceFlow</h1>
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
  const [moveSheet, setMoveSheet] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [organizeFilter, setOrganizeFilter] = useState('all');
  const [highlightId, setHighlightId] = useState(null);
  const [pendingSeek, setPendingSeek] = useState(null);
  const [pinnedIds, setPinnedIds] = useState(readPinned);
  const [onboarded, setOnboarded] = useState(() => {
    try { return window.localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
  });
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

  /**
   * Every recording there is, for Organize's "All" filter.
   *
   * /api/library answers for one folder at a time - with no folder it returns
   * only the unfiled ones - and there is no endpoint that returns the lot. So
   * All is assembled here, one call per folder. That is fine at the scale a
   * phone holds and it keeps the change out of the API.
   */
  const loadEverything = useCallback(async () => {
    setError('');
    try {
      const folders = (await libraryApi.allFolders()).folders ?? [];
      setAllFolders(folders);
      const parts = await Promise.all([
        libraryApi.library(null),
        ...folders.filter((folder) => !folder.archived).map((folder) => libraryApi.library(folder.id)),
      ]);
      setLibrary({
        ...parts[0],
        workspaces: parts.flatMap((part) => part.workspaces ?? []),
      });
    } catch (caught) { setError(caught.message); }
  }, []);

  useEffect(() => { load(null); }, [load]);

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

  /* ---- folders, with Inbox folded in --------------------------------- */

  // The stored folders lead and the first three are the bento's pinned set;
  // the handoff's `pinned` flag has nowhere to live in the store yet, so
  // position stands in for it. Inbox goes last and is never pinned - it is
  // where things are when they are nowhere, which is not what the biggest card
  // on the screen should be for.
  const folders = useMemo(() => {
    const unfiledCount = screen.name === 'home' ? (library?.workspaces?.length ?? 0) : 0;
    const inbox = { ...INBOX, lecture_count: unfiledCount, pinned: false };
    const live = allFolders.filter((folder) => !folder.archived);
    const chosen = pinnedIds ?? live.slice(0, 3).map((folder) => folder.id);
    const marked = live.map((folder) => ({ ...folder, pinned: chosen.includes(folder.id) }));
    // Pinned folders lead, in the order they were pinned, so a new one is the
    // hero rather than appearing wherever its name happens to sort.
    const featured = chosen
      .map((id) => marked.find((folder) => folder.id === id))
      .filter(Boolean);
    const others = marked.filter((folder) => !chosen.includes(folder.id));
    return [...featured, ...others, inbox];
  }, [allFolders, library?.workspaces?.length, screen.name, pinnedIds]);

  const pin = useCallback((folderId, on) => {
    setPinnedIds((current) => {
      const live = allFolders.filter((folder) => !folder.archived);
      const base = current ?? live.slice(0, 3).map((folder) => folder.id);
      const next = on
        ? [folderId, ...base.filter((id) => id !== folderId)].slice(0, PIN_LIMIT)
        : base.filter((id) => id !== folderId);
      writePinned(next);
      return next;
    });
  }, [allFolders]);

  const currentFolder = screen.name === 'folder'
    ? (screen.folderId === INBOX.id ? folders[0] : library?.current_folder)
    : null;

  /* ---- actions -------------------------------------------------------- */

  const moveWorkspace = useCallback(async (item, targetId, { quiet = false } = {}) => {
    const folderId = toFolderId(targetId);
    const from = item.folder_id ?? null;
    if (from === folderId) return;
    try {
      await libraryApi.updateWorkspace(item.id, { folder_id: folderId });
      const name = folderId ? allFolders.find((f) => f.id === folderId)?.name : INBOX.name;
      undo.current = { id: item.id, folderId: from };
      if (!quiet) {
        notify(`Moved to ${name ?? 'the folder'}`, 'success', 'Undo');
      }
      await refresh();
    } catch (caught) { notify(caught.message, 'error'); }
  }, [allFolders, notify, refresh]);

  const { drag, beginDrag } = useDragToFile((item, targetId) => moveWorkspace(item, targetId));

  async function saveFolder({ name, color }) {
    try {
      if (folderSheet?.folder && !folderSheet.folder.virtual) {
        await libraryApi.updateFolder(folderSheet.folder.id, { name, color });
        notify('Folder updated');
      } else {
        const created = await libraryApi.createFolder({ name, color });
        if (created?.id) pin(created.id, true);
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
      notify(`“${folder.name}” deleted. Its recordings moved to ${INBOX.name}.`);
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

  // Where a press records, per the handoff: Home to Inbox, Folder to that
  // folder, Organize to the folder the filter names.
  function recordTarget() {
    if (screen.name === 'folder') return currentFolder?.virtual ? null : currentFolder;
    if (screen.name === 'organize' && organizeFilter !== 'all') {
      return folders.find((folder) => folder.id === organizeFilter && !folder.virtual) ?? null;
    }
    return null;
  }
  const [recordFolder, setRecordFolder] = useState(null);
  function startRecording() {
    setRecordFolder(recordTarget());
    setScreen({ name: 'record', folderId: screen.folderId });
  }

  /* ---- render --------------------------------------------------------- */

  if (!onboarded && screen.name !== 'record') {
    return (
      <div className="app-shell">
        <OnboardingScreen
          denied={screen.name === 'denied'}
          onAllow={() => {
            try { window.localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ }
            setOnboarded(true);
            startRecording();
          }}
          onOpenSettings={() => notify('Open Settings › Apps › VoiceFlow › Permissions.', 'info')}
          onSkip={() => {
            try { window.localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ }
            setOnboarded(true);
            setScreen({ name: 'home' });
          }}
        />
      </div>
    );
  }

  if (error && !library) return <BootError error={error} retry={() => load(null)} />;
  if (!library && screen.name !== 'play' && screen.name !== 'record') return <Boot />;

  const showDock = ['home', 'folder', 'organize'].includes(screen.name);
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
          onOrganize={() => { setOrganizeFilter('all'); setScreen({ name: 'organize' }); loadEverything(); }}
          onOpenSearch={() => setScreen({ name: 'search' })}
          onOpenWorkspace={openWorkspace}
          onFolderMenu={(folder) => setFolderSheet({ folder })}
          onWorkspaceMenu={(item) => setActionSheet({ recording: item })}
        />
      )}

      {screen.name === 'folder' && (
        <FolderScreen
          folder={currentFolder}
          recordings={library?.workspaces ?? []}
          highlightId={highlightId}
          onBack={openHome}
          onOrganize={() => { setOrganizeFilter(screen.folderId ?? 'all'); setScreen({ name: 'organize' }); }}
          onEdit={() => setFolderSheet({ folder: currentFolder })}
          onOpenWorkspace={openWorkspace}
          onWorkspaceMenu={(item) => setActionSheet({ recording: item })}
        />
      )}

      {screen.name === 'organize' && (
        <OrganizeScreen
          folders={folders}
          filter={organizeFilter}
          recordings={(library?.workspaces ?? [])}
          drag={drag}
          onFilter={async (next) => {
            setOrganizeFilter(next);
            if (next === 'all') await loadEverything(); else await load(next);
          }}
          onBack={() => (screen.folderId ? openFolder(screen.folderId) : openHome())}
          onDone={() => (screen.folderId ? openFolder(screen.folderId) : openHome())}
          onPickUp={beginDrag}
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
          onDenied={() => { setOnboarded(false); setScreen({ name: 'denied' }); }}
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
          dropOut={screen.name === 'organize' && Boolean(drag) && dragFrom !== null}
          over={drag?.over === '__out'}
        />
      )}

      <FolderEditSheet
        open={Boolean(folderSheet)}
        folder={folderSheet?.folder ?? null}
        onClose={() => setFolderSheet(null)}
        onSave={saveFolder}
        onDelete={deleteFolder}
        onPin={pin}
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
        onMove={() => setMoveSheet(actionSheet?.recording)}
        onDelete={() => deleteWorkspace(actionSheet.recording)}
      />

      <MoveToFolderSheet
        open={Boolean(moveSheet)}
        recording={moveSheet}
        folders={folders}
        onClose={() => setMoveSheet(null)}
        onMove={(target) => moveWorkspace(moveSheet, target.id)}
      />

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} notify={notify} />}

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
