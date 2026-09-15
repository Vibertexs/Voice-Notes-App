import { useEffect, useRef, useState } from 'react';
import ClassFolderArt from './ClassFolderArt';

const COLORS = ['blue', 'violet', 'rose', 'coral', 'amber', 'lime', 'mint', 'sky', 'slate'];

/**
 * A class is represented by one responsive SVG folder, rather than assembled
 * CSS pieces. Its actions remain in the quiet corner menu.
 */
export default function ClassCard({ folder, onOpen, onArchive, onRecolor, onDelete, onDropWorkspace }) {
  const [over, setOver] = useState(false);
  const [menu, setMenu] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (event) => {
      if (!cardRef.current?.contains(event.target)) setMenu(false);
    };
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

  return <div
    className={`class-card ${folder.color} ${over ? 'drop-active' : ''} ${menu ? 'menu-open' : ''}`}
    ref={cardRef}
  >
    <button
      className="class-card-open"
      onClick={() => onOpen(folder.id)}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => { event.preventDefault(); setOver(false); onDropWorkspace(event, folder.id); }}
      aria-label={`Open ${folder.name}`}
    >
      <span className="class-folder-stage">
        <ClassFolderArt />
      </span>
      <span className="class-card-copy">
        <span className="class-name">{folder.name}</span>
        <span className="class-meta">{over ? 'Drop to file here' : summary}</span>
      </span>
    </button>

    <button
      className="class-dial"
      onClick={() => setMenu((open) => !open)}
      aria-label={`Options for ${folder.name}`}
      aria-expanded={menu}
      aria-haspopup="menu"
    ><span aria-hidden="true">⋯</span></button>

    {menu && <div className="class-menu" role="menu" aria-label={`${folder.name} options`}>
      <div className="class-menu-swatches">
        {COLORS.map((color) => <button
          key={color}
          className={`class-swatch ${color} ${color === folder.color ? 'current' : ''}`}
          role="menuitem"
          aria-label={`Colour ${color}`}
          onClick={() => { onRecolor(folder.id, color); setMenu(false); }}
        />)}
      </div>
      <button className="class-menu-item" role="menuitem" onClick={() => { onArchive(folder.id, !folder.archived); setMenu(false); }}>
        {folder.archived ? 'Restore class' : 'Archive class'}
      </button>
      <button className="class-menu-item danger" role="menuitem" onClick={() => { onDelete(folder); setMenu(false); }}>
        Delete class
      </button>
    </div>}
  </div>;
}
