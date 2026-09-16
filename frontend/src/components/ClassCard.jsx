import { useEffect, useRef, useState } from 'react';
import { TONES } from './CoverArt';
import { Icon } from './Icon';

const COLORS = ['blue', 'violet', 'rose', 'coral', 'amber', 'lime', 'mint', 'sky', 'slate'];

/**
 * A class, as one sleeve of the library carousel: a portrait card with its
 * artwork filling it, its name at the foot, and its actions behind the
 * corner button.
 * Dragging a lecture onto it files the lecture into the class.
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
  const summary = lectures === 0 ? 'Nothing recorded yet' : `${lectures} lecture${lectures === 1 ? '' : 's'}`;

  return (
    <div
      ref={rootRef}
      className={`slide ${over ? 'drop-active' : ''} ${menu ? 'menu-open' : ''}`}
      style={{ '--class-tone': TONES[folder.color] ?? TONES.blue }}
    >
      <span className="slide-colour" aria-hidden="true" />
      <button
        className="slide-open"
        onClick={() => onOpen(folder.id)}
        onDragOver={(event) => { event.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => { event.preventDefault(); setOver(false); onDropWorkspace(event, folder.id); }}
        aria-label={`Open ${folder.name}`}
      >
        <span className="slide-foot">
          <span className="slide-copy">
            <span className="slide-title">{folder.name}</span>
            <span className="slide-sub">{over ? 'Drop to file here' : summary}</span>
          </span>
          <span className="slide-go"><Icon name="arrow" /></span>
        </span>
      </button>

      <button
        className="slide-menu"
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
