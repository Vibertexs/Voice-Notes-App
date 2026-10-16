import { useCallback, useEffect, useState } from 'react';
import VFBottomSheet from './VFBottomSheet';
import VFButton from './VFButton';
import { accountApi } from '../lib/api';

/**
 * The assistants allowed to read your lectures.
 *
 * Connecting one means making a token here and pasting it, with the server
 * address, into the assistant. The token can only read: search, list, and fetch
 * transcripts. It cannot change or delete anything, and it can be removed here
 * at any time. It is shown once, when it is made, because only a hash of it is
 * kept - exactly like a password.
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
  const [tokens, setTokens] = useState(null);
  const [name, setName] = useState('Claude');
  const [fresh, setFresh] = useState(null);       // the token just made, shown once
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setTokens(await accountApi.tokens()); }
    catch (caught) { setError(caught.message); setTokens([]); }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(''); setFresh(null); setTokens(null);
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

  async function remove(token) {
    try {
      await accountApi.revokeToken(token.id);
      notify?.(`“${token.name}” can no longer read your lectures.`);
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
      {tokens?.length > 0 && (
        <ul className="assist-list">
          {tokens.map((token) => (
            <li key={token.id} className="assist-row">
              <span className="assist-copy">
                <strong>{token.name}</strong>
                <small>{ago(token.lastUsedAt)}</small>
              </span>
              <button type="button" className="assist-remove" onClick={() => remove(token)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
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
