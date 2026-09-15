/**
 * The design tokens from the web app, transcribed.
 *
 * The web build carries these as CSS custom properties in styles.css; the
 * values here are the same numbers so the two clients read as one product.
 * What does not survive the crossing is noted where it matters: hover states
 * have no meaning on a touch screen, and backdrop-filter has no RN equivalent
 * outside expo-blur, so glass surfaces are approximated with flat alpha.
 */

export const colors = {
  // --canvas / --ink family
  page: '#e8eef7',
  canvasTop: '#eef3fa',
  ink: '#131b2e',
  soft: '#5b6a86',
  faint: '#8a98b0',
  line: 'rgba(19,27,46,.1)',
  edge: '#c8d4e5',

  // glass
  card: 'rgba(255,255,255,.72)',
  cardSolid: '#ffffff',
  glass: 'rgba(249,252,255,.62)',
  glassBorder: 'rgba(255,255,255,.78)',

  // brand
  accent: '#2a63dd',
  accentDeep: '#1b47a8',
  blue: '#2168dc',

  // navy — lectures and the recorder
  navy: '#10143d',
  navyDeep: '#07092b',
  deep: '#07092b',
  onDeep: '#f8fbff',
  dim: 'rgba(206,216,240,.66)',

  rec: '#ff4d45',
  danger: '#b62f3f',
};

/**
 * Class colours. Each is the dark-theme triplet from styles.css: the folder
 * artwork gradients from tone A to tone B, sitting on its own sleeve.
 */
export const classTones = {
  blue:   { a: '#9d74ff', b: '#2418c8', sleeve: '#07094a', edge: '#0c0c54' },
  violet: { a: '#d69aff', b: '#561bb5', sleeve: '#1a063f', edge: '#21084f' },
  rose:   { a: '#ff9dcc', b: '#a51b60', sleeve: '#2c071c', edge: '#3b0b26' },
  coral:  { a: '#ffab80', b: '#ae2130', sleeve: '#2e0810', edge: '#3d0d18' },
  amber:  { a: '#ffdc72', b: '#b65a08', sleeve: '#2b1803', edge: '#3b2006' },
  lime:   { a: '#ddf58d', b: '#427f0e', sleeve: '#101f05', edge: '#19300a' },
  mint:   { a: '#78ebcf', b: '#11736a', sleeve: '#062b2a', edge: '#0a3a39' },
  sky:    { a: '#82d8ff', b: '#07679a', sleeve: '#06213a', edge: '#082e50' },
  slate:  { a: '#bfccdc', b: '#47576d', sleeve: '#101a2c', edge: '#17243a' },
};

export const CLASS_COLORS = Object.keys(classTones);
export const toneFor = (color) => classTones[color] ?? classTones.blue;

export const type = {
  // .eyebrow — uppercase, tracked out, small and heavy
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  title: { fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
  h2: { fontSize: 21, fontWeight: '700', letterSpacing: -0.35 },
  heading: { fontSize: 16, fontWeight: '650', letterSpacing: -0.2 },
  body: { fontSize: 13.5, lineHeight: 19 },
  button: { fontSize: 14.5, fontWeight: '700' },
  clock: { fontSize: 58, fontWeight: '300', letterSpacing: 1, fontVariant: ['tabular-nums'] },
  mono: { fontSize: 12, fontVariant: ['tabular-nums'] },
};

/** --lift-1..3, as RN shadows. Android only honours elevation. */
export const lift = {
  1: { shadowColor: '#101c38', shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  2: { shadowColor: '#101c38', shadowOpacity: 0.14, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  3: { shadowColor: '#0b1027', shadowOpacity: 0.28, shadowRadius: 28, shadowOffset: { width: 0, height: 14 }, elevation: 12 },
};
