import { Icon } from './Icon';

/** The small filled heart that says a recording is a favourite. It sits after the title wherever one is shown. */
export default function FavoriteMark({ className = '' }) {
  return (
    <span className={`fav-mark ${className}`} role="img" aria-label="Favourite">
      <Icon name="heartOn" strokeWidth={1.6} />
    </span>
  );
}
