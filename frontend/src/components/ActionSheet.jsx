import { useEffect } from 'react';
import { Icon } from './Icon';

/**
 * The one sheet in the app.
 *
 * Everything that would otherwise be a menu, a popover or a dialog comes up
 * from the bottom as this: a card naming what it is acting on, a grouped list,
 * and a way out. Destructive actions are separated into their own group and
 * coloured, which is the only place red type appears in the interface.
 *
 * The header card is the object itself - its colour, its icon, its name and
 * its metadata - so a sheet never opens without saying what it will act on.
 * It carries the close button, which is why a sheet with one needs no Cancel.
 *
 * `items` may contain `null`, so a caller can drop an entry it cannot offer
 * without assembling the array conditionally.
 */
export default function ActionSheet({
  title, subtitle, tone = 'rose', icon = 'play', items = [], onClose, children, cancelLabel = 'Cancel',
}) {
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
        {title || subtitle
          ? <div className="sheet-head" data-tone={tone}>
              <span className="sheet-thumb" aria-hidden="true"><Icon name={icon} /></span>
              <span className="sheet-copy">
                {title && <strong>{title}</strong>}
                {subtitle && <small>{subtitle}</small>}
              </span>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                <Icon name="close" />
              </button>
            </div>
          : <div className="sheet-grip" />}
        {children
          ? <div className="sheet-body">{children}</div>
          : <>
              {safe.length > 0 && <div className="sheet-group">{safe.map(render)}</div>}
              {destructive.length > 0 && <div className="sheet-group">{destructive.map(render)}</div>}
              {!title && !subtitle && (
                <button type="button" className="sheet-cancel" onClick={onClose}>{cancelLabel}</button>
              )}
            </>}
      </div>
    </div>
  );
}
