/**
 * Handing something to the phone's share sheet.
 *
 * Inside the app, the shell owns sharing: a WebView has no share sheet of its own and a
 * `navigator.share` there does nothing, so the page asks the shell (`window.__cnShare`,
 * see mobile/src/bridge.js). Resolves true when the shell took it, false when there is no
 * shell (a browser while developing), so the caller can fall back. A shell that cannot
 * share rejects with a message worth showing.
 */
export async function shareNative(payload) {
  if (typeof window.__cnShare !== 'function') return false;
  await window.__cnShare(payload);
  return true;
}

/** A recording's sessions, newest first. */
export const newestFirst = (sessions = []) => [...sessions].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

/** What was said in a recording as one block of text, under its title; empty if nothing was transcribed. */
export function transcriptText(detail) {
  const sessions = [...(detail?.sessions ?? [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const body = sessions
    .map((session) => String(session.transcript || (session.segments ?? []).map((segment) => segment.text).join(' ')).trim())
    .filter(Boolean)
    .join('\n\n');
  return body ? `${detail.title}\n\n${body}` : '';
}
