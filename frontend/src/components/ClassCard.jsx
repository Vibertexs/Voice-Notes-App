import { useEffect, useRef, useState } from 'react';

const COLORS = ['blue', 'violet', 'rose', 'coral', 'amber', 'lime', 'mint', 'sky', 'slate'];

const relativeDate = (value) => {
  if (!value) return 'No lectures yet';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
};

/**
 * A class drawn as a folder: a tab, sheets peeking over the top, and the
 * details a student actually wants at a glance. The corner button sets colour.
 */
export default function ClassCard({ folder, onOpen, onArchive, onRecolor, onDelete, onDropWorkspace }) {
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    if (!picking) return undefined;
    const close = (event) => {
      if (!cardRef.current?.contains(event.target)) setPicking(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [picking]);

  const lectures = folder.lecture_count ?? 0;
  const recordings = folder.recording_count ?? 0;
  const files = folder.file_count ?? 0;

  return <div className={`class-card ${folder.color} ${over ? 'drop-active' : ''}`} ref={cardRef}>
    <span className="class-sheets" aria-hidden="true"><i /><i /><i /></span>

    <button
      className="class-card-open"
      onClick={() => onOpen(folder.id)}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => { event.preventDefault(); setOver(false); onDropWorkspace(event, folder.id); }}
      aria-label={`Open ${folder.name}`}
    >
      <span className="class-tab" aria-hidden="true" />
      <span className="class-face">
        <span className="class-title">
          <span className="class-glyph" aria-hidden="true">🗀</span>
          <span className="class-name">{folder.name}</span>
        </span>

        <span className="class-rows">
          <span className="class-row"><span>Lectures</span><b>{lectures}</b></span>
          <span className="class-row"><span>Recordings</span><b>{recordings}</b></span>
          <span className="class-row"><span>Files</span><b>{files}</b></span>
          <span className="class-row"><span>Last updated</span><b>{relativeDate(folder.updated_at)}</b></span>
        </span>

        {over && <span className="class-drop-hint">Drop to file here</span>}
      </span>
    </button>

    <button
      className="class-archive"
      onClick={() => onArchive(folder.id, !folder.archived)}
      aria-label={folder.archived ? `Restore ${folder.name}` : `Archive ${folder.name}`}
      title={folder.archived ? 'Restore this class' : 'Archive this class'}
    >{folder.archived ? '↩' : '⤓'}</button>

    <button
      className="class-delete"
      onClick={() => onDelete(folder)}
      aria-label={`Delete ${folder.name}`}
      title="Delete this class"
    >×</button>

    <button
      className="class-color"
      onClick={() => setPicking((open) => !open)}
      aria-label={`Change the colour of ${folder.name}`}
      aria-expanded={picking}
      title="Class colour"
    ><span aria-hidden="true" /></button>

    {picking && <div className="class-swatches" role="menu" aria-label={`Colour for ${folder.name}`}>
      {COLORS.map((color) => <button
        key={color}
        className={`class-swatch ${color} ${color === folder.color ? 'current' : ''}`}
        role="menuitem"
        aria-label={color}
        onClick={() => { onRecolor(folder.id, color); setPicking(false); }}
      />)}
    </div>}
  </div>;
}
