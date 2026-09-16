/**
 * Cover art.
 *
 * A flat, saturated ground with print grain over it — closer to a screen
 * printed sleeve than to a rendered gradient. The title is set on top of it
 * by whatever is using the cover, so the artwork carries colour and texture
 * and the typography carries the meaning.
 *
 * Every tone is dark enough to hold white text at full contrast.
 */

/* Ink colours, deep enough to hold white type and to sit against the
   lemon hero panel without muddying into it. */
const TONES = {
  blue:   '#2743C8',
  violet: '#6429D6',
  rose:   '#C42C60',
  coral:  '#CE3D16',
  amber:  '#A05A02',
  lime:   '#46700C',
  mint:   '#0A7A6F',
  sky:    '#12688F',
  slate:  '#445264',
};

export default function CoverArt({ color = 'blue', className = '' }) {
  return (
    <span
      className={`cover ${className}`}
      style={{ '--tone': TONES[color] ?? TONES.blue }}
      aria-hidden="true"
    >
      <span className="cover-grain" />
    </span>
  );
}

export { TONES };
