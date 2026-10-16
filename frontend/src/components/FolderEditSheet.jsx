import { useEffect, useState } from 'react';
import VFBottomSheet from './VFBottomSheet';
import VFButton from './VFButton';
import VFFolderCard from './VFFolderCard';
import { SWATCHES } from '../lib/copy';
import { FOLDER_ICONS, Icon } from './Icon';

/**
 * Make a folder, or change one.
 *
 * The preview is a real VFFolderCard rather than a swatch grid, so the choice
 * is made against the thing being chosen - a colour that looks right as a chip
 * does not always look right as a card.
 *
 * Deleting keeps the recordings and leaves them unfiled, which is why the
 * button says so. A folder is a shelf, not a container.
 */
export default function FolderEditSheet({ open, folder = null, onClose, onSave, onDelete }) {
  const editing = Boolean(folder);
  const [name, setName] = useState('');
  const [color, setColor] = useState('red');
  const [icon, setIcon] = useState(null);

  useEffect(() => {
    if (!open) return;
    setName(folder?.name ?? '');
    setColor(folder?.color && SWATCHES.includes(folder.color) ? folder.color : 'red');
    setIcon(folder?.icon && FOLDER_ICONS.includes(folder.icon) ? folder.icon : null);
  }, [open, folder]);

  return (
    <VFBottomSheet open={open} title={editing ? 'Edit folder' : 'New folder'} onClose={onClose}>
      <input
        className="sheet-input"
        value={name}
        placeholder="Folder name"
        aria-label="Folder name"
        maxLength={60}
        onChange={(event) => setName(event.target.value)}
      />

      <div className="swatches" role="radiogroup" aria-label="Folder colour">
        {SWATCHES.map((tone) => (
          <button
            key={tone}
            type="button"
            role="radio"
            aria-checked={color === tone}
            aria-label={tone}
            data-tone={tone}
            className={`swatch${color === tone ? ' is-on' : ''}`}
            onClick={() => setColor(tone)}
          />
        ))}
      </div>

      <div className="icon-picks" role="radiogroup" aria-label="Folder icon" data-tone={color}>
        {[null, ...FOLDER_ICONS].map((name) => (
          <button
            key={name ?? 'folder'}
            type="button"
            role="radio"
            aria-checked={icon === name}
            aria-label={name ?? 'plain folder'}
            className={`icon-pick${icon === name ? ' is-on' : ''}`}
            onClick={() => setIcon(name)}
          >
            {name ? <Icon name={name} strokeWidth={2} /> : <Icon name="folderSolid" />}
          </button>
        ))}
      </div>

      <div className="sheet-preview">
        <VFFolderCard
          layout="row"
          title={name.trim() || 'Folder name'}
          count={folder?.lecture_count ?? 0}
          color={color}
          icon={icon}
        />
      </div>

      <VFButton
        label={editing ? 'Save' : 'Create folder'}
        icon={editing ? 'check' : 'plus'}
        disabled={!name.trim()}
        onPress={() => { onClose?.(); onSave?.({ name: name.trim(), color, icon }); }}
      />

      {editing && (
        <VFButton
          label="Delete folder"
          variant="danger"
          onPress={() => { onClose?.(); onDelete?.(folder); }}
        />
      )}
    </VFBottomSheet>
  );
}
