/**
 * One place for the formats the interface repeats.
 *
 * A recording is labelled the same way wherever it appears - in a folder, in
 * the playback header, in the saved confirmation - so these live here rather
 * than being written out again per screen.
 */

/** 28:17, or 1:04:09 once a recording runs past the hour. */
export function mmss(seconds = 0) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  if (m < 60) return `${m}:${s}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}`;
}

/** The take clock: 00:12, counting from zero with a leading zero. */
export function clock(milliseconds = 0) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  return `${m}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Sep 16, 2026 */
export const dateLabel = (date) =>
  new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date));

/** Sep 16, 2026 · 28:17 — the metadata line under a recording's name. */
export function recordingMeta(lecture) {
  if (!lecture) return '';
  const when = dateLabel(lecture.created_at);
  return lecture.duration_seconds ? `${when} · ${mmss(lecture.duration_seconds)}` : when;
}

/** 2 recordings */
export const countLabel = (count = 0, noun = 'recording') =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;
