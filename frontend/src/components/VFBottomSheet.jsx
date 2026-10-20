import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/**
 * Every decision the app asks for arrives here.
 *
 * The status icon sets the alignment: with one, the sheet is an announcement
 * and centres; without one, it is a list of choices and stays left. That is why
 * `align` is not a prop - it follows from what the sheet is doing.
 *
 * It stays mounted while closed so the slide out is visible; `open` drives the
 * transform, and pointer events are dropped so a closed sheet cannot swallow a
 * tap meant for the screen behind it.
 *
 * Three ways to close it, because a tall sheet (the assistants guide, the account) leaves little
 * scrim to tap: the X in the header, a tap on the scrim, and dragging the sheet down. The header
 * stays put while the content under it scrolls; the content's height is limited from the
 * measured window height (a share of it), not a CSS unit, so it scrolls on every WebView.
 *
 * Dragging down takes over only when it could not mean anything else: from the header, or from
 * the content when it is already scrolled to the top. Past a distance or a flick it closes;
 * otherwise it springs back.
 *
 * Reference: docs/design/voiceflow/VFBottomSheet.dc.html
 */
const MAX_SHARE = 0.88;          // of the window's height, leaving a strip of scrim above
const CLOSE_DISTANCE = 110;      // px dragged down that closes it
const FLICK_SPEED = 0.6;         // px per ms that closes it from a shorter drag

export default function VFBottomSheet({
  open = true, title = '', subtitle = '', icon = 'none', children, onClose, labelledBy,
}) {
  const sheet = useRef(null);
  const scroller = useRef(null);
  const [maxHeight, setMaxHeight] = useState(() => Math.floor((typeof window === 'undefined' ? 800 : window.innerHeight) * MAX_SHARE));

  useEffect(() => {
    const measure = () => setMaxHeight(Math.floor(window.innerHeight * MAX_SHARE));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Drag down to dismiss. Native listeners, because a touchmove has to be cancellable to stop the
  // page scrolling underneath, and React attaches its touch handlers as passive.
  useEffect(() => {
    const node = sheet.current;
    if (!open || !node) return undefined;
    node.style.transform = '';
    node.style.transition = '';
    let startY = 0;
    let startAt = 0;
    let offset = 0;
    let armed = false;      // this touch could become a dismiss drag
    let dragging = false;

    const onStart = (event) => {
      const touch = event.touches[0];
      startY = touch.clientY; startAt = Date.now(); offset = 0; dragging = false;
      const inHeader = Boolean(event.target.closest?.('.vf-sheet-head'));
      armed = inHeader || (scroller.current?.scrollTop ?? 0) <= 0;
    };
    const onMove = (event) => {
      if (!armed) return;
      const delta = event.touches[0].clientY - startY;
      if (!dragging) {
        if (delta <= 8) return;       // up, or not yet far enough to be a drag: let it scroll
        dragging = true;
        node.style.transition = 'none';
      }
      offset = Math.max(0, delta);
      if (event.cancelable) event.preventDefault();
      node.style.transform = `translateY(${offset}px)`;
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      const speed = offset / Math.max(1, Date.now() - startAt);
      node.style.transition = '';
      if (offset > CLOSE_DISTANCE || (speed > FLICK_SPEED && offset > 40)) {
        // Carry on down to where a closed sheet rests, then hand back to the stylesheet.
        node.style.transform = 'translateY(calc(100% + 24px))';
        onClose?.();
        window.setTimeout(() => { node.style.transform = ''; }, 450);
      } else {
        node.style.transform = '';
      }
    };

    node.addEventListener('touchstart', onStart, { passive: true });
    node.addEventListener('touchmove', onMove, { passive: false });
    node.addEventListener('touchend', onEnd);
    node.addEventListener('touchcancel', onEnd);
    return () => {
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
      node.removeEventListener('touchend', onEnd);
      node.removeEventListener('touchcancel', onEnd);
    };
  }, [open, onClose]);

  return (
    <div className={`vf-sheet-layer${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <div className="vf-scrim" onClick={() => onClose?.()} />
      <div
        ref={sheet}
        className={`vf-sheet${icon === 'none' ? '' : ' vf-sheet--centred'}`}
        style={{ maxHeight }}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title || 'Sheet'}
      >
        <div className="vf-sheet-head">
          <span className="vf-grab" aria-hidden="true" />
          <button type="button" className="vf-sheet-close" aria-label="Close" onClick={() => onClose?.()}>
            <Icon name="close" strokeWidth={2.4} />
          </button>
        </div>
        <div ref={scroller} className="vf-sheet-scroll">
          {icon !== 'none' && (
            <span className={`vf-sheet-icon vf-sheet-icon--${icon}`}>
              {icon === 'check' && <Icon name="check" strokeWidth={2.6} />}
              {icon === 'warn' && <Icon name="warn" strokeWidth={2.4} />}
              {icon === 'x' && <Icon name="close" strokeWidth={2.4} />}
            </span>
          )}
          {Boolean(title) && <h2 className="vf-sheet-title">{title}</h2>}
          {Boolean(subtitle) && <p className="vf-sheet-sub">{subtitle}</p>}
          <div className="vf-sheet-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
