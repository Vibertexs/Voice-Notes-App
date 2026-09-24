import { useEffect, useRef, useState } from 'react';

/** How many bars the live trace keeps. The handoff's session state says ~64. */
const KEEP = 64;
const SAMPLE_EVERY_MS = 48;

/**
 * The microphone, as a short list of numbers between 0 and 1.
 *
 * Split out of the old canvas waveform so the trace can be drawn as real
 * elements instead: the handoff wants rounded bars with a gap and a playhead,
 * which is a layout problem, not a painting one.
 *
 * Two things here are not obvious and both were bugs:
 *
 * - An AudioContext created outside a user gesture starts suspended, and a
 *   suspended analyser reports pure silence. That looks exactly like a working
 *   recorder capturing nothing, so it is resumed on creation.
 * - Room noise has to be gated, or silence reads as a fuzzy band rather than a
 *   flat thread and every recording looks the same.
 *
 * While paused it stops sampling but keeps what it has, so the trace stays on
 * screen instead of blanking.
 */
export default function useLiveLevels(stream, active) {
  const [levels, setLevels] = useState([]);
  const buffer = useRef([]);
  const live = useRef(active);

  useEffect(() => { live.current = active; }, [active]);
  useEffect(() => { if (!stream) { buffer.current = []; setLevels([]); } }, [stream]);

  useEffect(() => {
    if (!stream) return undefined;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return undefined;
    const context = new AudioContextClass();
    if (context.state === 'suspended') context.resume().catch(() => {});
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.86;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    let frame = 0;
    let lastAt = 0;
    let target = 0;
    let level = 0;

    const read = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += value * value;
      const rms = Math.sqrt(sum / samples.length);
      const gated = Math.max(0, (rms - 0.006) / 0.12);
      return Math.min(1, gated ** 0.55);
    };

    const tick = (time) => {
      if (live.current) {
        if (time - lastAt >= SAMPLE_EVERY_MS) { target = read(); lastAt = time; }
        level += (target - level) * 0.16;
        const next = [...buffer.current, Math.max(0.05, level)];
        buffer.current = next.length > KEEP ? next.slice(-KEEP) : next;
        setLevels(buffer.current);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      context.close().catch(() => {});
    };
  }, [stream]);

  return levels;
}
