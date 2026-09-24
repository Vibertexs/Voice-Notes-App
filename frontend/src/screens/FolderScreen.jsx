import VFRecordingRow from '../components/VFRecordingRow';
import VFWaveform from '../components/VFWaveform';
import { Icon } from '../components/Icon';
import { COPY } from '../lib/copy';
import { countLabel, recordingMeta } from '../lib/format';

/**
 * One folder.
 *
 * The folder's colour arrives as a glow behind the header and nowhere else, so
 * you know which folder you are in without the screen being tinted. It is the
 * same trick the cards use, at screen scale.
 *
 * There is no "New Recording" button. The persistent record button is already
 * on screen and already knows it is here - adding a second way to start would
 * mean two record buttons on one screen, which is one too many.
 */
export default function FolderScreen({
  folder, recordings = [], onBack, onOrganize, onEdit,
  onOpenWorkspace, onWorkspaceMenu, onPlay, playingId, progress = -1, highlightId,
}) {
  if (!folder) return null;

  return (
    <main className="screen screen--folder" data-tone={folder.color}>
      <div className="folder-glow" aria-hidden="true" />

      <header className="vf-bar">
        <button type="button" className="vf-round vf-round--plain" aria-label="Back" onClick={onBack}>
          <Icon name="back" strokeWidth={2.2} />
        </button>
        <span className="vf-bar-spacer" />
        <button type="button" className="vf-round vf-round--plain" aria-label="Organize" onClick={onOrganize}>
          <Icon name="move" strokeWidth={2.2} />
        </button>
        <button type="button" className="vf-round vf-round--plain" aria-label="Edit folder" onClick={onEdit}>
          <Icon name="more" strokeWidth={2.2} />
        </button>
      </header>

      <div className="folder-head">
        <span className="folder-head-icon"><Icon name="folderSolid" /></span>
        <h1>{folder.name}</h1>
        <p>{countLabel(folder.lecture_count ?? recordings.length)}</p>
      </div>

      {recordings.length > 0 ? (
        <ul className="vf-rows">
          {recordings.map((workspace) => (
            <VFRecordingRow
              key={workspace.id}
              title={workspace.title}
              meta={recordingMeta({
                created_at: workspace.updated_at,
                duration_seconds: workspace.duration_seconds,
              })}
              highlight={workspace.id === highlightId}
              playing={playingId === workspace.id}
              progress={playingId === workspace.id ? progress : -1}
              onPress={() => onOpenWorkspace(workspace.id)}
              onPlay={() => onPlay?.(workspace)}
              onMore={() => onWorkspaceMenu(workspace)}
            />
          ))}
        </ul>
      ) : (
        <div className="folder-empty">
          <VFWaveform height={54} seed={5} dim />
          <strong>{COPY.emptyTitle}</strong>
          <p>{COPY.emptySub}</p>
          <span className="folder-empty-line" aria-hidden="true" />
        </div>
      )}
    </main>
  );
}
