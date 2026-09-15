import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/**
 * Where transcription happens.
 *
 * The app does not care what is behind the address - a laptop on a private
 * network today, a hosted service later - so this is one field rather than a
 * choice between named providers.
 */
export default function SettingsDialog({ onClose, notify }) {
  const [server, setServer] = useState('');
  const [onDevice, setOnDevice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/settings')
      .then((settings) => {
        setServer(settings.transcription_server ?? '');
        setOnDevice(Boolean(settings.transcription_on_device));
      })
      .catch((caught) => setError(caught.message))
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api('/api/settings', { method: 'PUT', body: { transcription_server: server } });
      notify?.('Settings saved.');
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop" onClick={onClose}>
    <div className="modal" onClick={(event) => event.stopPropagation()}>
      <div className="modal-header"><h2>Transcription</h2></div>

      {loading ? <p className="muted">Loading…</p> : <>
        <p className="muted settings-copy">
          {onDevice
            ? 'This device transcribes on its own. A server is optional, and gives better transcripts when it can be reached.'
            : 'This build cannot transcribe on its own. Point it at a server to get transcripts.'}
        </p>

        <label htmlFor="transcription-server">Server address</label>
        <input
          id="transcription-server"
          value={server}
          onChange={(event) => setServer(event.target.value)}
          placeholder="100.76.29.83:8000"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck="false"
        />
        <p className="settings-hint">
          Leave this empty to keep everything on the device. Recordings are never lost if the
          server cannot be reached — they are sent the next time it can.
        </p>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button className="button ghost" onClick={onClose}>Cancel</button>
          <button className="button primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </>}
    </div>
  </div>;
}
