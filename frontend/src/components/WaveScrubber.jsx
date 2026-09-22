import { useCallback, useEffect, useRef, useState } from 'react';
import { mmss } from '../lib/format';

/**
 * The timeline, with the playhead nailed to the middle.
 *
 * This is a tape head, not a slider: the white line never moves, and dragging
 * pulls the recording along underneath it. The whole strip is the handle, so
 * there is no small dot to find with a thumb, and a flick keeps gliding for a
 * moment before settling - long recordings are unusable otherwise.
 *
 * The bars come from the transcript's timing rather than the audio samples.
 * Decoding an hour of audio to find peaks would cost more memory than the
 * recording takes on disk, and speech density is the more useful thing to see
 * anyway: the tall stretches are where someone was talking.
 */

const BAR = 3;
const GAP = 2;
const STEP = BAR + GAP;
const SECONDS_PER_BAR = 0.4;
const MIN_BARS = 28;
const MAX_BARS = 8000;

/** Played audio runs coral into purple; what is still ahead is grey. */
const PLAYED = ['#FF375F', '#FF2D8D', '#A855F7'];
const AHEAD = 'rgba(255,255,255,.16)';

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
  for (let i = 0; i < count; i += 1) if (bars[i] === 0) bars[i] = 0.1 + noise(i) * 0.14;
  return bars;
}

const barCount = (durationSeconds) =>
  Math.min(MAX_BARS, Math.max(MIN_BARS, Math.ceil(durationSeconds / SECONDS_PER_BAR)));

export default function WaveScrubber({
  durationSeconds, currentSeconds, segments, markers = [], onScrub, onScrubStart, onScrubEnd,
}) {
  const canvasRef = useRef(null);
  const cacheRef = useRef(null);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startSecondsRef = useRef(0);
  const lastRef = useRef({ seconds: 0, x: 0, at: 0, velocity: 0 });
  const glideRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(0);

  const duration = Math.max(0.1, durationSeconds || 0.1);
  const count = barCount(duration);
  const pixelsPerSecond = STEP / (duration / count);

  useEffect(() => () => cancelAnimationFrame(glideRef.current), []);

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

    const signature = `${count}|${duration}|${segments?.length ?? 0}`;
    if (cacheRef.current?.signature !== signature) {
      cacheRef.current = { signature, values: buildBars(count, duration, segments) };
    }
    const bars = cacheRef.current.values;

    const head = Math.min(1, Math.max(0, (currentSeconds || 0) / duration)) * count;
    const mid = height / 2;
    const played = context.createLinearGradient(0, 0, width, 0);
    PLAYED.forEach((stop, index) => played.addColorStop(index / (PLAYED.length - 1), stop));

    // A hairline the full width of the strip, so the timeline reads as tape
    // running past the head rather than as empty space before the first bar.
    context.fillStyle = 'rgba(255,255,255,.07)';
    context.fillRect(0, mid - 0.5, width, 1);

    const first = Math.max(0, Math.floor(head - width / (2 * STEP) - 3));
    const last = Math.min(count - 1, Math.ceil(head + width / (2 * STEP) + 3));
    for (let i = first; i <= last; i += 1) {
      const barHeight = Math.max(2, bars[i] * height * 0.92);
      const x = width / 2 + (i - head) * STEP;
      context.fillStyle = i <= head ? played : AHEAD;
      context.beginPath();
      if (context.roundRect) context.roundRect(x, mid - barHeight / 2, BAR, barHeight, BAR / 2);
      else context.rect(x, mid - barHeight / 2, BAR, barHeight);
      context.fill();
    }

    // Bookmarks, as ticks on the baseline.
    context.fillStyle = 'rgba(255,255,255,.75)';
    for (const marker of markers ?? []) {
      const x = width / 2 + ((marker.time_seconds / duration) * count - head) * STEP;
      if (x < -4 || x > width + 4) continue;
      context.beginPath();
      context.arc(x + BAR / 2, height - 3, 2.5, 0, Math.PI * 2);
      context.fill();
    }
  }, [count, currentSeconds, duration, markers, segments]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  const clamp = (seconds) => Math.min(duration, Math.max(0, seconds));

  function settle(seconds) {
    draggingRef.current = false;
    setDragging(false);
    onScrubEnd?.(seconds);
  }

  /** A flick keeps moving, decaying, until it is slow enough to stop. */
  function glide(seconds, velocity) {
    let current = seconds;
    let speed = velocity;
    const step = () => {
      speed *= 0.94;
      current = clamp(current - speed * 16);
      setPreview(current);
      onScrub?.(current);
      if (Math.abs(speed) < 0.0004 || current <= 0 || current >= duration) { settle(current); return; }
      glideRef.current = requestAnimationFrame(step);
    };
    glideRef.current = requestAnimationFrame(step);
  }

  function pointerDown(event) {
    cancelAnimationFrame(glideRef.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setDragging(true);
    startXRef.current = event.clientX;
    startSecondsRef.current = currentSeconds || 0;
    lastRef.current = { seconds: currentSeconds || 0, x: event.clientX, at: event.timeStamp, velocity: 0 };
    setPreview(currentSeconds || 0);
    onScrubStart?.();
  }

  function pointerMove(event) {
    if (!draggingRef.current) return;
    const seconds = clamp(startSecondsRef.current - (event.clientX - startXRef.current) / pixelsPerSecond);
    const elapsed = Math.max(1, event.timeStamp - lastRef.current.at);
    lastRef.current = {
      seconds,
      x: event.clientX,
      at: event.timeStamp,
      velocity: (event.clientX - lastRef.current.x) / elapsed / pixelsPerSecond,
    };
    setPreview(seconds);
    onScrub?.(seconds);
  }

  function pointerUp(event) {
    if (!draggingRef.current) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const { seconds, velocity } = lastRef.current;
    if (Math.abs(velocity) > 0.002) glide(seconds, velocity);
    else settle(seconds);
  }

  function keyDown(event) {
    const jump = event.shiftKey ? 30 : 5;
    const to = event.key === 'ArrowLeft' ? clamp((currentSeconds || 0) - jump)
      : event.key === 'ArrowRight' ? clamp((currentSeconds || 0) + jump)
        : null;
    if (to === null) return;
    event.preventDefault();
    onScrub?.(to);
    onScrubEnd?.(to);
  }

  return (
    <div
      className="scrubber"
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
      aria-valuetext={mmss(currentSeconds || 0)}
    >
      <canvas ref={canvasRef} />
      {/* The playhead says where it is, whether or not a thumb is on it -
          it is the only place the current time is written. */}
      <span className="playhead" aria-hidden="true">
        <em>{mmss(dragging ? preview : currentSeconds || 0)}</em>
      </span>
    </div>
  );
}
