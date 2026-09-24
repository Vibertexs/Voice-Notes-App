import { memo, useEffect, useRef } from 'react';

/**
 * The transcript, following playback the way lyrics do.
 *
 * Three things carry the position. The line being spoken is the one in focus
 * and everything else recedes; inside that line the words already spoken take
 * the accent, so the eye lands on the exact phrase rather than somewhere in a
 * paragraph; and the panel scrolls itself to keep that line near the middle.
 *
 * Word timing is measured where the recogniser provides it: Whisper is asked
 * for per-word times, so a word lights at the moment it is spoken. Transcripts
 * recorded before that existed carry no word times, and fall back to spreading
 * the words evenly across the line - readable, but it drifts inside a long one.
 *
 * Auto-scroll stops as soon as the reader scrolls by hand, because dragging
 * someone back to the playhead while they are reading ahead is worse than not
 * following at all. It resumes when playback moves to a new line.
 *
 * `term` is the in-transcript search: matches are marked in place rather than
 * pulled into a separate list, so a hit keeps the sentence it came from.
 *
 * There are no timestamps on the lines. This is for reading along while it
 * plays, and a column of numbers down the left is the one thing guaranteed to
 * pull the eye off the words. The time lives on the playhead, and the
 * bookmarks list is where you go to jump by time.
 */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Words and the whitespace between them, so the original spacing survives. */
const splitWords = (text) => String(text ?? '').split(/(\s+)/);

const escape = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Marks every occurrence of `term` without disturbing the text around it. */
function mark(text, term) {
  if (!term) return text;
  return String(text).split(new RegExp(`(${escape(term)})`, 'ig')).map((part, i) => (
    part.toLowerCase() === term.toLowerCase()
      ? <mark key={i}>{part}</mark>
      : <span key={i}>{part}</span>
  ));
}

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
 * Memoised, because playback moves the clock every frame. Only the line being
 * spoken depends on `seconds` - every other line is handed 0, so its props do
 * not change and React leaves it alone.
 */
const Line = memo(function Line({ segment, state, seconds, term, onSeek, innerRef }) {
  const at = segment.start_seconds ?? 0;

  const body = (() => {
    // A searched line is read, not followed, so the match wins over the word
    // lighting - two highlights on one line cancel each other out.
    if (term) return mark(segment.text, term);
    if (state !== 'active') return segment.text;

    // Measured timing when the transcript has it: each word lights when it is
    // actually spoken, which is the only way a line keeps up with a voice.
    const timed = segment.words;
    if (timed?.length) {
      return timed.map((word, position) => (
        <span key={position} className={`w ${(word.start ?? 0) <= seconds ? 'on' : ''}`}>
          {word.word}
        </span>
      ));
    }

    // Transcripts made before word timing existed: spread the words evenly and
    // accept the drift, rather than leaving the line unlit.
    const parts = splitWords(segment.text);
    const total = parts.filter((part) => part.trim()).length;
    const spoken = Math.round(progressThrough(segment, seconds) * total);
    let index = 0;
    return parts.map((part, position) => {
      if (!part.trim()) return part;
      index += 1;
      return <span key={position} className={`w ${index <= spoken ? 'on' : ''}`}>{part}</span>;
    });
  })();

  return (
    <button
      ref={innerRef}
      type="button"
      className={`lyric is-${state}`}
      aria-current={state === 'active' ? 'true' : undefined}
      onClick={() => onSeek?.(at)}
    >
      {body}
    </button>
  );
});

export default function SyncedTranscript({
  segments, currentSeconds, onSeek, status, term = '', markers = [],
}) {
  const listRef = useRef(null);
  const activeRef = useRef(null);
  const userScrolled = useRef(false);
  const lastIndex = useRef(-1);

  const shown = term
    ? segments.filter((segment) => String(segment.text ?? '').toLowerCase().includes(term.toLowerCase()))
    : segments;

  const activeIndex = (() => {
    if (!segments?.length) return -1;
    let index = -1;
    for (let i = 0; i < segments.length; i += 1) {
      if ((segments[i].start_seconds ?? 0) <= (currentSeconds ?? 0)) index = i;
      else break;
    }
    // At the very beginning of a recording the first segment can start a
    // fraction of a second after zero. Treat it as current so playback never
    // opens on an all-faded transcript.
    return index < 0 ? 0 : index;
  })();

  // A new line means playback moved on, which is a good moment to take the view
  // back - but only if the reader has not taken it somewhere themselves.
  useEffect(() => {
    if (term) return;                       // searching is reading, not following
    if (activeIndex !== lastIndex.current) {
      lastIndex.current = activeIndex;
      userScrolled.current = false;
    }
    if (userScrolled.current || !activeRef.current) return;
    activeRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex, term]);

  if (!segments?.length) {
    return (
      <p className="transcript-note">
        {['ready', 'complete'].includes(status) ? 'No speech was recognised in this recording.'
          : status === 'unavailable' ? 'This recording has no transcript.'
            : 'Transcribing…'}
      </p>
    );
  }

  if (term && !shown.length) {
    return <p className="transcript-note">Nothing matches “{term}”.</p>;
  }

  return (
    <div
      className="lyrics"
      ref={listRef}
      onWheel={() => { userScrolled.current = true; }}
      onTouchMove={() => { userScrolled.current = true; }}
    >
      {shown.map((segment, index) => {
        const real = term ? segments.indexOf(segment) : index;
        const state = real === activeIndex ? 'active' : real < activeIndex ? 'past' : 'future';
        const bookmark = markers.find((marker) => (
          Math.abs((marker.time_seconds ?? 0) - (segment.start_seconds ?? 0)) < 6
        ));
        return (
          <div key={`${segment.start_seconds}-${real}`} className="lyric-wrap">
            {bookmark && (
              <span className="lyric-bookmark">
                <b>{bookmark.label}</b>
              </span>
            )}
            <Line
              segment={segment}
              seconds={real === activeIndex ? (currentSeconds ?? 0) : 0}
              state={state}
              term={term}
              innerRef={real === activeIndex && !term ? activeRef : null}
              onSeek={onSeek}
            />
          </div>
        );
      })}
    </div>
  );
}
