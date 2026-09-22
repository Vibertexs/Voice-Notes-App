import { memo, useEffect, useRef } from 'react';

/**
 * The transcript, following playback the way lyrics do.
 *
 * Three things carry the position. The line being spoken is the one in
 * focus and everything else recedes; inside that line the words already
 * spoken take the accent, so the eye lands on the exact phrase rather than
 * somewhere in a paragraph; and the panel scrolls itself to keep that line
 * near the middle.
 *
 * Word timing is measured where the recogniser provides it: Whisper is asked
 * for per-word times, so a word lights at the moment it is spoken. Transcripts
 * recorded before that existed carry no word times, and fall back to spreading
 * the words evenly across the line - readable, but it drifts inside a long one.
 *
 * Auto-scroll stops as soon as the reader scrolls by hand, because dragging
 * someone back to the playhead while they are reading ahead is worse than not
 * following at all. It resumes when playback moves to a new line.
 */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Words and the whitespace between them, so the original spacing survives. */
const splitWords = (text) => String(text ?? '').split(/(\s+)/);

/**
 * How far through a segment the playhead is, 0 to 1.
 *
 * A segment with no usable end falls back to reading speed, which is the same
 * assumption the scrubber makes when it sizes a segment's bars.
 */
function progressThrough(segment, seconds) {
  const start = segment.start_seconds ?? 0;
  const end = segment.end_seconds ?? 0;
  const words = splitWords(segment.text).filter((part) => part.trim()).length;
  const span = end > start ? end - start : Math.max(0.6, words * 0.4);
  return clamp((seconds - start) / span, 0, 1);
}

/**
 * Memoised, because playback now moves the clock every frame. Only the line
 * being spoken depends on `seconds` - every other line is handed 0, so its
 * props do not change and React leaves it alone.
 */
const Line = memo(function Line({ segment, state, seconds, onSeek, innerRef }) {
  const common = {
    ref: innerRef,
    className: `line ${state}`,
    onClick: () => onSeek?.(segment.start_seconds ?? 0),
    'aria-current': state === 'active' ? 'true' : undefined,
  };

  if (state !== 'active') return <button {...common}>{segment.text}</button>;

  // Measured timing when the transcript has it: each word lights when it is
  // actually spoken, which is the only way the line can keep up with a voice.
  const timed = segment.words;
  if (timed?.length) {
    return (
      <button {...common}>
        {timed.map((word, position) => (
          <span key={position} className={`w ${(word.start ?? 0) <= seconds ? 'on' : ''}`}>
            {word.word}
          </span>
        ))}
      </button>
    );
  }

  // Transcripts made before word timing existed: spread the words evenly and
  // accept the drift, rather than leaving the line unlit.
  const parts = splitWords(segment.text);
  const total = parts.filter((part) => part.trim()).length;
  const spoken = Math.round(progressThrough(segment, seconds) * total);
  let index = 0;

  return (
    <button {...common}>
      {parts.map((part, position) => {
        if (!part.trim()) return part;
        index += 1;
        return (
          <span key={position} className={`w ${index <= spoken ? 'on' : ''}`}>{part}</span>
        );
      })}
    </button>
  );
});

export default function SyncedTranscript({ segments, currentSeconds, onSeek, status }) {
  const listRef = useRef(null);
  const activeRef = useRef(null);
  const userScrolledRef = useRef(false);
  const lastIndexRef = useRef(-1);

  const activeIndex = (() => {
    if (!segments?.length) return -1;
    let index = -1;
    for (let i = 0; i < segments.length; i++) {
      if ((segments[i].start_seconds ?? 0) <= (currentSeconds ?? 0)) index = i;
      else break;
    }
    // At the very beginning of a recording the first segment can start a
    // fraction of a second after zero. Treat it as current so playback never
    // opens on an all-faded transcript.
    return index < 0 ? 0 : index;
  })();

  // A new line means playback moved on, which is a good moment to take the
  // view back - but only if the reader has not taken it somewhere themselves.
  useEffect(() => {
    if (activeIndex !== lastIndexRef.current) {
      lastIndexRef.current = activeIndex;
      userScrolledRef.current = false;
    }
    if (userScrolledRef.current || !activeRef.current || !listRef.current) return;
    const list = listRef.current;
    const line = activeRef.current;
    const target = line.offsetTop - list.clientHeight / 2 + line.clientHeight / 2;
    list.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [activeIndex]);

  if (!segments?.length) {
    return (
      <p className="transcript-empty">
        {['ready', 'complete'].includes(status) ? 'No speech was recognised in this recording.'
          : status === 'unavailable' ? 'This recording has no transcript.'
            : 'Transcribing…'}
      </p>
    );
  }

  return (
    <div
      className="transcript"
      ref={listRef}
      onWheel={() => { userScrolledRef.current = true; }}
      onTouchMove={() => { userScrolledRef.current = true; }}
    >
      {segments.map((segment, index) => (
        <Line
          key={`${segment.start_seconds}-${index}`}
          segment={segment}
          seconds={index === activeIndex ? (currentSeconds ?? 0) : 0}
          state={index === activeIndex ? 'active' : index < activeIndex ? 'past' : 'future'}
          innerRef={index === activeIndex ? activeRef : null}
          onSeek={onSeek}
        />
      ))}
    </div>
  );
}
