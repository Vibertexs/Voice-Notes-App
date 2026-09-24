import { Icon } from './Icon';

export const FOLDER_COLORS = ['red', 'blue', 'violet', 'amber', 'green', 'graphite'];

function countLabel(count, meta) {
  if (meta) return meta;
  if (!count) return 'Empty';
  return count === 1 ? '1 recording' : `${count} recordings`;
}

/**
 * A folder, in the four shapes the app has for one.
 *
 * The card carries no recording imagery - no waveform, no play button, no
 * preview of what is inside. A folder is a place, and the things in it are one
 * tap away; putting a trace on the card made every folder look like a
 * recording. The colour arrives as a corner glow and a hairline ring rather
 * than a fill, which is what lets six of them sit together without the screen
 * turning into a paint chart. Only the icon tile is fully saturated.
 *
 * All four layouts are the same object at different sizes:
 *   hero   the first pinned folder, full width
 *   tile   the rest of the pinned folders, two up
 *   row    everything below the fold
 *   target a drop zone while a recording is being dragged
 *
 * `active` means something is hovering over this target, not that it is
 * selected - it lifts, rings and brightens its meta line.
 *
 * Reference: docs/design/voiceflow/VFFolderCard.dc.html
 */
export default function VFFolderCard({
  title = 'Folder', count = 0, meta, color = 'red', layout = 'hero',
  active = false, disabled = false, onPress, onMore, dropId,
}) {
  const label = countLabel(count, meta);
  const interactive = layout !== 'target';
  const Root = interactive ? 'button' : 'div';

  return (
    <Root
      type={interactive ? 'button' : undefined}
      className={`vf-card vf-card--${layout}${active ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}
      data-tone={color}
      data-drop={dropId}
      disabled={interactive && disabled ? true : undefined}
      onClick={interactive ? () => onPress?.() : undefined}
    >
      <span className="vf-card-top">
        <span className="vf-card-icon"><Icon name="folderSolid" /></span>
        {onMore && layout !== 'target' && (
          <span
            role="button"
            tabIndex={0}
            className="vf-card-more"
            aria-label={`Options for ${title}`}
            onClick={(event) => { event.stopPropagation(); onMore(); }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); onMore(); } }}
          ><i /><i /><i /></span>
        )}
      </span>
      <span className="vf-card-copy">
        <strong>{title}</strong>
        <small>{label}</small>
      </span>
      {layout === 'row' && <Icon name="chev" strokeWidth={2.4} className="vf-card-chev" />}
    </Root>
  );
}
