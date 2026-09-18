import { Icon } from './Icon';

/**
 * The small shared parts.
 *
 * Every circular control in the app is an IconButton, every search field is a
 * SearchBar, and every "there is nothing here yet" is an EmptyState. Screens
 * compose these rather than restating the same markup, which is what keeps one
 * screen from quietly drifting away from the others.
 */

export function IconButton({ name, label, onClick, variant = '', size = '', disabled = false, pressed }) {
  return (
    <button
      type="button"
      className={`icon-btn ${variant} ${size}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
    ><Icon name={name} /></button>
  );
}

export function SearchBar({ value, onChange, placeholder = 'Search…', label = 'Search' }) {
  return (
    <label className="search-bar">
      <Icon name="search" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search"><Icon name="close" /></button>
      )}
    </label>
  );
}

/**
 * The folder artwork — the app's one illustration.
 *
 * Two sheets of paper behind a folder, with the folder's chosen icon on its
 * face. It is drawn once here and reused at every size: large and translucent
 * on a card, small and nearly invisible in an empty state. A folder always
 * looks like the same object.
 */
export function FolderArt({ icon = null, className = '' }) {
  return (
    <svg className={`folder-art ${className}`} viewBox="0 0 190 108" aria-hidden="true">
      <rect className="sheet-l" x="20" y="24" width="104" height="60" rx="11" transform="rotate(-8 72 54)" />
      <rect className="sheet-r" x="66" y="24" width="104" height="60" rx="11" transform="rotate(8 118 54)" />
      <path className="tab" d="M37 44V31a8 8 0 0 1 8-8h21a8 8 0 0 1 5.7 2.4L81 34v10Z" />
      <rect className="body" x="37" y="34" width="116" height="62" rx="12" />
      {icon && <g className="badge" transform="translate(83 53)"><Icon name={icon} size={24} /></g>}
    </svg>
  );
}

export function EmptyState({ title, body, icon = null }) {
  return (
    <div className="empty">
      <FolderArt icon={icon} />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}
