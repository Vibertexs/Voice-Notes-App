/**
 * One icon set, one stroke weight.
 *
 * Every glyph is drawn on the same 24px grid with the same 1.8 stroke and
 * round caps, so nothing in the interface looks borrowed from somewhere else.
 * Filled shapes (play, pause, stop) are the deliberate exception:
 * they sit inside solid buttons where an outline would disappear.
 */

const PATHS = {
  /* ---- navigation and chrome ---- */
  folder: <><path d="M3.8 7.6A2.2 2.2 0 0 1 6 5.4h3.4a2 2 0 0 1 1.5.7l1.6 1.9h6.3a2.1 2.1 0 0 1 2.1 2.1v7.8a2.2 2.2 0 0 1-2.2 2.2H5.9a2.1 2.1 0 0 1-2.1-2.1Z" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m19.5 19.5-3.8-3.8" /></>,
  back: <><path d="M14.5 5 8 12l6.5 7" /></>,
  chev: <><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></>,
  down: <><path d="m5.5 9.5 6.5 6.5 6.5-6.5" /></>,
  close: <><path d="m6.5 6.5 11 11M17.5 6.5l-11 11" /></>,
  plus: <><path d="M12 5.5v13M5.5 12h13" /></>,
  more: <><circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" /></>,
  /* A folder with no gap in it: the only filled glyph outside transport,
     because it sits on a saturated tile where an outline disappears. */
  folderSolid: <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6c.6 0 1.2.3 1.6.7L12 7h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z" fill="currentColor" stroke="none" /></>,
  lock: <><rect x="4.8" y="10.2" width="14.4" height="9.6" rx="2.6" /><path d="M8.2 10.2V7.6a3.8 3.8 0 0 1 7.6 0v2.6" /></>,
  warn: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 17h.01" /></>,
  move: <><path d="M12 3.4 14.4 6M12 3.4 9.6 6M12 3.4v17.2M12 20.6 9.6 18M12 20.6l2.4-2.6M3.4 12 6 9.6M3.4 12 6 14.4M3.4 12h17.2M20.6 12 18 9.6M20.6 12 18 14.4" /></>,
  micOff: <><path d="M9 9v2a3 3 0 0 0 4.6 2.5" /><path d="M15 10.6V6a3 3 0 0 0-5.7-1.3" /><path d="M18.5 11v.4a6.5 6.5 0 0 1-9.6 5.7M5.5 11v.4a6.5 6.5 0 0 0 2 4.7" /><path d="M12 17.9V21" /><path d="m4 3.6 16.4 16.8" /></>,
  sparkle: <><path d="M12 3.6 13.7 9l5.4 1.7-5.4 1.7L12 17.8l-1.7-5.4L4.9 10.7 10.3 9Z" /><path d="M18.4 15.6l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7Z" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.1 14.2a1.4 1.4 0 0 0 .3 1.5l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.4 1.4 0 0 0-1.5-.3 1.4 1.4 0 0 0-.9 1.3V20a2 2 0 1 1-4 0v-.2a1.4 1.4 0 0 0-.9-1.3 1.4 1.4 0 0 0-1.5.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.4 1.4 0 0 0 .3-1.5 1.4 1.4 0 0 0-1.3-.9H4a2 2 0 1 1 0-4h.2a1.4 1.4 0 0 0 1.3-.9 1.4 1.4 0 0 0-.3-1.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.4 1.4 0 0 0 1.5.3h.1a1.4 1.4 0 0 0 .8-1.3V4a2 2 0 1 1 4 0v.2a1.4 1.4 0 0 0 .9 1.3 1.4 1.4 0 0 0 1.5-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.4 1.4 0 0 0-.3 1.5v.1a1.4 1.4 0 0 0 1.3.8H20a2 2 0 1 1 0 4h-.2a1.4 1.4 0 0 0-1.3.9Z" /></>,

  /* ---- transport ---- */
  mic: <><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M18.5 11v.4a6.5 6.5 0 0 1-13 0V11" /><path d="M12 17.9V21" /></>,
  play: <><path d="M8 5.2v13.6L19 12Z" fill="currentColor" stroke="none" /></>,
  pause: <><rect x="7" y="5" width="3.5" height="14" rx="1.2" fill="currentColor" stroke="none" /><rect x="13.5" y="5" width="3.5" height="14" rx="1.2" fill="currentColor" stroke="none" /></>,
  stop: <><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" /></>,
  /* Skip glyphs carry their own number: the arc says which way, the
     numeral says how far. */
  back15: <><path d="M9.4 5A7.5 7.5 0 1 0 14.6 5" /><path d="M12.2 2.4 9.2 5l3 2.6" /><text x="12" y="15.6" textAnchor="middle" fontSize="8.4" fontWeight="700" letterSpacing="-.4" fill="currentColor" stroke="none">15</text></>,
  fwd15: <><path d="M14.6 5A7.5 7.5 0 1 1 9.4 5" /><path d="M11.8 2.4 14.8 5l-3 2.6" /><text x="12" y="15.6" textAnchor="middle" fontSize="8.4" fontWeight="700" letterSpacing="-.4" fill="currentColor" stroke="none">15</text></>,
  bookmark: <><path d="M6.5 4.8h11v14.4l-5.5-3.9-5.5 3.9Z" /></>,
  bookmarkOn: <><path d="M6.5 4.8h11v14.4l-5.5-3.9-5.5 3.9Z" fill="currentColor" /></>,

  /* ---- recording options ---- */
  pencil: <><path d="M4.5 19.5h3.2L19 8.2a1.7 1.7 0 0 0 0-2.4l-.8-.8a1.7 1.7 0 0 0-2.4 0L4.5 16.3Z" /><path d="m14.8 6.7 2.5 2.5" /></>,
  heart: <><path d="M12 19.7S4 15 4 9.9a4 4 0 0 1 7.3-2.3l.7 1 .7-1A4 4 0 0 1 20 9.9c0 5.1-8 9.8-8 9.8Z" /></>,
  heartOn: <><path d="M12 19.7S4 15 4 9.9a4 4 0 0 1 7.3-2.3l.7 1 .7-1A4 4 0 0 1 20 9.9c0 5.1-8 9.8-8 9.8Z" fill="currentColor" /></>,
  share: <><path d="M12 15.5V4m0 0L8.4 7.6M12 4l3.6 3.6" /><path d="M5.5 13.5v5A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5v-5" /></>,
  download: <><path d="M12 4v11.5m0 0L8.4 11.9M12 15.5l3.6-3.6" /><path d="M5.5 15.5v3A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5v-3" /></>,
  text: <><path d="M5 6.5h14M5 11h14M5 15.5h9" /></>,
  trash: <><path d="M4.5 7h15M10 7V5.2A1.2 1.2 0 0 1 11.2 4h1.6A1.2 1.2 0 0 1 14 5.2V7" /><path d="M6.5 7 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2A1.5 1.5 0 0 0 16.6 19L17.5 7" /><path d="M10.5 10.5v6M13.5 10.5v6" /></>,
  check: <><path d="m5 12.5 4.5 4.5L19 7.5" /></>,
  archive: <><rect x="4" y="5" width="16" height="4" rx="1.4" /><path d="M5.5 9v9.5A1.5 1.5 0 0 0 7 20h10a1.5 1.5 0 0 0 1.5-1.5V9" /><path d="M10 13h4" /></>,

  /* ---- files ---- */
  file: <><path d="M13.5 3.5H7.8A1.8 1.8 0 0 0 6 5.3v13.4a1.8 1.8 0 0 0 1.8 1.8h8.4a1.8 1.8 0 0 0 1.8-1.8V8Z" /><path d="M13.5 3.5V8H18" /></>,
  upload: <><path d="M12 15.5V4m0 0L8 8m4-4 4 4" /><path d="M4.5 15.5v3A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-3" /></>,

  /* ---- folder icons, for the create sheet ---- */
  education: <><path d="M12 4.5 21 9l-9 4.5L3 9Z" /><path d="M6.5 11v5c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6v-5" /></>,
  document: <><path d="M13.5 3.5H7.8A1.8 1.8 0 0 0 6 5.3v13.4a1.8 1.8 0 0 0 1.8 1.8h8.4a1.8 1.8 0 0 0 1.8-1.8V8Z" /><path d="M13.5 3.5V8H18" /><path d="M9 12.5h6M9 16h4" /></>,
  computer: <><rect x="3.5" y="5" width="17" height="11" rx="1.8" /><path d="M2.5 19.5h19" /></>,
  people: <><circle cx="9.5" cy="8.5" r="3" /><path d="M3.8 19.5a5.7 5.7 0 0 1 11.4 0" /><path d="M16 6.2a3 3 0 0 1 0 5.8" /><path d="M17.4 14.6a5.7 5.7 0 0 1 3 4.9" /></>,
  levels: <><path d="M4 8.5h16M4 15.5h16" /><circle cx="9" cy="8.5" r="2" fill="currentColor" stroke="none" /><circle cx="15" cy="15.5" r="2" fill="currentColor" stroke="none" /></>,
  dumbbell: <><path d="M8 12h8" /><rect x="6" y="7.5" width="2.2" height="9" rx="1" /><rect x="3.2" y="9.5" width="2.2" height="5" rx="1" /><rect x="15.8" y="7.5" width="2.2" height="9" rx="1" /><rect x="18.6" y="9.5" width="2.2" height="5" rx="1" /></>,
  music: <><path d="M9 17.5V6.2l10-2v11" /><circle cx="6.8" cy="17.6" r="2.4" /><circle cx="16.8" cy="15.4" r="2.4" /></>,
  airplane: <><path d="M10.5 3.7a1.5 1.5 0 0 1 3 0V9l7 4.2v2.1l-7-2.1v4l2.4 1.8v1.4L12 19.6l-3.9.8v-1.4l2.4-1.8v-4l-7 2.1v-2.1L10.5 9Z" /></>,
  favourite: <><path d="M12 19.7S4 15 4 9.9a4 4 0 0 1 7.3-2.3l.7 1 .7-1A4 4 0 0 1 20 9.9c0 5.1-8 9.8-8 9.8Z" /></>,
};

export function Icon({ name, size, className = '', strokeWidth = 1.8 }) {
  const glyph = PATHS[name];
  if (!glyph) return null;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size} height={size}
      fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >{glyph}</svg>
  );
}

/** The eight folder icons offered when a folder is created. */
export const FOLDER_ICONS = ['education', 'document', 'computer', 'people', 'dumbbell', 'music', 'airplane', 'favourite'];

export default Icon;
