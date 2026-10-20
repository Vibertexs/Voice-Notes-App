/**
 * The record button, in the three states the app ever has.
 *
 * It grows from 72 to 80 the moment recording starts, and the mark inside it
 * carries the state rather than a label: a dot to begin, two bars while
 * running, a dot again when paused. The ring is what changes colour, so the
 * button never moves once it is up.
 *
 * Nothing here knows about folders or sessions. Where a press records is the
 * screen's business - see the persistent record button rule in the handoff.
 *
 * `level` (0..1, the live microphone level) only matters while recording: it drives the halo
 * behind the button, which swells with the voice. See the CSS beside .vf-rec--recording.
 *
 * Reference: docs/design/voiceflow/VFRecordButton.dc.html
 */
export default function VFRecordButton({ state = 'idle', onPress, className = '', level = 0 }) {
  const label = state === 'idle' ? 'Record' : state === 'recording' ? 'Pause' : 'Resume';
  return (
    <button
      type="button"
      className={`vf-rec vf-rec--${state} ${className}`}
      aria-label={label}
      style={state === 'recording' ? { '--level': level.toFixed(2) } : undefined}
      onClick={(event) => { event.stopPropagation(); onPress?.(); }}
    >
      {state === 'recording' && (
        <>
          <span className="vf-rec-ring" aria-hidden="true" />
          <span className="vf-rec-ring vf-rec-ring--late" aria-hidden="true" />
        </>
      )}
      {state === 'recording'
        ? <span className="vf-rec-bars"><i /><i /></span>
        : <span className="vf-rec-dot" />}
    </button>
  );
}
