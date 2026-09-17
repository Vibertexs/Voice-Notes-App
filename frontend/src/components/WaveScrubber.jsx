import { useCallback, useEffect, useRef } from 'react';

/**
 * The whole recording, drawn at once: played bars in the accent, the rest
 * dimmed. Tap or drag anywhere on it to move the playhead — the entire width
 * is the control, so there is no small handle to find on a phone.
 *
 * The bars come from the transcript's timing rather than the audio samples.
 * Decoding an hour of audio to find peaks would cost more memory than the
 * recording takes on disk, and speech density is the more useful thing to
 * see anyway: the tall stretches are where someone was talking.
 */

const BAR = 2.5;
const GAP = 2;
const MIN_BARS = 28;

/** Deterministic per-bar jitter, so the trace has texture but never reshuffles. */
function noise(index) {
  const value = Math.sin(index * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function buildBars(count, durationSeconds, segments) {
  const bars = new Float32Array(count);
  const secondsPerBar = durationSeconds / count;

  for (const segment of segments ?? []) {
    const start = Math.floor((segment.start_seconds ?? 0) / secondsPerBar);
    const words = String(segment.text ?? '').trim().split(/\s+/).length;
    const span = Math.max(1, Math.round((words * 0.4) / secondsPerBar));
    for (let i = start; i < Math.min(count, start + span); i += 1) {
      bars[i] = Math.max(bars[i], 0.5 + noise(i) * 0.5);
    }
  }
  for (let i = 0; i < count; i += 1) {
    if (bars[i] === 0) bars[i] = 0.1 + noise(i) * 0.14;
  }
  return bars;
}

export default function WaveScrubber({
  durationSeconds, currentSeconds, segments, playing, onScrub, onScrubEnd, variant = 'default',
}) {
  const canvasRef = useRef(null);
  const cacheRef = useRef(null);
  const draggingRef = useRef(false);
  const duration = Math.max(0.1, durationSeconds || 0.1);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    if (canvas.width !== Math.round(width * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const step = BAR + GAP;
    const count = Math.max(MIN_BARS, Math.floor(width / step));

    // Rebuild only when the track or its transcript actually changed.
    const signature = `${count}|${duration}|${segments?.length ?? 0}`;
    if (cacheRef.current?.signature !== signature) {
      cacheRef.current = { signature, values: buildBars(count, duration, segments) };
    }
    const bars = cacheRef.current.values;

    const styles = getComputedStyle(canvas);
    const accent = styles.getPropertyValue('--accent').trim() || '#ECEF5E';
    const idle = 'rgba(255,255,255,.26)';
    const played = Math.min(1, Math.max(0, (currentSeconds || 0) / duration));
    const headIndex = played * count;
    const mid = height / 2;
    const spectrum = variant === 'spectrum'
      ? (() => {
        const gradient = context.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#b533ff');
        gradient.addColorStop(.3, '#ff3ebd');
        gradient.addColorStop(.63, '#346eff');
        gradient.addColorStop(1, '#b533ff');
        return gradient;
      })()
      : null;

    for (let i = 0; i < count; i += 1) {
      const barHeight = Math.max(2, bars[i] * height);
      const x = i * step;
      const y = mid - barHeight / 2;
      context.globalAlpha = spectrum ? (i <= headIndex ? 1 : .56) : 1;
      context.fillStyle = spectrum || (i <= headIndex ? accent : idle);
      context.beginPath();
      if (context.roundRect) context.roundRect(x, y, BAR, barHeight, BAR / 2);
      else context.rect(x, y, BAR, barHeight);
      context.fill();
    }
    context.globalAlpha = 1;
  }, [currentSeconds, duration, segments]);

  useEffect(() => { draw(); }, [draw, playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  const secondsAt = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const box = canvas.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    return Math.min(duration, Math.max(0, ratio * duration));
  };

  function pointerDown(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    onScrub?.(secondsAt(event));
  }
  function pointerMove(event) {
    if (!draggingRef.current) return;
    onScrub?.(secondsAt(event));
  }
  function pointerUp(event) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onScrubEnd?.();
  }

  function keyDown(event) {
    const jump = event.shiftKey ? 30 : 5;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onScrub?.(Math.max(0, (currentSeconds || 0) - jump));
      onScrubEnd?.();
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      onScrub?.(Math.min(duration, (currentSeconds || 0) + jump));
      onScrubEnd?.();
    }
  }

  return (
    <div
      className="wave"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
      onKeyDown={keyDown}
      role="slider"
      tabIndex={0}
      aria-label="Scrub through the recording"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentSeconds || 0)}
      aria-valuetext={`${Math.floor((currentSeconds || 0) / 60)} minutes ${Math.floor((currentSeconds || 0) % 60)} seconds`}
    >
      <canvas ref={canvasRef} className={`wave-canvas ${variant === 'spectrum' ? 'spectrum' : ''}`} />
    </div>
  );
}
