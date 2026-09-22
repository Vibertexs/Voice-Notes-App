import { NativeModules } from 'react-native';

/**
 * The recorder, loaded defensively.
 *
 * Recording needs native code, and native code only exists in a binary that
 * was compiled after the package was added. A build that predates it used to
 * throw at module scope - before React rendered anything - so one missing
 * module turned the whole app into an error screen, including the parts that
 * do not record at all.
 *
 * Loading it through here makes that a capability rather than a crash: the app
 * opens, recordings already on the phone are readable, and only the thing that
 * genuinely needs the binary says so when it is reached for.
 *
 * whisper.rn is loaded the same way in onDeviceWhisper.js, for the same reason.
 */

const REBUILD_HINT =
  'This build does not include the audio recorder. Rebuild the development '
  + 'client (npx eas-cli build --profile development) and install it again.';

let native = null;
let problem = '';

try {
  // The PCM stream is a plain React Native module, so its absence shows up as
  // a missing entry in NativeModules rather than as a throw. Check that first,
  // then load the recorder that builds on it.
  if (!NativeModules.RNLiveAudioStream) throw new Error('RNLiveAudioStream is not in this binary');
  // eslint-disable-next-line global-require
  const module = require('./pcmRecorder');
  native = module?.default ?? module;
  if (!native) problem = REBUILD_HINT;
} catch (error) {
  native = null;
  problem = `${REBUILD_HINT} (${error?.message ?? error})`;
}

/** Whether this binary can actually record. */
export const HAS_RECORDER = native !== null;

/** Why it cannot, in words a person can act on. Empty when it can. */
export const RECORDER_PROBLEM = problem;

/**
 * The real recorder when it is there; otherwise a stand-in whose every method
 * fails with the reason. Calls fail one at a time and are reported back to the
 * page, rather than taking the process down at import.
 */
const missing = new Proxy({}, {
  get(_target, key) {
    if (key === 'addListener') return () => ({ remove() {} });
    return () => { throw new Error(RECORDER_PROBLEM); };
  },
});

export default native ?? missing;
