import { useEffect, useRef, useState } from 'react';
import CoverArt from './CoverArt';
import { Icon } from './Icon';

const COLORS = ['blue', 'violet', 'rose', 'coral', 'amber', 'lime', 'mint', 'sky', 'slate'];

/**
 * A class, as cover art. Its actions stay behind the corner button so the
 * tile itself is one target: tap to open, drag a lecture onto it to file it.
 */
export default function ClassCard({ folder, onOpen, onArchive, onRecolor, onDelete, onDropWorkspace }) {
  const [over, setOver] = useState(false);
  const [menu, setMenu] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (event) => { if (!rootRef.current?.contains(event.target)) setMenu(false); };
    const escape = (event) => { if (event.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);

  const lectures = folder.lecture_count ?? 0;
  const summary = lectures === 0 ? 'Empty' : `${lectures} lecture${lectures === 1 ? '' : 's'}`;

  return (
    <div
      ref={rootRef}
      className={`tile ${over ? 'drop-active' : ''} ${menu ? 'menu-open' : ''}`}
    >
      <button
        className="tile-open"
        onClick={() => onOpen(folder.id)}
        onDragOver={(event) => { event.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => { event.preventDefault(); setOver(false); onDropWorkspace(event, folder.id); }}
        aria-label={`Open ${folder.name}`}
      >
        <span className="tile-art">
          <CoverArt id={folder.id} color={folder.color} label={folder.name} />
        </span>
        <span className="tile-name">{folder.name}</span>
        <span className="tile-meta">{over ? 'Drop to file here' : summary}</span>
      </button>

      <button
        className="tile-menu"
        onClick={() => setMenu((open) => !open)}
        aria-label={`Options for ${folder.name}`}
        aria-expanded={menu}
        aria-haspopup="menu"
      ><Icon name="more" /></button>

      {menu && (
        <div className="menu" role="menu" aria-label={`${folder.name} options`}>
          <div className="menu-swatches">
            {COLORS.map((color) => (
              <button
                key={color}
                className={`swatch ${color} ${color === folder.color ? 'current' : ''}`}
                role="menuitem"
                aria-label={`Colour ${color}`}
                onClick={() => { onRecolor(folder.id, color); setMenu(false); }}
              />
            ))}
          </div>
          <button className="menu-item" role="menuitem" onClick={() => { onArchive(folder.id, !folder.archived); setMenu(false); }}>
            {folder.archived ? 'Restore class' : 'Archive class'}
          </button>
          <button className="menu-item danger" role="menuitem" onClick={() => { onDelete(folder); setMenu(false); }}>
            Delete class
          </button>
        </div>
      )}
    </div>
  );
}
