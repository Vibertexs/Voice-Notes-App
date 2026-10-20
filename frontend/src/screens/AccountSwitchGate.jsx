import { useState } from 'react';
import VFButton from '../components/VFButton';
import { Icon } from '../components/Icon';
import { accountApi } from '../lib/api';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Shown when someone signs in on a phone that still holds another account's
 * recordings (see signedIn() in mobile/src/cloudSync.js). Nothing is uploaded and
 * nothing is deleted until they choose: adding those recordings to this account
 * would hand someone else's lectures to it, and deleting them loses their audio
 * for good, so neither is done by default. Like the sign-in gate, it is the only
 * thing on screen until it is answered.
 */
export default function AccountSwitchGate({ pending, email, onDone }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  async function answer(choice) {
    setBusy(choice); setError('');
    try {
      await accountApi.claim(choice);
      onDone();
    } catch (caught) {
      setError(caught.message);
      setBusy('');
    }
  }

  async function signOut() {
    setBusy('signout'); setError('');
    try { await accountApi.logout(); }
    catch (caught) { setError(caught.message); setBusy(''); }
  }

  const held = [
    pending.recordings > 0 && plural(pending.recordings, 'recording'),
    pending.folders > 0 && plural(pending.folders, 'folder'),
  ].filter(Boolean).join(' and ');

  return (
    <main className="screen onboard gate">
      <span className="onboard-mark"><Icon name="people" strokeWidth={2} /></span>
      <h1>Another account’s recordings</h1>
      <p className="onboard-tagline">
        This phone holds {held} from a different Ekho account{email ? `, not ${email}` : ''}.
        What should happen to them?
      </p>
      <div className="onboard-actions">
        {error && <p className="account-error" role="alert">{error}</p>}
        {confirming ? (
          <>
            <p className="gate-note">
              This deletes them and their audio from this phone for good. Their text stays in the other
              account’s backup. Audio is never backed up, so it cannot be recovered.
            </p>
            <VFButton label={busy === 'clear' ? 'Removing…' : 'Yes, remove them'} variant="danger"
              disabled={Boolean(busy)} onPress={() => answer('clear')} />
            <VFButton label="Go back" variant="ghost" disabled={Boolean(busy)} onPress={() => setConfirming(false)} />
          </>
        ) : (
          <>
            <VFButton label={busy === 'keep' ? 'One moment…' : 'Add them to this account'}
              disabled={Boolean(busy)} onPress={() => answer('keep')} />
            <p className="gate-note">They will be backed up to {email || 'this account'} and visible to it.</p>
            <VFButton label="Start fresh on this phone" variant="secondary" disabled={Boolean(busy)}
              onPress={() => setConfirming(true)} />
            <VFButton label="Sign out" variant="ghost" disabled={Boolean(busy)} onPress={signOut} />
          </>
        )}
      </div>
    </main>
  );
}
