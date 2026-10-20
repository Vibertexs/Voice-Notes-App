import { Icon } from './Icon';
import FavoriteMark from './FavoriteMark';

/**
 * One recording, wherever recordings are listed.
 *
 * The play circle is a separate target from the row: tapping it starts playback
 * in place, tapping anywhere else opens the recording. That distinction is the
 * whole reason the circle is 46px rather than an icon - it has to be hittable
 * without opening the screen behind it.
 *
 * Holding a row picks it up (`onHold` hands the press to the drag layer); a
 * press that moves first is a scroll. The row drops to 35% while its ghost is
 * out, so the list still shows where the recording came from, and `guard`
 * lets the owner swallow the tap that would otherwise follow a drop.
 *
 * `cloudOnly` is a recording whose audio is not on this phone - it came from another
 * one. Its words are here, so it opens; but there is nothing to play, so the play
 * circle shows a cloud instead, and the line under the title says so.
 *
 * `favorite` puts a small heart after the title.
 *
 * `highlight` is the just-saved ring. It is a state of the row rather than an
 * animation, so returning to a folder can point at the new recording.
 *
 * Reference: docs/design/voiceflow/VFRecordingRow.dc.html
 */
export default function VFRecordingRow({
  title = 'Recording', date, duration, meta, snippet = '',
  playing = false, progress = -1, highlight = false, dragging = false, cloudOnly = false, favorite = false,
  onPress, onPlay, onMore, onHold, guard,
}) {
  const base = meta ?? [date, duration].filter(Boolean).join(' · ');
  const line = cloudOnly ? [base, 'Cloud only'].filter(Boolean).join(' · ') : base;

  return (
    <li
      className={`vf-row${onHold ? ' is-holdable' : ''}${highlight ? ' is-new' : ''}${dragging ? ' is-dragging' : ''}`}
      onPointerDown={onHold ? (event) => onHold(event) : undefined}
      // A long press is a drag here, not the browser's own menu or text selection.
      onContextMenu={onHold ? (event) => event.preventDefault() : undefined}
    >
      <button
        type="button"
        className={`vf-row-play${playing ? ' is-playing' : ''}${cloudOnly ? ' is-cloud' : ''}`}
        aria-label={cloudOnly ? `${title}: only in the cloud, the audio is not on this phone` : playing ? `Pause ${title}` : `Play ${title}`}
        onClick={(event) => {
          event.stopPropagation();
          if (guard?.()) return;
          // Nothing to play, so the circle opens the recording like the rest of the row.
          if (cloudOnly) onPress?.(); else onPlay?.();
        }}
      >
        {cloudOnly
          ? <Icon name="cloud" strokeWidth={2} />
          : playing ? <span className="vf-row-pause"><i /><i /></span> : <Icon name="play" />}
      </button>

      <button
        type="button"
        className="vf-row-open"
        onClick={() => { if (!guard?.()) onPress?.(); }}
      >
        <span className="vf-row-copy">
          <strong className="title-line"><span className="title-text">{title}</span>{favorite && <FavoriteMark />}</strong>
          <span className="vf-row-meta">{line}</span>
          {Boolean(snippet) && <span className="vf-row-snippet">{snippet}</span>}
          {playing && progress >= 0 && (
            <span className="vf-row-bar"><i style={{ width: `${Math.round(Math.max(0, progress) * 100)}%` }} /></span>
          )}
        </span>
      </button>

      <button type="button" className="vf-row-more" aria-label={`Options for ${title}`}
        onClick={(event) => { event.stopPropagation(); if (!guard?.()) onMore?.(); }}>
        <i /><i /><i />
      </button>
    </li>
  );
}
