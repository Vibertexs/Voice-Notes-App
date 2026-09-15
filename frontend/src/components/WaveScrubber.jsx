import { useCallback, useEffect, useRef } from 'react';

/**
 * A scrubber you drag the recording through, rather than dragging a handle
 * along it.
 *
 * The playhead is fixed at the centre and the waveform slides underneath, so
 * the gesture is "move the tape", not "hit the small target". On a phone that
 * is the difference between usable and not: there is no 8px handle to find,
 * and the whole width is the control.
 *
 * The bars are drawn from the transcript's timing rather than from the audio's
 * samples. Decoding an hour of WAV to find peaks would cost more memory than
 * the recording does on disk - the exact thing this app avoids - and speech
 * density is the more useful thing to see anyway: the tall stretches are where
 * someone was talking.
 */

const PIXELS_PER_SECOND = 14;
const BAR_WIDTH = 3;
const BAR_GAP = 2;

/** Deterministic per-bar jitter, so the trace has texture but never reshuffles. */
function noise(index) {
  const value = Math.sin(index * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function buildBars(durationSeconds, segments) {
  const total = Math.max(1, Math.ceil(durationSeconds * PIXELS_PER_SECOND / (BAR_WIDTH + BAR_GAP)));
  const secondsPerBar = durationSeconds / total;
  const bars = new Float32Array(total);

  // Mark the stretches where speech was recognised, then soften the edges so
  // the result reads as a waveform rather than a bar chart.
  for (const segment of segments ?? []) {
    const start = Math.floor((segment.start_seconds ?? 0) / secondsPerBar);
    const words = String(segment.text ?? '').trim().split(/\s+/).length;
    const span = Math.max(1, Math.round(words * 0.4 / secondsPerBar));
    for (let i = start; i < Math.min(total, start + span); i++) {
      bars[i] = Math.max(bars[i], 0.55 + noise(i) * 0.45);
    }
  }
  for (let i = 0; i < total; i++) {
    if (bars[i] === 0) bars[i] = 0.06 + noise(i) * 0.1;
  }
  return bars;
}

export default function WaveScrubber({
  durationSeconds, currentSeconds, segments, playing, onScrub, onScrubEnd,
}) {
  const canvasRef = useRef(null);
  const barsRef = useRef(null);
  const dragRef = useRef(null);
  const duration = Math.max(0.1, durationSeconds || 0.1);

  if (!barsRef.current || barsRef.current.duration !== duration
      || barsRef.current.count !== (segments?.length ?? 0)) {
    barsRef.current = {
      duration,
      count: segments?.length ?? 0,
      values: buildBars(duration, segments),
    };
  }

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const bars = barsRef.current.values;
    const step = BAR_WIDTH + BAR_GAP;
    const centre = width / 2;
    const played = Math.min(duration, Math.max(0, currentSeconds || 0));
    // The bar sitting under the playhead right now.
    const head = (played / duration) * bars.length;

    for (let i = 0; i < bars.length; i++) {
      const x = centre + (i - head) * step;
      if (x < -step || x > width + step) continue;

      const amplitude = bars[i];
      const barHeight = Math.max(2, amplitude * (height - 12));
      const y = (height - barHeight) / 2;

      // Past is solid, future is faint, and the very centre is the accent.
      const distance = Math.abs(x - centre);
      if (distance < step) context.fillStyle = '#2a63dd';
      else if (i < head) context.fillStyle = 'rgba(19,27,46,.38)';
      else context.fillStyle = 'rgba(19,27,46,.15)';

      context.fillRect(x, y, BAR_WIDTH, barHeight);
    }

    // The playhead itself.
    context.fillStyle = '#131b2e';
    context.fillRect(centre - 1, 6, 2, height - 12);
    context.beginPath();
    context.arc(centre, 6, 3.5, 0, Math.PI * 2);
    context.fill();
  }, [currentSeconds, duration]);

  useEffect(() => { draw(); }, [draw, playing]);

  useEffect(() => {
    const observer = new ResizeObserver(draw);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [draw]);

  const secondsPerPixel = duration / (barsRef.current.values.length * (BAR_WIDTH + BAR_GAP));

  function pointerDown(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, from: currentSeconds || 0 };
  }

  function pointerMove(event) {
    if (!dragRef.current) return;
    // Dragging left moves the tape forward, the way scrubbing a physical reel
    // does - the playhead never moves.
    const delta = (dragRef.current.x - event.clientX) * secondsPerPixel;
    const next = Math.min(duration, Math.max(0, dragRef.current.from + delta));
    onScrub?.(next);
  }

  function pointerUp(event) {
    if (!dragRef.current) return;
    dragRef.current = null;
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
      className="wave-scrubber"
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
      <canvas ref={canvasRef} className="wave-scrubber-canvas" />
    </div>
  );
}
