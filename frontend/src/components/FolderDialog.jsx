import { useId, useState } from 'react';

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
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="modal" aria-labelledby="folder-dialog-title" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><h2 id="folder-dialog-title">{parent ? 'New folder' : 'New class'}</h2><button className="icon-button" type="button" onClick={onClose} aria-label="Close">×</button></div>
        {parent && <p className="muted">Inside {parent.name}</p>}
        <label htmlFor={nameId}>{parent ? 'Folder name' : 'Class name'}</label>
        <input id={nameId} autoFocus value={name} maxLength="120" onChange={(event) => setName(event.target.value)} placeholder="e.g. Biology 101" />
        <fieldset className="color-field"><legend>Color</legend><div className="color-options">
          {COLORS.map((option) => <button key={option} type="button" className={`color-option ${option} ${color === option ? 'selected' : ''}`} onClick={() => setColor(option)} aria-label={`${option} folder color`} aria-pressed={color === option} />)}
        </div></fieldset>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" className="button ghost" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving}>{saving ? 'Creating…' : 'Create folder'}</button></div>
      </form>
    </div>
  );
}
