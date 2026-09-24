import { useEffect, useRef } from 'react';

/**
 * One line of confirmation, with a way to undo it.
 *
 * It auto-hides after 3s, but the timer restarts whenever the message changes,
 * so two actions in quick succession each get their full read rather than the
 * second inheriting what was left of the first.
 *
 * Where it sits is the screen's business: it has to clear the persistent record
 * button on Home, Folder and Organize, and the player on playback. The `lift`
 * prop takes one of the tokens for that.
 *
 * Reference: docs/design/voiceflow/VFToast.dc.html
 */
export default function VFToast({
  message, kind = 'success', action = '', visible = true,
  onAction, onHide, lift = 'record', duration = 3000,
}) {
  const hide = useRef(onHide);
  hide.current = onHide;

  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setTimeout(() => hide.current?.(), duration);
    return () => window.clearTimeout(timer);
  }, [visible, message, duration]);

  return (
    <div className={`vf-toast vf-toast--${lift}${visible ? ' is-open' : ''}`} role="status" aria-live="polite">
      <span className={`vf-toast-dot vf-toast-dot--${kind}`}><i /></span>
      <span className="vf-toast-msg">{message}</span>
      {Boolean(action) && (
        <button type="button" className="vf-toast-action" onClick={() => onAction?.()}>{action}</button>
      )}
    </div>
  );
}
