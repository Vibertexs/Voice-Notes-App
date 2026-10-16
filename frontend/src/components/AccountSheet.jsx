import { useCallback, useEffect, useState } from 'react';
import VFBottomSheet from './VFBottomSheet';
import VFButton from './VFButton';
import { accountApi } from '../lib/api';

/**
 * The account, and what this phone does with your data.
 *
 * Signing in backs up titles, folders, bookmarks, notes and transcripts to
 * your account, so another phone (and, later, an assistant you connect) can
 * see them. Audio never goes. It happens by itself - when the app opens, a
 * few seconds after a change, and every few minutes - so there is no sync
 * button and no word "sync" on screen. Without an account nothing changes:
 * the app was built to work entirely on the phone, and still does.
 *
 * The sheet has to read sensibly in three builds: one with backup, one without
 * a server configured, and the desktop app, where /api/account does not exist.
 */
const PRIVACY = 'Your folders, titles, bookmarks, notes and transcripts are backed up to your account, '
  + 'so a new phone can bring them back. Audio never leaves the phone that recorded it.';
const TRANSCRIPTION = 'Transcripts are made on this phone by Whisper; your recordings are never sent to a server '
  + 'to be transcribed. The first one downloads the speech model, about 180 MB, once.';

/** One calm line. Backing up is automatic, so this only says what is happening. */
function statusLine(account) {
  if (account.lastError && !account.syncing) return account.lastError;
  if (account.syncing || account.pending) return 'Backing up…';
  return 'Your library is backed up';
}

const TITLES = {
  signin: ['Sign in', 'Keep your lectures on every phone you use.'],
  register: ['Create an account', 'Keep your lectures on every phone you use.'],
  forgot: ['Reset password', 'We’ll email you a six-digit code.'],
  reset: ['Enter your code', 'Check your email for the code, then choose a new password.'],
};

