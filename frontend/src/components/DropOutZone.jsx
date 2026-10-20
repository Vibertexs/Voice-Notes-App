import { COPY } from '../lib/copy';

/**
 * The one place a recording can be dropped while a folder is open: out of it.
 *
 * It sits at the top of the screen, away from the thumb that is carrying the row, and
 * it is the only target - inside a folder the other folders are not on screen, and
 * filing a recording into one is done from Home, by dropping it on the folder card.
 * Like every drop target it marks itself with `data-drop`, and the drag layer finds it
 * by hit-testing under the finger.
 */
export default function DropOutZone({ over = false }) {
  return (
    <div className="drop-out-top" data-drop="__out" aria-hidden="true">
      <div className={`drop-out${over ? ' is-over' : ''}`}>{COPY.dropOut}</div>
    </div>
  );
}
