import Svg, { Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

/**
 * The class folder, carrying the exact path data from the web
 * ClassFolderArt component so the silhouette matches between clients.
 *
 * One continuous path rather than assembled pieces: on the web that avoided
 * seams when cards resized, and the same reasoning holds across screen widths
 * here.
 */
export default function ClassFolderArt({ tone, width = 150, height = 108 }) {
  const id = `f${tone.a.slice(1)}`;
  return (
    <Svg width={width} height={height} viewBox="0 0 320 230">
      <Defs>
        <LinearGradient id={id} x1="34" y1="28" x2="284" y2="218" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={tone.a} />
          <Stop offset="0.48" stopColor={tone.a} stopOpacity="0.72" />
          <Stop offset="1" stopColor={tone.b} />
        </LinearGradient>
        <RadialGradient id={`${id}g`} cx="0.28" cy="0.14" r="0.82">
          <Stop offset="0" stopColor="#fff" stopOpacity="0.42" />
          <Stop offset="1" stopColor="#fff" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Path
        fill={`url(#${id})`}
        d="M31 62c0-15 12-27 27-27h64c10 0 18 4 25 12l13 15h108c16 0 29 13 29 29v96c0 17-13 30-30 30H53c-17 0-30-13-30-30V77c0-8 3-15 8-20Z"
      />
      <Path
        fill={`url(#${id}g)`}
        d="M31 62c0-15 12-27 27-27h64c10 0 18 4 25 12l13 15h108c16 0 29 13 29 29v96c0 17-13 30-30 30H53c-17 0-30-13-30-30V77c0-8 3-15 8-20Z"
      />
    </Svg>
  );
}
