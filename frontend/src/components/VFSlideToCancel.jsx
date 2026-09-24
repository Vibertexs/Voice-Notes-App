import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/**
 * Cancelling a take is destructive and unrecoverable, so it is deliberately not
 * a button: it takes a sustained gesture across the whole width.
 *
 * Two thresholds, and they are different on purpose. At 60% the label turns red
 * and says what releasing will do - that is the warning. At 85% releasing
 * actually cancels, so there is a band where you can still see the warning and
 * let go safely. Anything short of that springs back.
 *
 * Reference: docs/design/voiceflow/VFSlideToCancel.dc.html
 */
export default function VFSlideToCancel({
  label = 'Slide to cancel', releaseLabel = 'Release to cancel', onCancel,
}) {
  const track = useRef(null);
  const origin = useRef(0);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const travel = useCallback(
    () => (track.current ? track.current.offsetWidth - 56 : 220),
    [],
  );

  useEffect(() => {
    if (!dragging) return undefined;
    const move = (event) => setX(Math.max(0, Math.min(travel(), event.clientX - origin.current)));
    const release = () => {
      const max = travel();
      setDragging(false);
      setX((current) => {
        if (current < max * 0.85) return 0;
        // Ride to the end first, so the gesture visibly completes before the
        // screen changes under it.
        window.setTimeout(() => { onCancel?.(); window.setTimeout(() => setX(0), 400); }, 200);
        return max;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [dragging, travel, onCancel]);

  const past = x > travel() * 0.6;

  return (
    <div
      ref={track}
      className={`vf-slide${dragging ? ' is-dragging' : ''}${past ? ' is-past' : ''}`}
      style={{ '--x': `${x}px` }}
    >
      <span className="vf-slide-fill" />
      <span className="vf-slide-label">{past ? releaseLabel : label}</span>
      <span
        className="vf-slide-knob"
        role="button"
        tabIndex={0}
        aria-label={label}
        onPointerDown={(event) => { origin.current = event.clientX - x; setDragging(true); event.preventDefault(); }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onCancel?.(); } }}
      >
        <Icon name="chev" strokeWidth={2.8} />
      </span>
    </div>
  );
}
