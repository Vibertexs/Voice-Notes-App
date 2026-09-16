import { useId, useState } from 'react';
import { Icon } from './Icon';

const COLORS = ['blue', 'violet', 'rose', 'coral', 'amber', 'lime', 'mint', 'sky', 'slate'];

export default function FolderDialog({ parent, onClose, onCreate }) {
  const nameId = useId();
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onCreate({ name: name.trim(), color, parent_id: parent?.id ?? null });
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="scrim" role="presentation" onMouseDown={onClose}>
      <form
        className="modal"
        aria-labelledby="folder-dialog-title"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="folder-dialog-title">{parent ? 'New folder' : 'New class'}</h2>
          <button className="iconbtn" type="button" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        {parent && <p className="dim" style={{ marginBottom: '.8rem' }}>Inside {parent.name}</p>}

        <label className="field-label" htmlFor={nameId}>{parent ? 'Folder name' : 'Class name'}</label>
        <input
          id={nameId}
          className="field"
          autoFocus
          value={name}
          maxLength="120"
          placeholder="e.g. Biology 101"
          onChange={(event) => setName(event.target.value)}
        />

        <fieldset style={{ border: 0, padding: 0, margin: '1.1rem 0 0' }}>
          <legend className="field-label">Colour</legend>
          <div className="swatch-grid">
            {COLORS.map((option) => (
              <button
                key={option}
                type="button"
                className={`swatch-pick ${option} ${color === option ? 'on' : ''}`}
                onClick={() => setColor(option)}
                aria-label={`${option} colour`}
                aria-pressed={color === option}
              />
            ))}
          </div>
        </fieldset>

        {error && <p className="err" role="alert">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn quiet" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </div>
  );
}
