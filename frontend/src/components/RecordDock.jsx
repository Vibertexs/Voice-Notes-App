import VFRecordButton from './VFRecordButton';
import { COPY } from '../lib/copy';

/**
 * The persistent record button, and the only thing allowed in that strip.
 *
 * Home, Folder and Organize all show it, always idle, always in the same
 * place - so the one thing the app is for never moves between screens. The
 * fade under it is what lets a list scroll past without colliding with it;
 * screens reserve `--record-space` at their bottom so nothing ends up hidden
 * behind it rather than under it.
 *
 * During a drag it is replaced, not covered: the same strip becomes the
 * drop-out zone, because that is where the thumb already is. A recording
 * that is already in Inbox has nowhere to be removed to, so it gets no zone.
 */
export default function RecordDock({ onPress, drag = null, dropOut = false, over = false }) {
  if (drag && dropOut) {
    return (
      <div className="record-dock" data-drop="__out">
        <div className={`drop-out${over ? ' is-over' : ''}`}>{COPY.dropOut}</div>
      </div>
    );
  }
  if (drag) return <div className="record-dock" aria-hidden="true" />;
  return (
    <div className="record-dock">
      <VFRecordButton state="idle" onPress={onPress} />
    </div>
  );
}
