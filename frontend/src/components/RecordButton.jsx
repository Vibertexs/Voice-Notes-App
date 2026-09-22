import { Icon } from './Icon';

/**
 * The one thing the app is for.
 *
 * There is no tab bar, because there was only ever one tab worth having: you
 * open the app to record, and everything else is reached by going into a
 * folder and coming back out of it. So this is a single floating action rather
 * than a bar with one button in it.
 *
 * It sits over a short fade, so rows scrolling underneath dissolve into the
 * background instead of colliding with it, and it is deliberately absent from
 * playback - that screen's own play button owns the bottom centre.
 */
export default function RecordButton({ onClick }) {
  return (
    <div className="record-dock">
      <button type="button" className="record-fab" onClick={onClick} aria-label="Record">
        <Icon name="mic" />
      </button>
    </div>
  );
}
