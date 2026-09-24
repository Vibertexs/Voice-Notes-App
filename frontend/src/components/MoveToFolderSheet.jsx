import { useEffect, useState } from 'react';
import VFBottomSheet from './VFBottomSheet';
import VFButton from './VFButton';
import { Icon } from './Icon';

/**
 * Move one recording.
 *
 * The folder it is already in stays in the list, marked and unpickable, rather
 * than being hidden: seeing where it is now is how you decide where it should
 * go. The button names the destination so the sheet can be confirmed without
 * re-reading the list, and it stays disabled until there is a destination to
 * name.
 */
export default function MoveToFolderSheet({ open, recording, folders = [], onClose, onMove }) {
  const current = recording?.folder_id ?? null;
  const [picked, setPicked] = useState(null);

  useEffect(() => { if (open) setPicked(null); }, [open, recording?.id]);

  const target = folders.find((folder) => folder.id === picked);

  return (
    <VFBottomSheet open={open} title="Move to folder" onClose={onClose}>
      <ul className="pick-list">
        {folders.map((folder) => {
          const isCurrent = folder.id === current;
          return (
            <li key={folder.id}>
              <button
                type="button"
                data-tone={folder.color}
                className={`pick${picked === folder.id ? ' is-picked' : ''}${isCurrent ? ' is-current' : ''}`}
                disabled={isCurrent}
                onClick={() => setPicked(folder.id)}
              >
                <span className="pick-swatch" />
                <span className="pick-name">{folder.name}</span>
                {isCurrent
                  ? <span className="pick-current">Current</span>
                  : <span className="pick-radio">{picked === folder.id && <Icon name="check" strokeWidth={3} />}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <VFButton
        label={target ? `Move to ${target.name}` : 'Move to folder'}
        disabled={!target}
        onPress={() => { onClose?.(); onMove?.(target); }}
      />
    </VFBottomSheet>
  );
}
