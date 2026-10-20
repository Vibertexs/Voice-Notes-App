import VFRecordButton from './VFRecordButton';

/**
 * The persistent record button, and the only thing allowed in that strip.
 *
 * Home and Folder both show it, always idle, always in the same
 * place - so the one thing the app is for never moves between screens. The
 * fade under it is what lets a list scroll past without colliding with it;
 * screens reserve `--record-space` at their bottom so nothing ends up hidden
 * behind it rather than under it.
 *
 * During a drag it is emptied rather than covered, so a recording is never dropped on
 * the record button by accident. (Where a recording can be dropped is on the folder
 * cards on Home, or the "remove from folder" box at the top of an open folder.)
 */
export default function RecordDock({ onPress, drag = null }) {
  if (drag) return <div className="record-dock" aria-hidden="true" />;
  return (
    <div className="record-dock">
      <VFRecordButton state="idle" onPress={onPress} />
    </div>
  );
}
