import { useEffect } from 'react';
import { Icon } from './Icon';

/**
 * The one sheet in the app.
 *
 * Everything that would otherwise be a menu, a popover or a dialog comes up
 * from the bottom as this: a grip, what it is acting on, a grouped list, and a
 * cancel. Destructive actions are separated into their own group and coloured,
 * which is the only place red type appears in the interface.
 *
 * `items` may contain `null`, so a caller can drop an entry it cannot offer
 * without assembling the array conditionally.
 */
export default function ActionSheet({ title, subtitle, items = [], onClose, children, cancelLabel = 'Cancel' }) {
  useEffect(() => {
    const escape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  const entries = items.filter(Boolean);
  const safe = entries.filter((item) => !item.danger);
  const destructive = entries.filter((item) => item.danger);

  const render = (item) => (
    <button
      key={item.label}
      type="button"
      className={`sheet-item ${item.danger ? 'danger' : ''} ${item.on ? 'on' : ''}`}
      onClick={() => { item.onSelect(); if (!item.keepOpen) onClose(); }}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {item.chevron ? <span className="chev"><Icon name="chev" /></span> : <span />}
    </button>
  );

  return (
    <div className="scrim" role="presentation" onMouseDown={onClose}>
      <div
        className={`sheet ${children ? 'tall' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'Options'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sheet-grip" />
        {(title || subtitle) && (
          <div className="sheet-title">
            {title && <strong>{title}</strong>}
            {subtitle && <small>{subtitle}</small>}
          </div>
        )}
        {children
          ? <div className="sheet-body">{children}</div>
          : <>
              {safe.length > 0 && <div className="sheet-group">{safe.map(render)}</div>}
              {destructive.length > 0 && <div className="sheet-group">{destructive.map(render)}</div>}
              <button type="button" className="sheet-cancel" onClick={onClose}>{cancelLabel}</button>
            </>}
      </div>
    </div>
  );
}
