import { Icon } from './Icon';

/**
 * The only button in the app that carries a label.
 *
 * Four variants, and they are not interchangeable: `primary` is the one action
 * a screen is asking for and carries the red glow, `secondary` is the way back
 * out, `ghost` is a decline, and `danger` is destructive. A screen that needs
 * two primaries is a screen that has not decided what it is for.
 *
 * Reference: docs/design/voiceflow/VFButton.dc.html
 */
export default function VFButton({
  label, children, variant = 'primary', size = 'md', icon = 'none',
  full = true, disabled = false, onPress, type = 'button', className = '', ...rest
}) {
  return (
    <button
      type={type}
      className={`vf-btn vf-btn--${variant} vf-btn--${size}${full ? ' vf-btn--full' : ''} ${className}`}
      disabled={disabled}
      onClick={(event) => { event.stopPropagation(); onPress?.(event); }}
      {...rest}
    >
      {icon === 'plus' && <Icon name="plus" strokeWidth={2.6} />}
      {icon === 'check' && <Icon name="check" strokeWidth={2.6} />}
      {icon === 'play' && <Icon name="play" />}
      <span>{label ?? children}</span>
    </button>
  );
}
