/** Shared formatting. Kept tiny and pure so it is easy to reason about. */

export function newId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** mm:ss.t — the recorder clock. */
export function clock(milliseconds) {
  const tenths = Math.floor((milliseconds || 0) / 100);
  const seconds = Math.floor(tenths / 10);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}.${tenths % 10}`;
}

/** m:ss — durations in a list, where tenths are noise. */
export function duration(milliseconds) {
  const seconds = Math.round((milliseconds || 0) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function timestampTitle(date) {
  return `Lecture — ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function shortDate(iso) {
  const date = new Date(iso);
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function fileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
