/**
 * The recorder, loaded defensively.
 *
 * `expo-audio-studio` is a native module: its JavaScript exists in every
 * bundle, but the code it calls only exists in a binary that was compiled
 * after it was added to package.json. Importing it into a build that predates
 * it throws at module scope - before React renders anything - so the whole app
 * is a red error screen and nothing, not even the library, can be opened.
 *
 * Loading it through here turns that into a capability instead of a crash: the
 * app opens, the recordings you already have are readable, and the one thing
 * that genuinely needs the binary says so when you reach for it.
 *
 * `whisper.rn` is loaded the same way in onDeviceWhisper.js, for the same
 * reason.
 */

const REBUILD_HINT =
  'This build does not include the audio recorder. Rebuild the development '
  + 'client (npx eas-cli build --profile development) and install it again.';

let native = null;
let problem = '';

try {
  // The package calls requireNativeModule at module scope, so a binary without
  // the native side throws right here. That throw is the whole test: do not
  // also probe for a named method. Expo's native objects do not always expose
  // their methods the way a plain object does, and a probe that guesses wrong
  // would disable recording on a build that works perfectly well.
  const module = require('expo-audio-studio');
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
 * The real module when it is there; otherwise a stand-in whose every method
 * rejects with the reason. Calls fail one at a time and are reported back to
 * the page, rather than taking the process down at import.
 */
const missing = new Proxy({}, {
  get(_target, key) {
    if (key === 'addListener') return () => ({ remove() {} });
    return () => { throw new Error(RECORDER_PROBLEM); };
  },
});

export default native ?? missing;
