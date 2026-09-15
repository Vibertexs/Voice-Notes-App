import { useId } from 'react';

/**
 * A single, continuous folder silhouette. Keeping the folder itself as one
 * path prevents seams when cards resize, while its CSS variables let the
 * class colour picker still control the artwork.
 */
export default function ClassFolderArt() {
  const safeId = useId().replaceAll(':', '');
  const gradientId = `class-folder-${safeId}`;
  const glowId = `class-folder-glow-${safeId}`;

  return <svg className="class-folder-art" viewBox="0 0 320 230" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={gradientId} x1="34" y1="28" x2="284" y2="218" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="var(--folder-light)" />
        <stop offset=".48" stopColor="var(--folder-mid)" />
        <stop offset="1" stopColor="var(--folder-deep)" />
      </linearGradient>
      <radialGradient id={glowId} cx=".28" cy=".14" r=".82">
        <stop offset="0" stopColor="#fff" stopOpacity=".42" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
    </defs>

    <path
      className="class-folder-shape"
      fill={`url(#${gradientId})`}
      d="M31 62c0-15 12-27 27-27h64c10 0 18 4 25 12l13 15h108c16 0 29 13 29 29v96c0 17-13 30-30 30H53c-17 0-30-13-30-30V77c0-8 3-15 8-20Z"
    />
    <path
      className="class-folder-glow"
      fill={`url(#${glowId})`}
      d="M31 62c0-15 12-27 27-27h64c10 0 18 4 25 12l13 15h108c16 0 29 13 29 29v96c0 17-13 30-30 30H53c-17 0-30-13-30-30V77c0-8 3-15 8-20Z"
    />
  </svg>;
}
