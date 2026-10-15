/**
 * Google sign-in, from native code.
 *
 * The library is a native module, so a binary built before it was added has no
 * Google support at all. Importing it eagerly would take the whole app down on
 * such a build (the same trap whisper.rn is loaded lazily to avoid), so it is
 * only reached for when the user asks, and its absence just means the page
 * does not offer the button.
 *
 * What this hands the server is an ID token, not an account: Google signs a
 * statement of who the user is, addressed to our Web client id, and the server
 * verifies it (backend/cloud/google.py). The Android client id never appears
 * here; Google matches it to this app by package name and signing key.
 */

import { TurboModuleRegistry } from 'react-native';

/** Public by design - a client id identifies the app, it does not authorise anything. */
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  ?? '852372251285-68sveacic3pe2j7ak6lmublkb8q2qegb.apps.googleusercontent.com';

let library;

function load() {
  if (library !== undefined) return library;
  try {
    // Ask the binary first. A `require` whose module throws while loading does
    // not throw to the caller in React Native: it reports a fatal error, which
    // is a red screen in development and a crash in a release build. The
    // non-enforcing lookup just answers null when the module is not compiled in.
    if (!TurboModuleRegistry.get('RNGoogleSignin')) throw new Error('RNGoogleSignin is not in this binary');
    // eslint-disable-next-line global-require
    const loaded = require('@react-native-google-signin/google-signin');
    loaded.GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
    library = loaded;
  } catch {
    library = null;
  }
  return library;
}

const cancelled = () => Object.assign(new Error('Google sign-in was cancelled.'), { cancelled: true });

export const google = {
  available: () => Boolean(load()),

  async idToken() {
    const { GoogleSignin, statusCodes } = load();
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await GoogleSignin.signIn();
      if (result?.type === 'cancelled') throw cancelled();
      const token = result?.data?.idToken;
      if (!token) throw new Error('Google did not return an identity token. Try again.');
      return token;
    } catch (error) {
      if (error?.cancelled) throw error;
      if (error?.code === statusCodes?.SIGN_IN_CANCELLED) throw cancelled();
      if (error?.code === statusCodes?.IN_PROGRESS) throw new Error('Google sign-in is already open.');
      if (error?.code === statusCodes?.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error('Google Play services are missing or out of date on this phone.');
      }
      throw error;
    }
  },

  /** So the next sign-in offers the account picker instead of silently reusing one. */
  async signOut() {
    const loaded = load();
    if (loaded) await loaded.GoogleSignin.signOut();
  },
};
