import { useEffect, useState } from 'react';
import VFBottomSheet from './VFBottomSheet';
import VFButton from './VFButton';
import VFFolderCard from './VFFolderCard';
import { SWATCHES } from '../lib/copy';

/**
 * Make a folder, or change one.
 *
 * The preview is a real VFFolderCard rather than a swatch grid, so the choice
 * is made against the thing being chosen - a colour that looks right as a chip
 * does not always look right as a card.
 *
 * Deleting keeps the recordings and moves them to Inbox, which is why the
 * button says so. A folder is a shelf, not a container.
 */
export default function FolderEditSheet({ open, folder = null, onClose, onSave, onDelete, onPin }) {
  const editing = Boolean(folder);
  const [name, setName] = useState('');
  const [color, setColor] = useState('red');

  useEffect(() => {
    if (!open) return;
    setName(folder?.name ?? '');
    setColor(folder?.color && SWATCHES.includes(folder.color) ? folder.color : 'red');
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

      <div className="sheet-preview">
        <VFFolderCard
          layout="hero"
          title={name.trim() || 'Folder name'}
          count={folder?.lecture_count ?? 0}
          color={color}
        />
      </div>

      <VFButton
        label={editing ? 'Save' : 'Create folder'}
        icon={editing ? 'check' : 'plus'}
        disabled={!name.trim()}
        onPress={() => { onClose?.(); onSave?.({ name: name.trim(), color }); }}
      />

      {editing && !folder.virtual && (
        <VFButton
          label={folder.pinned ? 'Unpin from the top' : 'Pin to the top'}
          variant="secondary"
          onPress={() => { onClose?.(); onPin?.(folder.id, !folder.pinned); }}
        />
      )}

      {editing && !folder.virtual && (
        <VFButton
          label="Delete folder"
          variant="danger"
          onPress={() => { onClose?.(); onDelete?.(folder); }}
        />
      )}
    </VFBottomSheet>
  );
}
