/**
 * A progress bar that keeps moving between Whisper's reports.
 *
 * whisper.cpp reports progress once per 30-second window of audio, at the start
 * of the window. A 20-second clip reports once and then finishes; a lecture
 * reports every ~10 seconds of work. Drawn as-is, the bar sits still for as
 * long as a window takes, which reads as frozen.
 *
 * The recording's length is known, so the number of windows is too. This eases
 * the bar toward the next window's boundary at the pace the previous windows
 * took, never reaching it, and lets the real report correct it when it lands.
 * Progress only ever moves forward, and never reads 100% until Whisper says so.
 *
 * Values are the shell's overall fraction: 0 to `start` is the model load, and
 * `start` to 1 is the transcription.
 */
export function createProgressSmoother({
  audioSeconds,
  onChange,
  start = 0.24,
  windowSeconds = 30,
  // Until a window has been timed, assume the phone runs about three times
  // faster than real time (what small.en manages on a 2023 handset).
  guessRealtime = 3,
  everyMs = 700,
  now = () => Date.now(),
  schedule = (fn, ms) => setInterval(fn, ms),
  cancel = (id) => clearInterval(id),
}) {
  const windows = Math.max(1, Math.ceil((audioSeconds || windowSeconds) / windowSeconds));
  const span = (1 - start) / windows;            // how much of the bar one window is worth
  const ceiling = 0.92;                          // never reach the next boundary on a guess

  let real = 0;
  let shown = 0;
  let lastRealAt = now();
  let perWindowMs = (windowSeconds / guessRealtime) * 1000;
  let timer = null;
  let done = false;

  function show(value) {
    const next = Math.min(0.99, value);
    // Forward only, and not for changes too small to see.
    if (next > shown + 0.003) {
      shown = next;
      onChange(shown);
    }
  }

  /** Whisper's own report, already mapped to the overall fraction. */
  function report(value) {
    if (done) return;
    const at = now();
    if (value >= 1) {
      done = true;
      shown = 1;
      stop();
      onChange(1);
      return;
    }
    if (value > real) {
      if (real >= start) {
        // One or more windows finished since the last report: learn the pace.
        const finished = (value - real) / span;
        if (finished >= 0.5) perWindowMs = 0.5 * perWindowMs + 0.5 * ((at - lastRealAt) / finished);
      }
      real = value;
      lastRealAt = at;
    }
    show(real);
  }

  /** Move the estimate forward by however long it has been since the last report. */
  function tick() {
    if (done || real < start) return;
    const within = Math.min(ceiling, (now() - lastRealAt) / perWindowMs);
    show(real + span * within);
  }

  function begin() {
    if (timer == null) timer = schedule(tick, everyMs);
  }

  function stop() {
    if (timer != null) cancel(timer);
    timer = null;
  }

  return { report, tick, begin, stop, get shown() { return shown; }, windows };
}
