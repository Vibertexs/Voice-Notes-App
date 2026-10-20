import { useState } from 'react';
import VFButton from '../components/VFButton';
import { Icon } from '../components/Icon';
import { accountApi } from '../lib/api';

/**
 * The first thing a signed-out person sees, and the only thing until they sign in.
 *
 * It is shown only where Google sign-in exists (see App.jsx), so it can never
 * be a dead end: a build without it opens straight into the app. Recording,
 * transcribing and everything already on the phone stay on the phone; the
 * account is what backs the library up and what lets an assistant read it.
 */
export default function SignInGate({ onSignedIn }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function signIn() {
    setBusy(true);
    setError('');
    try {
      const next = await accountApi.google();
      // Backing out of Google's account picker is a status, not a failure.
      if (next?.signedIn) onSignedIn(next);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen onboard gate">
      <span className="onboard-mark"><Icon name="mic" strokeWidth={2} /></span>
      <h1>Ekho</h1>
      <p className="onboard-tagline">Record. Learn. Revisit.</p>
      <ul className="gate-points">
        <li>Transcripts are made on your phone.</li>
        <li>Your audio never leaves it.</li>
        <li>Your notes are backed up to your account.</li>
      </ul>
      <div className="onboard-actions">
        {error && <p className="account-error" role="alert">{error}</p>}
        <VFButton label={busy ? 'One moment…' : 'Continue with Google'} disabled={busy} onPress={signIn} />
        <p className="gate-note">Sign in to start. You only need the internet for this step.</p>
      </div>
    </main>
  );
}
