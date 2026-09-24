import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/**
 * The search pill.
 *
 * Works controlled or uncontrolled, because two screens need it differently:
 * Home only wants to know it was tapped (it hands over to global search), while
 * the search screens drive the value themselves.
 *
 * The clear button returns focus to the field rather than dismissing the
 * keyboard - clearing is nearly always the start of another query, not the end
 * of searching.
 *
 * Reference: docs/design/voiceflow/VFSearchField.dc.html
 */
export default function VFSearchField({
  value, placeholder = 'Search recordings & transcripts', autoFocus = false,
  onChange, onFocus, onSubmit, readOnly = false, className = '', label,
}) {
  const [inner, setInner] = useState('');
  const [focused, setFocused] = useState(false);
  const input = useRef(null);

  const controlled = value !== undefined;
  const current = controlled ? value : inner;

  useEffect(() => {
    if (!autoFocus) return undefined;
    const timer = window.setTimeout(() => input.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(timer);
  }, [autoFocus]);

  const set = (next) => {
    if (!controlled) setInner(next);
    onChange?.(next);
  };

  return (
    <div className={`vf-search${focused ? ' is-focused' : ''} ${className}`}>
      <Icon name="search" strokeWidth={2.4} className="vf-search-glyph" />
      <input
        ref={input}
        value={current}
        readOnly={readOnly}
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        onChange={(event) => set(event.target.value)}
        onFocus={() => { setFocused(true); onFocus?.(); }}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => { if (event.key === 'Enter') onSubmit?.(current); }}
      />
      {Boolean(current) && (
        <button type="button" className="vf-search-clear" aria-label="Clear search"
          onClick={() => { set(''); input.current?.focus({ preventScroll: true }); }}>
          <Icon name="close" strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}
