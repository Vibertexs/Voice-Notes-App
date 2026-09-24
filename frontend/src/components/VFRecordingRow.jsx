import { Icon } from './Icon';

/**
 * One recording, wherever recordings are listed.
 *
 * The play circle is a separate target from the row: tapping it starts playback
 * in place, tapping anywhere else opens the recording. That distinction is the
 * whole reason the circle is 46px rather than an icon - it has to be hittable
 * without opening the screen behind it.
 *
 * `mode="drag"` is for Organize. It swaps the menu for a grip, hands pointer
 * events to the drag layer, and drops the row to 35% while its ghost is out, so
 * the list still shows where the recording came from.
 *
 * `highlight` is the just-saved ring. It is a state of the row rather than an
 * animation, so returning to a folder can point at the new recording.
 *
 * Reference: docs/design/voiceflow/VFRecordingRow.dc.html
 */
export default function VFRecordingRow({
  title = 'Recording', date, duration, meta, snippet = '', mode = 'default',
  playing = false, progress = -1, highlight = false, dragging = false,
  onPress, onPlay, onMore, onDragStart,
}) {
  const drag = mode === 'drag';
  const line = meta ?? [date, duration].filter(Boolean).join(' · ');

  return (
    <li
      className={`vf-row${drag ? ' vf-row--drag' : ''}${highlight ? ' is-new' : ''}${dragging ? ' is-dragging' : ''}`}
      onPointerDown={drag ? (event) => onDragStart?.(event) : undefined}
    >
      <button
        type="button"
        className={`vf-row-play${playing ? ' is-playing' : ''}`}
        aria-label={playing ? `Pause ${title}` : `Play ${title}`}
        onClick={(event) => { event.stopPropagation(); if (!drag) onPlay?.(); }}
      >
        {playing ? <span className="vf-row-pause"><i /><i /></span> : <Icon name="play" />}
      </button>

      <button
        type="button"
        className="vf-row-open"
        onClick={() => { if (!drag) onPress?.(); }}
      >
        <span className="vf-row-copy">
          <strong>{title}</strong>
          <span className="vf-row-meta">{line}</span>
          {Boolean(snippet) && <span className="vf-row-snippet">{snippet}</span>}
          {playing && progress >= 0 && (
            <span className="vf-row-bar"><i style={{ width: `${Math.round(Math.max(0, progress) * 100)}%` }} /></span>
          )}
        </span>
      </button>

      {drag
        ? <span className="vf-row-grip" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</span>
        : (
          <button type="button" className="vf-row-more" aria-label={`Options for ${title}`}
            onClick={(event) => { event.stopPropagation(); onMore?.(); }}>
            <i /><i /><i />
          </button>
        )}
    </li>
  );
}
