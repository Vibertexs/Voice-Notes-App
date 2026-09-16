/**
 * One icon set, one stroke weight.
 *
 * Every glyph is drawn on the same 24px grid with the same 1.9 stroke and
 * round caps, so nothing in the interface looks borrowed from somewhere else.
 * Filled shapes (play, pause) are the deliberate exception: they sit inside
 * solid buttons where an outline would disappear.
 */

const PATHS = {
  library: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h3.2a2 2 0 0 1 1.6.8l.9 1.2h5.3A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m19.5 19.5-3.8-3.8" /></>,
  mic: <><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M18.5 11v.4a6.5 6.5 0 0 1-13 0V11" /><path d="M12 17.9V21" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.1 14.2a1.4 1.4 0 0 0 .3 1.5l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.4 1.4 0 0 0-1.5-.3 1.4 1.4 0 0 0-.9 1.3V20a2 2 0 1 1-4 0v-.2a1.4 1.4 0 0 0-.9-1.3 1.4 1.4 0 0 0-1.5.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.4 1.4 0 0 0 .3-1.5 1.4 1.4 0 0 0-1.3-.9H4a2 2 0 1 1 0-4h.2a1.4 1.4 0 0 0 1.3-.9 1.4 1.4 0 0 0-.3-1.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.4 1.4 0 0 0 1.5.3h.1a1.4 1.4 0 0 0 .8-1.3V4a2 2 0 1 1 4 0v.2a1.4 1.4 0 0 0 .9 1.3 1.4 1.4 0 0 0 1.5-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.4 1.4 0 0 0-.3 1.5v.1a1.4 1.4 0 0 0 1.3.8H20a2 2 0 1 1 0 4h-.2a1.4 1.4 0 0 0-1.3.9Z" /></>,
  back: <><path d="M14.5 5 8 12l6.5 7" /></>,
  arrow: <><path d="M5 12h13M12.5 6l6 6-6 6" /></>,
  more: <><circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  plus: <><path d="M12 5.5v13M5.5 12h13" /></>,
  close: <><path d="m6.5 6.5 11 11M17.5 6.5l-11 11" /></>,
  trash: <><path d="M4.5 7h15M10 7V5.2A1.2 1.2 0 0 1 11.2 4h1.6A1.2 1.2 0 0 1 14 5.2V7" /><path d="M6.5 7 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2A1.5 1.5 0 0 0 16.6 19L17.5 7" /><path d="M10.5 10.5v6M13.5 10.5v6" /></>,
  file: <><path d="M13.5 3.5H7.8A1.8 1.8 0 0 0 6 5.3v13.4a1.8 1.8 0 0 0 1.8 1.8h8.4a1.8 1.8 0 0 0 1.8-1.8V8Z" /><path d="M13.5 3.5V8H18" /></>,
  upload: <><path d="M12 15.5V4m0 0L8 8m4-4 4 4" /><path d="M4.5 15.5v3A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-3" /></>,
  wave: <><path d="M4 11v2M8 8v8M12 5.5v13M16 9v6M20 11v2" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  play: <><path d="M8 5.2v13.6L19 12Z" fill="currentColor" stroke="none" /></>,
  pause: <><rect x="7" y="5" width="3.5" height="14" rx="1.2" fill="currentColor" stroke="none" /><rect x="13.5" y="5" width="3.5" height="14" rx="1.2" fill="currentColor" stroke="none" /></>,
  /* Skip glyphs carry their own number: the arc says which way, the
     numeral says how far. Drawn large in the transport so it stays legible. */
  back15: <><path d="M9.4 5A7.5 7.5 0 1 0 14.6 5" /><path d="M12.2 2.4 9.2 5l3 2.6" /><text x="12" y="15.6" textAnchor="middle" fontSize="8.4" fontWeight="700" letterSpacing="-.4" fill="currentColor" stroke="none">15</text></>,
  fwd15: <><path d="M14.6 5A7.5 7.5 0 1 1 9.4 5" /><path d="M11.8 2.4 14.8 5l-3 2.6" /><text x="12" y="15.6" textAnchor="middle" fontSize="8.4" fontWeight="700" letterSpacing="-.4" fill="currentColor" stroke="none">15</text></>,
  headphones: <><path d="M4.5 14v-2a7.5 7.5 0 0 1 15 0v2" /><path d="M4.5 14.5A1.5 1.5 0 0 1 6 13h.5A1.5 1.5 0 0 1 8 14.5v3A1.5 1.5 0 0 1 6.5 19H6a1.5 1.5 0 0 1-1.5-1.5ZM16 14.5A1.5 1.5 0 0 1 17.5 13h.5a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 18 19h-.5a1.5 1.5 0 0 1-1.5-1.5Z" /></>,
  bookmark: <><path d="M6.5 4.5h11v15l-5.5-3.8L6.5 19.5Z" /></>,
};

export function Icon({ name, size, className = '' }) {
  const glyph = PATHS[name];
  if (!glyph) return null;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size} height={size}
      fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >{glyph}</svg>
  );
}

export default Icon;
