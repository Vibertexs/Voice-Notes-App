import { Icon } from './Icon';
import { IconButton } from './ui';

export const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

/**
 * The transport, in the order the eye reads it.
 *
 * Speed and bookmark sit at the edges and stay quiet; play is the only filled
 * control. The skips are fifteen seconds because that is what a sentence you
 * missed is worth, and the same row appears under every recording.
 */
export default function PlaybackControls({
  playing, speed, onSpeed, onBack15, onToggle, onForward15, onBookmark, bookmarked = false,
}) {
  return (
    <div className="play-controls">
      <button type="button" className="icon-btn speed" onClick={onSpeed} aria-label={`Playback speed, ${speed} times`}>
        {speed}×
      </button>
      <IconButton name="back15" label="Back 15 seconds" onClick={onBack15} />
      <button type="button" className="play-btn" onClick={onToggle} aria-label={playing ? 'Pause' : 'Play'}>
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <IconButton name="fwd15" label="Forward 15 seconds" onClick={onForward15} />
      <IconButton
        name={bookmarked ? 'bookmarkOn' : 'bookmark'}
        label="Mark this moment"
        variant={bookmarked ? 'on' : ''}
        onClick={onBookmark}
      />
    </div>
  );
}
