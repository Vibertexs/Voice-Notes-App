/**
 * Cover art.
 *
 * The design language leans on album artwork: every item is a coloured
 * rectangle you recognise before you read it. Recordings have no artwork, so
 * it is generated — a deterministic gradient seeded from the item's id, in the
 * palette of the class it belongs to, with grain and a faint level trace over
 * it so it reads as audio rather than as a blank swatch.
 */

const PALETTES = {
  blue:   ['#8FB6FF', '#4B79E8', '#1E3F9E'],
  violet: ['#D5A6FF', '#9058EC', '#5B2AAE'],
  rose:   ['#FFB3D2', '#EE6EA4', '#A83566'],
  coral:  ['#FFB794', '#F07A52', '#AE4331'],
  amber:  ['#FFDE93', '#EFAE3E', '#B96A14'],
  lime:   ['#D6F79F', '#8FD35F', '#42923F'],
  mint:   ['#9FF0DB', '#4FC7AC', '#1C7A70'],
  sky:    ['#A8E6FF', '#5FBCE4', '#2578A8'],
  slate:  ['#CBD6E4', '#8E9FB5', '#566779'],
};

/** Stable 32-bit hash so the same id always yields the same artwork. */
function seedOf(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

export default function CoverArt({ id, color = 'blue', label, className = '' }) {
  const [light, mid, deep] = PALETTES[color] ?? PALETTES.blue;
  const seed = seedOf(id ?? label);
  const angle = 120 + Math.round(seed * 110);
  const x = 14 + Math.round(seed * 50);
  const y = 8 + Math.round(seedOf(`${id}-y`) * 34);

  // The trace is decorative, but it is seeded too, so a lecture keeps its own
  // silhouette everywhere it appears.
  const bars = Array.from({ length: 22 }, (_, i) => {
    const n = seedOf(`${id}-${i}`);
    return 0.22 + n * 0.78;
  });

  return (
    <span className={`cover ${className}`} aria-hidden="true">
      <span
        className="cover-wash"
        style={{
          background:
            `radial-gradient(120% 90% at ${x}% ${y}%, ${light}, transparent 62%),` +
            `linear-gradient(${angle}deg, ${mid} 0%, ${deep} 88%)`,
        }}
      />
      <span className="cover-grain" />
      <span className="cover-trace">
        {bars.map((height, index) => (
          <i key={index} style={{ height: `${Math.round(height * 100)}%` }} />
        ))}
      </span>
    </span>
  );
}

export { PALETTES };
