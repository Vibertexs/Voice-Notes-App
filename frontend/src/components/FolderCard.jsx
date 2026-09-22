import { Icon } from './Icon';
import { FolderArt } from './ui';
import { countLabel } from '../lib/format';

/**
 * A folder, in the two sizes the app has for one.
 *
 * The card is the loud version: a gradient panel with the artwork sitting in
 * it and the name over the bottom. The row is the quiet version, for folders
 * below the fold. They share the same colour, the same icon and the same
 * wording, so one reads as a smaller version of the other rather than as a
 * different idea.
 */

export const FOLDER_COLORS = ['rose', 'coral', 'amber', 'lime', 'blue', 'violet', 'slate'];

export function FolderCard({ folder, onOpen, onMenu, droppable = true }) {
  return (
    <article className="folder-card" data-tone={folder.color} data-drop={droppable ? folder.id : undefined}>
      <FolderArt icon={folder.icon} />
      <button className="folder-open" onClick={() => onOpen(folder.id)}>
        <span className="folder-copy">
          <strong>{folder.name}</strong>
          <small>{countLabel(folder.lecture_count ?? 0)}</small>
        </span>
      </button>
      <button className="folder-menu" onClick={() => onMenu(folder)} aria-label={`Options for ${folder.name}`}>
        <Icon name="more" />
      </button>
    </article>
  );
}

export function CompactFolderRow({ folder, onOpen }) {
  return (
    <button className="compact-row" data-tone={folder.color} data-drop={folder.id} onClick={() => onOpen(folder.id)}>
      <span className="tone-mark"><Icon name={folder.icon || 'folder'} /></span>
      <span className="compact-copy">
        <strong>{folder.name}</strong>
        <small>{countLabel(folder.lecture_count ?? 0)}</small>
      </span>
      <span className="chev"><Icon name="chev" /></span>
    </button>
  );
}
