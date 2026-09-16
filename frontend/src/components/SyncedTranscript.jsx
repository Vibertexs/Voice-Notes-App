import { useEffect, useRef } from 'react';

/**
 * The transcript, following playback the way lyrics do.
 *
 * The line being spoken is the one in focus; everything else recedes. It
 * scrolls itself so the current line stays near the middle, and any line can
 * be tapped to jump there.
 *
 * Auto-scroll stops as soon as the reader scrolls by hand, because dragging
 * someone back to the playhead while they are reading ahead is worse than not
 * following at all. It resumes when playback moves to a new line.
 */
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
    return index;
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
      <p className="dim">
        {status === 'ready' ? 'No speech was recognised in this recording.' : 'Transcribing…'}
      </p>
    );
  }

  return (
    <div
      className="lines"
      ref={listRef}
      onWheel={() => { userScrolledRef.current = true; }}
      onTouchMove={() => { userScrolledRef.current = true; }}
    >
      {segments.map((segment, index) => {
        const state = index === activeIndex ? 'active'
          : index < activeIndex ? 'past' : 'future';
        return (
          <button
            key={`${segment.start_seconds}-${index}`}
            ref={index === activeIndex ? activeRef : null}
            className={`line ${state}`}
            onClick={() => onSeek?.(segment.start_seconds ?? 0)}
            aria-current={index === activeIndex ? 'true' : undefined}
          >
            {segment.text}
          </button>
        );
      })}
    </div>
  );
}
