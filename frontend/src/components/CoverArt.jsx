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

/**
 * `glass` puts a frosted pane over the tone, which is how every object that
 * carries a user-chosen colour presents it: the colour is the ground, the
 * face is glass. The player's stage opts out - a full-bleed artwork is the
 * backdrop for the glass card on top of it, so frosting it as well would
 * leave nothing for that card to sit against.
 */
export default function CoverArt({ color = 'blue', className = '', glass = false }) {
  return (
    <span
      className={`cover ${className}`}
      style={{ '--tone': TONES[color] ?? TONES.blue }}
      aria-hidden="true"
    >
      <span className="cover-grain" />
      {glass && <span className="cover-glass" />}
    </span>
  );
}

export { TONES };
