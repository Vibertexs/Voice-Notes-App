import { useEffect } from 'react';
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
 * Reference: docs/design/voiceflow/VFBottomSheet.dc.html
 */
export default function VFBottomSheet({
  open = true, title = '', subtitle = '', icon = 'none', children, onClose, labelledBy,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className={`vf-sheet-layer${open ? ' is-open' : ''}`} aria-hidden={!open}>
      <div className="vf-scrim" onClick={() => onClose?.()} />
      <div
        className={`vf-sheet${icon === 'none' ? '' : ' vf-sheet--centred'}`}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title || 'Sheet'}
      >
        <button type="button" className="vf-grab" aria-label="Close" onClick={() => onClose?.()} />
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
  );
}
