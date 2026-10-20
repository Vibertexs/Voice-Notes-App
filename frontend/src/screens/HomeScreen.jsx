import VFFolderCard from '../components/VFFolderCard';
import VFSearchField from '../components/VFSearchField';
import VFRecordingRow from '../components/VFRecordingRow';
import { Icon } from '../components/Icon';
import { COPY } from '../lib/copy';
import { greetingLine, recordingMeta } from '../lib/format';

/**
 * Home.
 *
 * Every folder is the same row, so the screen reads as one list and a new
 * folder lands where its name sorts rather than jumping to the top.
 *
 * While a recording is being carried, every folder card is a drop target (`data-drop`),
 * so it is filed by dropping it on the folder where it is already on screen; there is no
 * separate picker. (The folder screen has no folder cards to drop on, so it shows a tray.)
 *
 * The search field here does not search. Tapping it hands over to global
 * search, which has the recent-search chips and searches inside transcripts -
 * doing that inline would mean the results had nowhere to go.
 */
export default function HomeScreen({
  folders = [], unfiled = [], onOpenFolder, onNewFolder, onAccount,
  onOpenSearch, onOpenWorkspace, onWorkspaceMenu, onPlay, onPickUp, blockClick, draggingId, dragOver = null,
  playingId, progress = -1,
}) {
  return (
    <main className="screen screen--dock">
      <p className="vf-greeting">{greetingLine()}</p>
      <header className="vf-head">
        <h1>Folders</h1>
        <div className="vf-head-actions">
          <button type="button" className="vf-round" aria-label="Account" onClick={onAccount}>
            <Icon name="person" strokeWidth={2.2} />
          </button>
          <button type="button" className="vf-round" aria-label="New folder" onClick={onNewFolder}>
            <Icon name="plus" strokeWidth={2.6} />
          </button>
        </div>
      </header>

      <VFSearchField
        className="search-bar"
        readOnly
        value=""
        placeholder="Search recordings & transcripts"
        label={COPY.searchHint}
        onFocus={onOpenSearch}
      />

      {folders.length > 0 && (
        <section className="vf-section vf-section--first" aria-label="Folders">
          <div className="vf-rows">
            {folders.map((folder) => (
              <VFFolderCard
                key={folder.id} layout="row" title={folder.name}
                count={folder.lecture_count ?? 0} color={folder.color} icon={folder.icon}
                dropId={folder.id} active={dragOver === folder.id}
                meta={dragOver === folder.id ? 'Release to move' : undefined}
                onPress={() => onOpenFolder(folder.id)}
              />
            ))}
          </div>
        </section>
      )}

      {unfiled.length > 0 && (
        <section className="vf-section" aria-label="Unfiled recordings">
          <h2 className="vf-label">Unfiled</h2>
          <ul className="vf-rows">
            {unfiled.map((workspace) => (
              <VFRecordingRow
                key={workspace.id}
                title={workspace.title}
                meta={recordingMeta({
                  created_at: workspace.updated_at,
                  duration_seconds: workspace.duration_seconds,
                })}
                playing={playingId === workspace.id}
                progress={playingId === workspace.id ? progress : -1}
                dragging={draggingId === workspace.id}
                cloudOnly={workspace.cloud_only}
                guard={blockClick}
                onHold={onPickUp ? (event) => onPickUp(event, workspace) : undefined}
                onPress={() => onOpenWorkspace(workspace.id)}
                onPlay={() => onPlay?.(workspace)}
                onMore={() => onWorkspaceMenu(workspace)}
              />
            ))}
          </ul>
        </section>
      )}

      {!folders.length && !unfiled.length && (
        <p className="vf-empty-line">Nothing here yet. Tap record to start, or + to make a folder.</p>
      )}
    </main>
  );
}
