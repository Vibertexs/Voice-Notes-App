import { useState } from 'react';
import { FOLDER_COLORS } from './FolderCard';
import { FOLDER_ICONS, Icon } from './Icon';

/**
 * Making a folder.
 *
 * A full-screen sheet rather than a dialog, because a phone has no room for a
 * box floating over another box. Everything on it is optional except the name:
 * the preview shows what the card will look like as the colour and icon are
 * chosen, so the choice is made against the real thing.
 */
export default function FolderDialog({ parent, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('rose');
  const [icon, setIcon] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onCreate({ name: name.trim(), color, icon, parent_id: parent?.id ?? null });
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="scrim" role="presentation">
      <form className="create-screen" aria-labelledby="create-folder-title" onSubmit={submit} data-tone={color}>
        <header className="create-head">
          <button type="button" onClick={onClose}>Cancel</button>
          <h2 id="create-folder-title">New Folder</h2>
          <button type="submit" disabled={!name.trim() || saving}>{saving ? 'Creating…' : 'Create'}</button>
        </header>

        <div className="create-preview" aria-hidden="true">
          <Icon name={icon || 'folder'} />
        </div>

        {parent && <p className="create-parent">Inside {parent.name}</p>}

        <input
          className="create-name"
          autoFocus
          value={name}
          maxLength="120"
          placeholder="Physics 141"
          aria-label="Folder name"
          onChange={(event) => setName(event.target.value)}
        />

        <fieldset>
          <legend className="create-label">Colour</legend>
          <div className="swatch-row">
            {FOLDER_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                data-tone={option}
                className={`swatch ${color === option ? 'on' : ''}`}
                onClick={() => setColor(option)}
                aria-label={`${option} folder`}
                aria-pressed={color === option}
              />
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="create-label">Icon (Optional)</legend>
          <div className="icon-row">
            {FOLDER_ICONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`icon-pick ${icon === option ? 'on' : ''}`}
                onClick={() => setIcon(icon === option ? null : option)}
                aria-label={option}
                aria-pressed={icon === option}
              ><Icon name={option} /></button>
            ))}
          </div>
        </fieldset>

        {error && <p className="err" role="alert">{error}</p>}
      </form>
    </div>
  );
}
