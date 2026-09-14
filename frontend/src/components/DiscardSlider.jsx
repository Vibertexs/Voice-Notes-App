import { useCallback, useEffect, useRef, useState } from 'react';

const ARMED_AT = 0.9;

/**
 * Slide to discard. Deleting a lecture you just recorded should take a
 * deliberate gesture, not a tap you can fumble — so the track fills red as
 * you go and only fires once you have carried it almost the whole way.
 */
export default function DiscardSlider({ open, onDiscard }) {
  const trackRef = useRef(null);
  const [offset, setOffset] = useState(0);
  const [sliding, setSliding] = useState(false);
  const progressRef = useRef(0);

  const travel = useCallback(() => {
    const track = trackRef.current;
    if (!track) return 1;
    // thumb is 3rem inside a .25rem inset
    return Math.max(1, track.clientWidth - (3 * 16) - (0.5 * 16));
  }, []);

  useEffect(() => { if (!open) { setOffset(0); progressRef.current = 0; } }, [open]);

  const end = useCallback(() => {
    setSliding(false);
    if (progressRef.current >= ARMED_AT) {
      progressRef.current = 0;
      setOffset(0);
      onDiscard();
    } else {
      progressRef.current = 0;
      setOffset(0);
    }
  }, [onDiscard]);

  useEffect(() => {
    if (!sliding) return undefined;
    const move = (event) => {
      const track = trackRef.current;
      if (!track) return;
      const point = event.touches?.[0]?.clientX ?? event.clientX;
      const left = track.getBoundingClientRect().left + 4;
      const next = Math.max(0, Math.min(travel(), point - left - 24));
      setOffset(next);
      progressRef.current = next / travel();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [sliding, end, travel]);

  const progress = offset / travel();
  const armed = progress >= ARMED_AT;

  // Keyboards cannot slide, so End (or ArrowRight held to the end) arms it.
  const onKeyDown = (event) => {
    if (event.key === 'End' || (event.key === 'Enter' && armed)) {
      event.preventDefault();
      onDiscard();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      const next = Math.min(travel(), offset + travel() / 6);
      setOffset(next);
      progressRef.current = next / travel();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = Math.max(0, offset - travel() / 6);
      setOffset(next);
      progressRef.current = next / travel();
    }
  };

  return <div className={`discard-reveal ${open ? 'shown' : ''}`} inert={!open}>
    <div className="discard-inner">
      <div
        ref={trackRef}
        className={`discard-slider ${sliding ? 'is-sliding' : ''} ${armed ? 'armed' : ''}`}
        style={{ '--x': `${offset}px`, '--p': progress }}
      >
        <span className="discard-fill" />
        <span className="discard-label" aria-hidden="true">slide to discard</span>
        <span
          className="discard-thumb"
          role="slider"
          tabIndex={open ? 0 : -1}
          aria-label="Slide to discard recording"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          onPointerDown={(event) => { event.preventDefault(); setSliding(true); }}
          onKeyDown={onKeyDown}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
          </svg>
        </span>
      </div>
    </div>
  </div>;
}
