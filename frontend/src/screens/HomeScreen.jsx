import VFFolderCard from '../components/VFFolderCard';
import VFSearchField from '../components/VFSearchField';
import VFRecordingRow from '../components/VFRecordingRow';
import { Icon } from '../components/Icon';
import { COPY } from '../lib/copy';
import { recordingMeta } from '../lib/format';

/**
 * Home.
 *
 * A bento rather than a list: the first pinned folder takes the full width,
 * the rest pair up, and everything below the fold becomes a row. The point is
 * that the folder you use most is the biggest thing on the screen, not the
 * first item of a uniform list.
 *
 * The search field here does not search. Tapping it hands over to global
 * search, which has the recent-search chips and searches inside transcripts -
 * doing that inline would mean the results had nowhere to go.
 */
export default function HomeScreen({
  folders = [], unfiled = [], onOpenFolder, onNewFolder, onOrganize,
  onOpenSearch, onOpenWorkspace, onFolderMenu, onWorkspaceMenu, onPlay,
  playingId, progress = -1,
}) {
  const [hero, ...pinned] = folders.filter((folder) => folder.pinned);
  const rest = folders.filter((folder) => !folder.pinned);

  return (
    <main className="screen screen--dock">
      <header className="vf-head">
        <h1>Folders</h1>
        <div className="vf-head-actions">
          <button type="button" className="vf-round" aria-label="Organize" onClick={onOrganize}>
            <Icon name="move" strokeWidth={2.2} />
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

      {hero && (
        <section className="vf-bento" aria-label="Pinned folders">
          <VFFolderCard
            layout="hero" title={hero.name} count={hero.lecture_count ?? 0}
            color={hero.color} onPress={() => onOpenFolder(hero.id)}
            onMore={() => onFolderMenu(hero)}
          />
          {pinned.length > 0 && (
            <div className="vf-bento-pair">
              {pinned.map((folder) => (
                <VFFolderCard
                  key={folder.id} layout="tile" title={folder.name}
                  count={folder.lecture_count ?? 0} color={folder.color}
                  onPress={() => onOpenFolder(folder.id)} onMore={() => onFolderMenu(folder)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {rest.length > 0 && (
        <section className="vf-section" aria-label="Other folders">
          <h2 className="vf-label">Other</h2>
          <div className="vf-rows">
            {rest.map((folder) => (
              <VFFolderCard
                key={folder.id} layout="row" title={folder.name}
                count={folder.lecture_count ?? 0} color={folder.color}
                onPress={() => onOpenFolder(folder.id)}
              />
            ))}
          </div>
        </section>
      )}

      {unfiled.length > 0 && (
        <section className="vf-section" aria-label="Unfiled recordings">
          <h2 className="vf-label">Recent</h2>
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
