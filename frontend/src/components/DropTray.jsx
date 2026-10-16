import VFFolderCard from './VFFolderCard';

/**
 * Where a held recording can be dropped.
 *
 * It opens on the side of the screen away from the finger. Opening it under the
 * finger would arm a folder before the person had moved, and a tray that covers
 * the row you are carrying is hard to aim from. The folder it came from stays
 * in the grid, dimmed, because a grid that reflows while you drag over it is a
 * grid you cannot aim at.
 *
 * Removing it from its folder is not here: that is the strip where the record
 * button was (RecordDock), which is where the thumb already is.
 *
 * Targets are found by hit-testing under the finger for `data-drop`, so nothing
 * is registered with the drag layer.
 */
export default function DropTray({ drag, folders = [] }) {
  if (!drag) return null;
  const sourceId = drag.item?.folder_id ?? null;
  if (!folders.length) return null;
  const below = (drag.startY ?? 0) < window.innerHeight * 0.45;

  return (
    <div
      className={`drop-tray ${below ? 'is-bottom' : 'is-top'}`}
      style={{ '--cols': folders.length > 6 ? 4 : 3 }}
      aria-hidden="true"
    >
      <p className="drop-tray-title">Drop on a folder</p>
      <div className="drop-tray-grid">
        {folders.map((folder) => {
          const isSource = folder.id === sourceId;
          return (
            <VFFolderCard
              key={folder.id}
              layout="target"
              title={folder.name}
              color={folder.color}
              icon={folder.icon}
              count={folder.lecture_count ?? 0}
              meta={isSource ? 'Current' : (drag.over === folder.id ? 'Release to move' : undefined)}
              active={drag.over === folder.id && !isSource}
              disabled={isSource}
              dropId={isSource ? undefined : folder.id}
            />
          );
        })}
      </div>
    </div>
  );
}
