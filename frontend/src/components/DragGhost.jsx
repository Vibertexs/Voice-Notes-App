/**
 * The recording, under your finger.
 *
 * It never takes pointer events, because the drag finds its target by asking
 * what is beneath the finger - if the ghost answered that question it would
 * always be itself.
 *
 * The second line is the whole point of the ghost: it says what letting go
 * will do, and it changes as the finger passes over targets. Without it a drop
 * is a guess.
 */
export default function DragGhost({ drag, label }) {
  if (!drag) return null;
  return (
    <div
      className={`drag-ghost${drag.over ? ' is-armed' : ''}`}
      style={{ left: drag.x, top: drag.y }}
      aria-hidden="true"
    >
      <strong>{drag.item.title}</strong>
      <small>{label ?? 'Drop on a folder'}</small>
    </div>
  );
}
