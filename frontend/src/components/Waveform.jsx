import { useEffect, useRef } from 'react';

const BAR_WIDTH = 3;
const BAR_GAP = 2;
const SAMPLE_EVERY_MS = 48;
const MAX_BARS = 900;

/**
 * The live level meter from the original recorder: rounded bars that scroll
 * right to left, eased so the trace glides instead of twitching.
 *
 * `stream` supplies audio; `phase` only decides the colour, so the trace stays
 * on screen while paused instead of blanking.
 */
export default function Waveform({ stream, phase }) {
  const canvasRef = useRef(null);
  const levelsRef = useRef([]);
  const frameRef = useRef(0);
  const analyserRef = useRef(null);
  const samplesRef = useRef(null);
  const contextRef = useRef(null);
  const phaseRef = useRef(phase);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Reset the trace when a new take begins.
  useEffect(() => {
    if (!stream) levelsRef.current = [];
  }, [stream]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let audioContext = null;
    if (stream) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContextClass();
      contextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.86;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      analyserRef.current = analyser;
      samplesRef.current = new Float32Array(analyser.fftSize);
    }

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const sampleLevel = () => {
      const analyser = analyserRef.current;
      const samples = samplesRef.current;
      if (!analyser || !samples) return 0;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += value * value;
      const rms = Math.sqrt(sum / samples.length);
      // Gate room noise so silence reads flat rather than fuzzy.
      const gated = Math.max(0, (rms - 0.006) / 0.12);
      return Math.min(1, gated ** 0.55);
    };

    const draw = () => {
      const context = canvas.getContext('2d');
      const ratio = window.devicePixelRatio || 1;
      const barWidth = BAR_WIDTH * ratio;
      const step = (BAR_WIDTH + BAR_GAP) * ratio;
      const capacity = Math.ceil(canvas.width / step);
      const visible = levelsRef.current.slice(-capacity);
      context.clearRect(0, 0, canvas.width, canvas.height);
      const styles = getComputedStyle(canvas);
      context.fillStyle = (phaseRef.current === 'recording'
        ? styles.getPropertyValue('--rec')
        : styles.getPropertyValue('--wave-idle')).trim() || '#a9b5c6';
      for (let index = 0; index < capacity; index += 1) {
        const sourceIndex = visible.length - capacity + index;
        const previous = visible[sourceIndex - 1] ?? visible[sourceIndex] ?? 0;
        const level = visible[sourceIndex] ?? 0;
        const next = visible[sourceIndex + 1] ?? level;
        const smoothed = (previous + 2 * level + next) / 4;
        const barHeight = Math.max(barWidth, smoothed * canvas.height * 0.94);
        const x = index * step;
        const y = (canvas.height - barHeight) / 2;
        context.beginPath();
        if (context.roundRect) context.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        else context.rect(x, y, barWidth, barHeight);
        context.fill();
      }
    };

    let target = 0;
    let level = 0;
    let lastSampleAt = 0;
    const tick = (now) => {
      if (phaseRef.current === 'recording') {
        if (now - lastSampleAt >= SAMPLE_EVERY_MS) {
          target = sampleLevel();
          lastSampleAt = now;
        }
        level += (target - level) * 0.16;
        levelsRef.current.push(level);
        if (levelsRef.current.length > MAX_BARS) {
          levelsRef.current.splice(0, levelsRef.current.length - MAX_BARS);
        }
      }
      draw();
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameRef.current);
      observer.disconnect();
      analyserRef.current = null;
      samplesRef.current = null;
      if (audioContext) audioContext.close().catch(() => {});
      contextRef.current = null;
    };
  }, [stream]);

  return <canvas ref={canvasRef} className="waveform" aria-hidden="true" />;
}
