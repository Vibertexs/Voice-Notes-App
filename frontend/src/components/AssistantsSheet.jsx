import { useCallback, useEffect, useState } from 'react';
import VFBottomSheet from './VFBottomSheet';
import VFButton from './VFButton';
import { accountApi } from '../lib/api';

/**
 * The assistants allowed to read your lectures.
 *
 * Two ways in. The usual one: add Ekho as a connector in Claude or ChatGPT with
 * the address below and sign in when it asks; the assistant then appears here as
 * "Signed in" and can be disconnected. The manual one, for tools that cannot sign
 * in: make a token here and paste it with the address. Either way the assistant can
 * only read - search, list, fetch transcripts - never change or delete. A token is
 * shown once, when it is made, because only a hash of it is kept, like a password.
 *
 * What an assistant reads leaves the app's own backup and goes to that
 * assistant's company. The sheet says so plainly rather than burying it.
 */
function ago(iso) {
  if (!iso) return 'never used';
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 90) return 'used just now';
  if (seconds < 3600) return `used ${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `used ${Math.round(seconds / 3600)} h ago`;
  return `used ${new Date(iso).toLocaleDateString()}`;
}

export default function AssistantsSheet({ open, onClose, serverUrl, notify }) {
  const [assistants, setAssistants] = useState(null);   // signed-in connections, then tokens
  const [name, setName] = useState('Claude');
  const [fresh, setFresh] = useState(null);       // the token just made, shown once
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [tokens, connections] = await Promise.all([
        accountApi.tokens(),
        accountApi.connections().catch(() => []),     // an older server has no such route
      ]);
      setAssistants([
        ...connections.map((item) => ({ ...item, kind: 'connection' })),
        ...tokens.map((item) => ({ ...item, kind: 'token' })),
      ]);
    } catch (caught) { setError(caught.message); setAssistants([]); }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(''); setFresh(null); setAssistants(null);
    load();
  }, [open, load]);

  async function create() {
    setBusy(true); setError('');
    try {
      const made = await accountApi.createToken(name.trim() || 'Assistant');
      setFresh(made);
      load();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }

  async function remove(item) {
    try {
      if (item.kind === 'connection') await accountApi.disconnect(item.id);
      else await accountApi.revokeToken(item.id);
      notify?.(`“${item.name}” can no longer read your lectures.`);
      load();
    } catch (caught) { setError(caught.message); }
  }

  async function copy(value, what) {
    try {
      await navigator.clipboard.writeText(value);
      notify?.(`${what} copied`);
    } catch {
      // A WebView without clipboard access: the field is selected, so a long press copies.
      notify?.('Press and hold the text to copy it.', 'info');
    }
  }

  const address = `${serverUrl}/mcp`;

  if (fresh) {
    return (
      <VFBottomSheet open={open} title="Your assistant token"
        subtitle="Copy it now. For your safety it is shown only once." onClose={onClose}>
        <label className="assist-label" htmlFor="assist-token">Token</label>
        <input id="assist-token" className="sheet-input assist-secret" readOnly value={fresh.token}
          onFocus={(event) => event.target.select()} />
        <VFButton label="Copy token" onPress={() => copy(fresh.token, 'Token')} />
        <label className="assist-label" htmlFor="assist-url">Server address</label>
        <input id="assist-url" className="sheet-input assist-secret" readOnly value={address}
          onFocus={(event) => event.target.select()} />
        <VFButton label="Copy address" variant="secondary" onPress={() => copy(address, 'Address')} />
        <VFButton label="Done" variant="ghost" onPress={() => setFresh(null)} />
      </VFBottomSheet>
    );
  }

  return (
    <VFBottomSheet open={open} title="Assistants"
      subtitle="Let an AI assistant read your lectures. It can search and read them, never change or delete them."
      onClose={onClose}>
      {assistants?.length > 0 && (
        <ul className="assist-list">
          {assistants.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="assist-row">
              <span className="assist-copy">
                <strong>{item.name}</strong>
                <small>{item.kind === 'connection' ? 'Signed in · ' : ''}{ago(item.lastUsedAt)}</small>
              </span>
              <button type="button" className="assist-remove" onClick={() => remove(item)}>
                {item.kind === 'connection' ? 'Disconnect' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="assist-label" htmlFor="assist-address">Connector address</label>
      <input id="assist-address" className="sheet-input assist-secret" readOnly value={address}
        onFocus={(event) => event.target.select()} />
      <VFButton label="Copy address" variant="secondary" onPress={() => copy(address, 'Address')} />
      <p className="sheet-note account-note">
        In Claude or ChatGPT, add a custom connector with this address and sign in when asked.
        If a tool can’t sign in, make an access token instead.
      </p>
      <input className="sheet-input" aria-label="Assistant name" placeholder="Name, e.g. Claude" maxLength={60}
        value={name} onChange={(event) => setName(event.target.value)} />
      {error && <p className="account-error" role="alert">{error}</p>}
      <VFButton label={busy ? 'One moment…' : 'Create access token'} disabled={busy || !name.trim()} onPress={create} />
      <p className="sheet-note account-note">
        What an assistant reads is sent to that assistant’s company. Only connect ones you trust,
        and remove one here whenever you like.
      </p>
    </VFBottomSheet>
  );
}
