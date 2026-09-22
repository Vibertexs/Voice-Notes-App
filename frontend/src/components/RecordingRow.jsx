import { Icon } from './Icon';
import { dateLabel, mmss } from '../lib/format';

/**
 * One recording in a list.
 *
 * Play circle, name, when it was recorded and how long it runs, and the menu
 * that opens its options. Every list of recordings in the app uses this - a
 * folder's contents, a search result, the takes inside a lecture - so they all
 * have the same height, the same metadata and the same place to tap.
 */
export default function RecordingRow({ title, meta, lecture, onOpen, onMenu, onPickUp, blockClick, dragging = false }) {
  const line = meta ?? [
    lecture ? dateLabel(lecture.created_at) : null,
    lecture?.duration_seconds ? mmss(lecture.duration_seconds) : null,
  ].filter(Boolean).join(' · ');

  return (
    <li className={`recording-row ${dragging ? 'lifted' : ''}`}>
      <button
        className="row-open"
        onPointerDown={onPickUp}
        onClick={() => { if (!blockClick?.()) onOpen(); }}
        aria-label={`Open ${title}`}
      >
        <span className="row-play"><Icon name="play" /></span>
        <span className="row-copy">
          <strong>{title}</strong>
          <small>{line}</small>
        </span>
      </button>
      {onMenu && (
        <button className="row-menu" onClick={onMenu} aria-label={`Options for ${title}`}>
          <Icon name="more" />
        </button>
      )}
    </li>
  );
}
