import VFFolderCard from '../components/VFFolderCard';
import VFRecordingRow from '../components/VFRecordingRow';
import { Icon } from '../components/Icon';
import { COPY } from '../lib/copy';
import { recordingMeta } from '../lib/format';

/**
 * Filing, as a screen of its own.
 *
 * Moving a recording one at a time through a sheet is fine for one recording
 * and miserable for ten, so this puts every folder and every recording on one
 * screen and lets you throw them across. The filter chips are what make it
 * usable with more folders than fit: they narrow the list, not the targets.
 *
 * The source folder is shown as a disabled target rather than removed, because
 * a grid that reflows while you are dragging over it is a grid you cannot aim
 * at.
 */
export default function OrganizeScreen({
  folders = [], recordings = [], filter = 'all', onFilter,
  onBack, onDone, onPickUp, drag,
}) {
  const dragged = drag?.item ?? null;
  const sourceId = dragged?.folder_id ?? null;

  return (
    <main className="screen screen--organize">
      <header className="vf-bar">
        <button type="button" className="vf-round vf-round--plain" aria-label="Back" onClick={onBack}>
          <Icon name="back" strokeWidth={2.2} />
        </button>
        <span className="vf-bar-copy">
          <strong>Organize</strong>
          <small>{COPY.orgSub}</small>
        </span>
        <button type="button" className="vf-done" onClick={onDone}>Done</button>
      </header>

      <div className="org-targets">
        {folders.map((folder) => {
          const isSource = folder.id === sourceId;
          return (
            <VFFolderCard
              key={folder.id}
              layout="target"
              title={folder.name}
              color={folder.color}
              count={folder.lecture_count ?? 0}
              meta={isSource ? 'Current' : (drag?.over === folder.id ? 'Drop to move' : undefined)}
              active={drag?.over === folder.id && !isSource}
              disabled={isSource}
              dropId={isSource ? undefined : folder.id}
            />
          );
        })}
      </div>

      <div className="chips chips--scroll" role="tablist" aria-label="Filter by folder">
        <button
          type="button" role="tab" aria-selected={filter === 'all'}
          className={`chip${filter === 'all' ? ' is-on' : ''}`}
          onClick={() => onFilter('all')}
        >All</button>
        {folders.map((folder) => (
          <button
            key={folder.id} type="button" role="tab" aria-selected={filter === folder.id}
            data-tone={folder.color}
            className={`chip chip--tone${filter === folder.id ? ' is-on' : ''}`}
            onClick={() => onFilter(folder.id)}
          >
            <i className="chip-dot" />
            {folder.name}
            <span className="chip-count">{folder.lecture_count ?? 0}</span>
          </button>
        ))}
      </div>

      {recordings.length > 0 ? (
        <ul className="vf-rows">
          {recordings.map((workspace) => (
            <VFRecordingRow
              key={workspace.id}
              mode="drag"
              title={workspace.title}
              meta={recordingMeta({
                created_at: workspace.updated_at,
                duration_seconds: workspace.duration_seconds,
              })}
              dragging={dragged?.id === workspace.id}
              onDragStart={(event) => onPickUp(event, workspace)}
            />
          ))}
        </ul>
      ) : (
        <p className="vf-empty-line">{COPY.orgEmpty}</p>
      )}
    </main>
  );
}