export default function AccountSheet({ open, onClose, notify }) {
  const [account, setAccount] = useState(null);
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setAccount(await accountApi.status()); }
    catch (caught) { setAccount(caught.status === 404 ? { unsupported: true } : { configured: false }); }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setError(''); setPassword(''); setCode(''); setEmailOpen(false);
    load();
    // The shell announces backup progress, so the status line moves on its own.
    const onStatus = (event) => { if (event.detail) setAccount(event.detail); };
    window.addEventListener('cn:account', onStatus);
    return () => window.removeEventListener('cn:account', onStatus);
  }, [open, load]);

  async function run(task) {
    setBusy(true); setError('');
    try { return await task(); }
    catch (caught) { setError(caught.message); return null; }
    finally { setBusy(false); }
  }

  const signedIn = (next, message) => {
    // Backing out of Google's account picker comes back as a status, not a sign-in.
    if (!next?.signedIn) return;
    setAccount(next); setPassword(''); setCode(''); setMode('signin');
    notify?.(message);
  };

  async function submit(event) {
    event.preventDefault();
    if (mode === 'signin') signedIn(await run(() => accountApi.login(email, password)), 'Signed in.');
    if (mode === 'register') signedIn(await run(() => accountApi.register(email, password)), 'Account created.');
    if (mode === 'reset') signedIn(await run(() => accountApi.reset(email, code, password)), 'Password changed. You’re signed in.');
    if (mode === 'forgot' && await run(() => accountApi.forgot(email))) setMode('reset');
  }

  async function withGoogle() {
    signedIn(await run(() => accountApi.google()), 'Signed in with Google.');
  }

  /* ---- what this build can do ------------------------------------------ */

  if (!account) return <VFBottomSheet open={open} title="Account" onClose={onClose} />;

  if (account.unsupported || !account.configured) {
    return (
      <VFBottomSheet open={open} title="Transcription" onClose={onClose}>
        {!account.unsupported && (
          <p className="sheet-note account-note">Backup isn’t set up in this build, so everything stays on this phone.</p>
        )}
        <p className="sheet-note account-note">{TRANSCRIPTION}</p>
        <VFButton label="Done" variant="secondary" onPress={onClose} />
      </VFBottomSheet>
    );
  }

  /* ---- signed in --------------------------------------------------------- */

  if (account.signedIn) {
    const who = account.user?.email ?? 'Signed in with Apple';
    if (mode === 'delete') {
      return (
        <VFBottomSheet open={open} icon="warn" title="Delete your account?"
          subtitle="Everything backed up to it is erased from the server. Recordings on this phone stay on this phone."
          onClose={() => setMode('signin')}
        >
          {account.user?.hasPassword !== false && (
            <input className="sheet-input" type="password" autoComplete="current-password"
              placeholder="Password" aria-label="Password" value={password}
              onChange={(event) => setPassword(event.target.value)} />
          )}
          {error && <p className="account-error" role="alert">{error}</p>}
          <VFButton label={busy ? 'Deleting…' : 'Delete account'} variant="danger" disabled={busy}
            onPress={async () => {
              const next = await run(() => accountApi.remove(password));
              if (next) { setAccount(next); setMode('signin'); setPassword(''); notify?.('Account deleted', 'error'); }
            }} />
          <VFButton label="Keep my account" variant="ghost" onPress={() => { setMode('signin'); setError(''); }} />
        </VFBottomSheet>
      );
    }
    return (
      <VFBottomSheet open={open} title="Account" onClose={onClose}>
        <div className="account-who">
          <span className="account-avatar" aria-hidden="true">{who.slice(0, 1).toUpperCase()}</span>
          <div className="account-id">
            <strong>{who}</strong>
            <span className={account.lastError && !account.syncing ? 'is-error' : ''}>{statusLine(account)}</span>
          </div>
        </div>
        {error && <p className="account-error" role="alert">{error}</p>}
        <VFButton label="Sign out" variant="ghost" disabled={busy}
          onPress={async () => {
            const next = await run(() => accountApi.logout());
            if (next) { setAccount(next); notify?.('Signed out. Your recordings are still on this phone.'); }
          }} />
        <p className="sheet-note account-note">{PRIVACY}</p>
        <p className="sheet-note account-note">{TRANSCRIPTION}</p>
        <VFButton label="Delete account" variant="danger" size="sm"
          onPress={() => { setMode('delete'); setPassword(''); setError(''); }} />
      </VFBottomSheet>
    );
  }

  /* ---- signed out -------------------------------------------------------- */

  const [title, subtitle] = TITLES[mode] ?? TITLES.signin;
  const needsPassword = mode !== 'forgot';
  const ready = email.trim() && (!needsPassword || password.length >= (mode === 'signin' ? 1 : 8))
    && (mode !== 'reset' || /^\d{6}$/.test(code.trim()));
  const action = {
    signin: 'Sign in', register: 'Create account', forgot: 'Send code', reset: 'Set password and sign in',
  }[mode];

  // Google leads when this build has it: the email form waits behind "Use email
  // instead" until asked for, or until the user is somewhere only email goes
  // (creating a password account, resetting one).
  const showEmail = !account.google || emailOpen || mode !== 'signin';

  return (
    <VFBottomSheet open={open} title={title} subtitle={subtitle} onClose={onClose}>
      {account.google && (mode === 'signin' || mode === 'register') && (
        <>
          <VFButton label={busy ? 'One moment…' : 'Continue with Google'}
            variant={showEmail ? 'secondary' : 'primary'} disabled={busy} onPress={withGoogle} />
          {showEmail && <p className="account-or" aria-hidden="true"><span>or use email</span></p>}
        </>
      )}
      {!showEmail && error && <p className="account-error" role="alert">{error}</p>}
      {!showEmail && (
        <VFButton label="Use email instead" variant="ghost" onPress={() => { setEmailOpen(true); setError(''); }} />
      )}
      {showEmail && (
        <form className="account-form" onSubmit={submit}>
          <input className="sheet-input" type="email" inputMode="email" autoComplete="email"
            autoCapitalize="none" placeholder="Email" aria-label="Email" value={email}
            readOnly={mode === 'reset'} onChange={(event) => setEmail(event.target.value)} />
          {mode === 'reset' && (
            <input className="sheet-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              placeholder="Six-digit code" aria-label="Code" value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
          )}
          {needsPassword && (
            <input className="sheet-input" type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signin' ? 'Password' : 'New password (8+ characters)'}
              aria-label="Password" value={password} onChange={(event) => setPassword(event.target.value)} />
          )}
          {error && <p className="account-error" role="alert">{error}</p>}
          <VFButton type="submit" label={busy ? 'One moment…' : action} disabled={busy || !ready} onPress={() => {}} />
        </form>
      )}

      {showEmail && mode === 'signin' && (
        <>
          <VFButton label="New here? Create an account" variant="ghost" onPress={() => { setMode('register'); setError(''); }} />
          <VFButton label="Forgot password?" variant="ghost" size="sm" onPress={() => { setMode('forgot'); setError(''); }} />
        </>
      )}
      {mode !== 'signin' && (
        <VFButton label="Back to sign in" variant="ghost" onPress={() => { setMode('signin'); setError(''); }} />
      )}
      <p className="sheet-note account-note">{PRIVACY}</p>
    </VFBottomSheet>
  );
}
