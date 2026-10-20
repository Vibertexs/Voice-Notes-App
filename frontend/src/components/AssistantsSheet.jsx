import { useCallback, useEffect, useState } from 'react';
import VFBottomSheet from './VFBottomSheet';
import VFButton from './VFButton';
import { accountApi } from '../lib/api';

/**
 * The assistants allowed to read your lectures.
 *
 * Two ways in. The usual one needs no token: add Ekho as a connector in Claude or
 * ChatGPT with the address below and sign in when it asks; the assistant then appears
 * here as "Signed in" and can be disconnected. The manual one, for tools that cannot
 * sign in, is tucked behind "Use an access token instead": make a token and paste it
 * with the address. Either way the assistant can
 * only read - search, list, fetch transcripts - never change or delete. A token is
 * shown once, when it is made, because only a hash of it is kept, like a password.
 *
 * Most people have never added a "custom connector", so the sheet walks through it: copy the
 * address, then numbered steps for Claude and for ChatGPT, then a reminder to sign in with the
 * same Google account as Ekho (the email is shown), because a different account has no lectures
 * to read. The steps name the menus as they are at the time of writing; those change, so the
 * guide says what to look for as well as where.
 *
 * What an assistant reads leaves the app's own backup and goes to that
 * assistant's company. The sheet says so plainly rather than burying it.
 */
const GUIDES = {
  claude: {
    label: 'Claude',
    steps: [
      'On a computer, go to claude.ai and sign in.',
      'Open Settings, then Connectors.',
      'Choose “Add custom connector”.',
      'Name it Ekho, paste the address you copied, and click Add.',
      'Click Connect next to Ekho. An Ekho page opens: sign in with Google and approve.',
      'Start a chat, turn Ekho on from the tools menu, and ask something like “What did I learn about mitosis?”',
    ],
    note: 'Custom connectors may need a paid Claude plan.',
  },
  chatgpt: {
    label: 'ChatGPT',
    steps: [
      'On a computer, go to chatgpt.com and sign in.',
      'Open Settings, then Apps (or Connectors), then Advanced settings, and turn on Developer mode.',
      'Choose Create (or Add), name it Ekho and paste the address you copied.',
      'Set authentication to OAuth and create it. An Ekho page opens: sign in with Google and approve.',
      'In a new chat, add Ekho from the tools menu and ask about your lectures.',
    ],
    note: 'ChatGPT’s menus change often, and Developer mode needs a plan that includes it.',
  },
  other: {
    label: 'Other',
    steps: [
      'Look for “MCP”, “connector” or “tools” in the assistant’s settings.',
      'Add a remote (HTTP) server and paste the address you copied.',
      'When it asks you to sign in, use your Google account (see below).',
    ],
    note: 'If it can’t sign in, use an access token (below).',
  },
};

function ago(iso) {
  if (!iso) return 'never used';
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 90) return 'used just now';
  if (seconds < 3600) return `used ${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `used ${Math.round(seconds / 3600)} h ago`;
  return `used ${new Date(iso).toLocaleDateString()}`;
}

export default function AssistantsSheet({ open, onClose, serverUrl, notify, email = '' }) {
  const [assistants, setAssistants] = useState(null);   // signed-in connections, then tokens
  const [name, setName] = useState('Claude');
  const [fresh, setFresh] = useState(null);       // the token just made, shown once
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);   // the manual way, hidden until asked for
  const [guide, setGuide] = useState('claude');
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
    setError(''); setFresh(null); setAssistants(null); setShowToken(false);
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
      <label className="assist-label" htmlFor="assist-address">Step 1 · Copy your Ekho address</label>
      <input id="assist-address" className="sheet-input assist-secret" readOnly value={address}
        onFocus={(event) => event.target.select()} />
      <VFButton label="Copy address" variant="secondary" onPress={() => copy(address, 'Address')} />

      <p className="assist-label">Step 2 · Add it to your assistant</p>
      <div className="chips assist-tabs" role="tablist" aria-label="Assistant">
        {Object.entries(GUIDES).map(([key, item]) => (
          <button key={key} type="button" role="tab" aria-selected={guide === key}
            className={`chip${guide === key ? ' is-on' : ''}`} onClick={() => setGuide(key)}>{item.label}</button>
        ))}
      </div>
      <ol className="assist-steps">
        {GUIDES[guide].steps.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <p className="assist-fine">{GUIDES[guide].note}</p>

      <div className="assist-callout">
        <strong>Sign in with the same Google account</strong>
        <span>
          {email ? <>Use <b>{email}</b>, the account you use in Ekho. </> : 'Use the Google account you use in Ekho. '}
          A different account has no lectures for the assistant to read. No token is needed.
        </span>
      </div>
      {error && <p className="account-error" role="alert">{error}</p>}
      {showToken ? (
        <>
          <p className="sheet-note account-note">For a tool that can’t sign in, make a token and paste it with the address.</p>
          <input className="sheet-input" aria-label="Assistant name" placeholder="Name, e.g. Claude" maxLength={60}
            value={name} onChange={(event) => setName(event.target.value)} />
          <VFButton label={busy ? 'One moment…' : 'Create access token'} variant="secondary"
            disabled={busy || !name.trim()} onPress={create} />
        </>
      ) : (
        <button type="button" className="legal-inline assist-more" onClick={() => setShowToken(true)}>
          Use an access token instead
        </button>
      )}
      <p className="sheet-note account-note">
        What an assistant reads is sent to that assistant’s company. Only connect ones you trust,
        and remove one here whenever you like.
      </p>
    </VFBottomSheet>
  );
}
