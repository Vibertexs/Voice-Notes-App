/**
 * The trace. The only place the full coral-to-violet sweep is spent.
 *
 * The colour is a position, not a value: bar i is interpolated by how far along
 * the recording it sits, so the same gradient reads across a 12 second memo and
 * a 90 minute lecture. Amplitude is height only.
 *
 * `progress` does double duty. Below zero there is no playhead and every bar is
 * lit, which is the live-recording look; at 0..1 the bars past it drop to the
 * unplayed grey and the playhead appears. `dim` is the paused state, where the
 * trace is still there but nothing is live.
 *
 * Reference: docs/design/voiceflow/VFWaveform.dc.html
 */

const HOT = [255, 45, 85];
const COLD = [155, 92, 255];

const mix = (t) => `rgb(${HOT.map((a, i) => Math.round(a + (COLD[i] - a) * t)).join(',')})`;

/**
 * A deterministic trace for anything with no real levels behind it yet - an
 * empty state, a row that has not been decoded. Seeded so a given recording
 * always draws the same shape rather than flickering on every render.
 */
export function placeholderLevels(seed = 7, count = 56) {
  const out = [];
  let s = (Number(seed) * 7919) % 233280;
  for (let i = 0; i < count; i += 1) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    const envelope = 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / count);
    out.push(Math.max(0.07, Math.min(1, (0.2 + r * 0.8) * envelope)));
  }
  return out;
}

export function seedFrom(text = '') {
  let s = 0;
  for (const ch of String(text)) s = (s * 31 + ch.charCodeAt(0)) % 233280;
  return s || 7;
}

export default function VFWaveform({
  levels, count = 56, seed = 7, height = 96, gap = 3,
  progress = -1, dim = false, centerHead = false, onSeek, className = '',
}) {
  const data = levels?.length ? levels : placeholderLevels(seed, count);
  const last = data.length - 1;

  const seek = (event) => {
    if (!onSeek) return;
    const box = event.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)));
  };

  return (
    <div
      className={`vf-wave${onSeek ? ' is-seekable' : ''} ${className}`}
      style={{ height: `${height}px`, gap: `${gap}px` }}
      onClick={seek}
      role={onSeek ? 'slider' : undefined}
      aria-label={onSeek ? 'Seek' : undefined}
      aria-valuenow={onSeek ? Math.round(Math.max(0, progress) * 100) : undefined}
    >
      {data.map((value, i) => {
        const t = last > 0 ? i / last : 0;
        const played = progress < 0 || t <= progress;
        return (
          <i
            key={i}
            style={{
              height: `${Math.max(3, Math.round(value * height))}px`,
              background: dim ? 'var(--wave-paused)' : played ? mix(t) : 'var(--wave-idle)',
            }}
          />
        );
      })}
      {(progress >= 0 || centerHead) && (
        <span className="vf-wave-head" style={{ left: `${(progress >= 0 ? progress : 0.5) * 100}%` }} />
      )}
    </div>
  );
}
