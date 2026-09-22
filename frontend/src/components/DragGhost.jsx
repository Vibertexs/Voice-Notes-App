import { Icon } from './Icon';

/**
 * The recording, under your finger.
 *
 * It never takes pointer events, because the drag finds its target by asking
 * what is beneath the finger - if the ghost answered that question it would
 * always be itself.
 */
export default function DragGhost({ drag }) {
  if (!drag) return null;
  return (
    <div className={`drag-ghost ${drag.over ? 'armed' : ''}`} style={{ left: drag.x, top: drag.y }} aria-hidden="true">
      <Icon name="play" />
      <span>{drag.item.title}</span>
    </div>
  );
}
