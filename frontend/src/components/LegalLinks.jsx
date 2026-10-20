/**
 * Links to the legal pages, which the cloud API serves (backend/cloud/legal.py).
 *
 * They are plain links: the phone shell opens any web address in the browser
 * rather than replacing the app (onShouldStartLoadWithRequest in mobile/App.js).
 * With no server configured (a build without backup) there is nothing to link to,
 * and nothing is drawn.
 */
export const LEGAL_PAGES = [
  ['Privacy', '/privacy'],
  ['Terms', '/terms'],
  ['Recording & consent', '/recording-consent'],
];

export default function LegalLinks({ serverUrl, className = '' }) {
  if (!serverUrl) return null;
  return (
    <nav className={`legal-links ${className}`} aria-label="Legal">
      {LEGAL_PAGES.map(([label, path]) => <a key={path} href={`${serverUrl}${path}`}>{label}</a>)}
    </nav>
  );
}
