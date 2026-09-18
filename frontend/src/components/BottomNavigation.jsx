import { Icon } from './Icon';

/**
 * Two destinations: your folders, and recording.
 *
 * Everything else in the app is reached from inside one of those, which is
 * why there is no third tab. Record is not a destination so much as the
 * button the whole app exists for, so it breaks the plane of the bar and is
 * the only glowing thing on screen.
 *
 * The bar hides itself on the immersive screens - a take in progress, or a
 * recording being played - because those own the whole display.
 */
export default function BottomNavigation({ active, onFolders, onRecord }) {
  return (
    <nav className="nav" aria-label="Main">
      <button
        type="button"
        className={`nav-btn ${active === 'folders' ? 'active' : ''}`}
        onClick={onFolders}
        aria-current={active === 'folders' ? 'page' : undefined}
      >
        <Icon name="folder" />
        <span>Folders</span>
      </button>

      <button type="button" className="nav-btn nav-record" onClick={onRecord} aria-label="Record">
        <span className="dot"><Icon name="mic" /></span>
        <span>Record</span>
      </button>
    </nav>
  );
}
