import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import RecordingRow from './RecordingRow';
import { CompactFolderRow, FolderCard } from './FolderCard';
import { IconButton, SearchBar } from './ui';
import { dateLabel } from '../lib/format';
import { libraryApi } from '../lib/api';

/** How many folders lead the screen as full cards before the list takes over. */
const FEATURED = 3;

/**
 * Home.
 *
 * The first three folders are cards, because a folder is the thing this app is
 * organised around and it deserves the space. Everything after them is a row.
 *
 * The field searches two things at once and says which is which: folder names,
 * matched here as you type, and the words inside your recordings, matched by
 * the server. That is why search is a field on this screen rather than a tab of
 * its own - it is a way of finding what is already in front of you.
 */
export default function FoldersScreen({
  data, archived = [], onOpenFolder, onNewFolder, onFolderMenu, onOpenSettings, onOpenResult,
  onOpenWorkspace, onWorkspaceMenu, onPickUp, blockClick, draggingId,
}) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [searchNote, setSearchNote] = useState('');
  const ticketRef = useRef(0);

  const term = query.trim();
  const folders = data.folders.filter((folder) => folder.name.toLowerCase().includes(term.toLowerCase()));
  const featured = folders.slice(0, FEATURED);
  const rest = folders.slice(FEATURED);
  // Recordings that have not been filed yet. The library call already returns
  // them at the root, so this is data the screen was simply throwing away.
  const unfiled = data.workspaces ?? [];

  const runSearch = useCallback(async (text) => {
    if (!text) { ticketRef.current += 1; setMatches([]); setSearchNote(''); return; }
    const ticket = ++ticketRef.current;
    try {
      const found = await libraryApi.search(text);
      if (ticket !== ticketRef.current) return; // a newer keystroke won
      setMatches(found.results ?? []);
      setSearchNote('');
    } catch (caught) {
      if (ticket === ticketRef.current) { setMatches([]); setSearchNote(caught.message); }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => runSearch(term), 220);
    return () => window.clearTimeout(timer);
  }, [term, runSearch]);

  return (
    <main className="screen">
      <header className="head">
        <div className="head-title"><h1>Folders</h1></div>
        <div className="head-actions">
          <IconButton name="plus" label="New folder" variant="plain" onClick={onNewFolder} />
        </div>
      </header>

      <SearchBar value={query} onChange={setQuery} placeholder="Search folders…" label="Search folders and recordings" />

      {featured.length > 0 && (
        <section className="folder-cards" aria-label="Folders">
          {featured.map((folder) => (
            <FolderCard key={folder.id} folder={folder} onOpen={onOpenFolder} onMenu={onFolderMenu} />
          ))}
        </section>
      )}

      {unfiled.length > 0 && !term && (
        <section className="section">
          <div className="section-head"><h2>General</h2></div>
          <ul className="recording-rows">
            {unfiled.map((workspace) => (
              <RecordingRow
                key={workspace.id}
                title={workspace.title}
                lecture={{ created_at: workspace.updated_at, duration_seconds: workspace.duration_seconds }}
                onOpen={() => onOpenWorkspace(workspace.id)}
                onMenu={() => onWorkspaceMenu(workspace)}
                onPickUp={(event) => onPickUp(event, workspace)}
                blockClick={blockClick}
                dragging={draggingId === workspace.id}
              />
            ))}
          </ul>
        </section>
      )}

      {rest.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Other</h2></div>
          <div className="compact-rows">
            {rest.map((folder) => (
              <CompactFolderRow key={folder.id} folder={folder} onOpen={onOpenFolder} />
            ))}
          </div>
        </section>
      )}

      {archived.length > 0 && !term && (
        <section className="section">
          <div className="section-head"><h2>Archived</h2></div>
          <div className="compact-rows">
            {archived.map((folder) => (
              <CompactFolderRow key={folder.id} folder={folder} onOpen={() => onFolderMenu(folder)} />
            ))}
          </div>
        </section>
      )}

      {!folders.length && !unfiled.length && !term && (
        <section className="section">
          <p className="dim">Nothing here yet. Tap the record button to start, or + to make a folder.</p>
        </section>
      )}

      {!term && (
        <div className="compact-rows section">
          <button type="button" className="compact-row" onClick={onOpenSettings}>
            <span className="tone-mark"><Icon name="gear" /></span>
            <span className="compact-copy"><strong>Settings</strong></span>
            <span className="chev"><Icon name="chev" /></span>
          </button>
        </div>
      )}

      {term && (
        <section className="section">
          <div className="section-head"><h2>In your recordings</h2></div>
          {matches.length > 0
            ? <ul className="recording-rows">
                {matches.map((result) => (
                  <RecordingRow
                    key={`${result.lecture_id}-${result.start_seconds ?? 'x'}`}
                    title={result.title}
                    meta={[result.workspace_title, dateLabel(result.created_at)].filter(Boolean).join(' · ')}
                    onOpen={() => onOpenResult(result)}
                  />
                ))}
              </ul>
            : <p className="dim">{searchNote || (folders.length ? '' : `Nothing matched “${term}”.`)}</p>}
        </section>
      )}
    </main>
  );
}
