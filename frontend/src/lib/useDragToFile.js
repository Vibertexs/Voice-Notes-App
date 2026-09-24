import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Picking a recording up and dropping it somewhere else.
 *
 * The HTML drag-and-drop API does not exist on touch, so this is built from
 * pointer events. A press that stays still for a moment becomes a drag; a
 * press that moves first is a scroll and is left alone. That distinction is
 * the whole trick - get it wrong and the list stops scrolling.
 *
 * The part that is easy to get wrong: a browser decides whether a touch is a
 * scroll before it tells you anything, and once it has decided it sends
 * `pointercancel` and stops reporting the finger. Setting `touch-action` when
 * the drag begins is already too late. So once a drag is live this listens to
 * `touchmove` non-passively and calls preventDefault on every one, which is
 * the only thing that reliably stops the page moving underneath. Touch then
 * drives the drag, and `pointercancel` is ignored rather than obeyed.
 *
 * Drop targets mark themselves with `data-drop="<id>"` and are found by
 * hit-testing under the finger rather than by registering anything, so a
 * target can appear mid-drag (the folder screen's "out" bar does exactly that).
 */

/** How long a finger must stay put before it is carrying something. */
const HOLD_MS = 280;
/** How far it may wander in that time before we call it a scroll. */
const SLOP = 12;
/** How close to an edge starts the list moving under the drag. */
const EDGE = 96;
const EDGE_SPEED = 14;

export default function useDragToFile(onDrop) {
  const [drag, setDrag] = useState(null);
  const ref = useRef({ item: null, timer: 0, from: null, active: false, over: null, frame: 0, blockUntil: 0 });

  const clearTargets = () => {
    document.querySelectorAll('.drop-over').forEach((node) => node.classList.remove('drop-over'));
  };

  const stop = useCallback((dropped) => {
    const state = ref.current;
    window.clearTimeout(state.timer);
    cancelAnimationFrame(state.frame);
    clearTargets();
    document.body.classList.remove('is-dragging');
    const { item, over, active } = state;
    ref.current = { ...ref.current, item: null, timer: 0, from: null, active: false, over: null, frame: 0 };
    setDrag(null);
    // A drag must not also read as a tap on the row it started from.
    if (active) ref.current.blockUntil = Date.now() + 400;
    if (dropped && active && item && over) onDrop(item, over);
  }, [onDrop]);

  // Nudge the page when the finger nears an edge, so a target that is off
  // screen is still reachable without letting go.
  const edgeScroll = useCallback((y) => {
    const state = ref.current;
    cancelAnimationFrame(state.frame);
    const height = window.innerHeight;
    const delta = y < EDGE ? -EDGE_SPEED : y > height - EDGE ? EDGE_SPEED : 0;
    if (!delta) return;
    const step = () => {
      const before = window.scrollY;
      window.scrollBy(0, delta);
      // Nothing moved: the list has hit its end, so stop asking for frames.
      if (window.scrollY === before) { state.frame = 0; return; }
      state.frame = requestAnimationFrame(step);
    };
    state.frame = requestAnimationFrame(step);
  }, []);

  /** Where the finger is now, whatever kind of pointer it is. */
  const track = useCallback((x, y) => {
    const state = ref.current;
    clearTargets();
    const target = document.elementFromPoint(x, y)?.closest('[data-drop]');
    if (target) target.classList.add('drop-over');
    const over = target?.dataset.drop ?? null;
    // A tick on arrival, not on every move: crossing into a target is the
    // moment the drop changes meaning, and it is the one worth feeling.
    if (over !== state.over && over) navigator.vibrate?.(6);
    state.over = over;
    setDrag((current) => (current ? { ...current, x, y, over } : current));
    edgeScroll(y);
  }, [edgeScroll]);

  /** Before the hold elapses, real movement means the user wanted to scroll. */
  const giveUpIfMoved = useCallback((x, y) => {
    const state = ref.current;
    if (Math.hypot(x - state.from.x, y - state.from.y) <= SLOP) return;
    window.clearTimeout(state.timer);
    ref.current = { ...state, item: null, timer: 0, from: null };
  }, []);

  useEffect(() => {
    const onPointerMove = (event) => {
      const state = ref.current;
      if (!state.item) return;
      if (!state.active) { giveUpIfMoved(event.clientX, event.clientY); return; }
      // Touch is handled by onTouchMove, which can also stop the scroll.
      if (event.pointerType !== 'touch') track(event.clientX, event.clientY);
    };

    const onTouchMove = (event) => {
      const state = ref.current;
      if (!state.item) return;
      const touch = event.touches[0];
      if (!touch) return;
      if (!state.active) { giveUpIfMoved(touch.clientX, touch.clientY); return; }
      // The one call that keeps the page still while a row is being carried.
      if (event.cancelable) event.preventDefault();
      track(touch.clientX, touch.clientY);
    };

    const onUp = () => { if (ref.current.item) stop(true); };
    // A browser that has decided this touch is a scroll sends pointercancel.
    // While a drag is live we have already stopped the scroll, so ignore it -
    // obeying it is what made drags die the moment they started.
    const onPointerCancel = () => {
      const state = ref.current;
      if (state.item && !state.active) stop(false);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onUp);
    window.addEventListener('touchcancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
    };
  }, [giveUpIfMoved, stop, track]);

  /** Attach to a row's onPointerDown. `item` is whatever onDrop will receive. */
  const beginDrag = useCallback((event, item) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const from = { x: event.clientX, y: event.clientY };
    ref.current = { ...ref.current, item, from, active: false, over: null };
    ref.current.timer = window.setTimeout(() => {
      ref.current.active = true;
      document.body.classList.add('is-dragging');
      navigator.vibrate?.(8);
      setDrag({ item, x: from.x, y: from.y, over: null });
    }, HOLD_MS);
  }, []);

  /** True while a just-finished drag should stop the row opening. */
  const blockClick = useCallback(() => Date.now() < ref.current.blockUntil, []);

  return { drag, beginDrag, blockClick };
}
