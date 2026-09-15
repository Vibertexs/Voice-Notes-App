import { Platform } from 'react-native';
import {
  RecordingPresets, setAudioModeAsync, requestRecordingPermissionsAsync,
  requestNotificationPermissionsAsync,
} from 'expo-audio';

/**
 * Capture, with or without transcription.
 *
 * Two engines sit behind one interface:
 *
 *   speech  expo-speech-recognition drives the phone's own recogniser. It
 *           writes a 16kHz WAV while it listens, so one microphone session
 *           yields both the audio and the transcript.
 *   audio   expo-audio writes an m4a and nothing else.
 *
 * The split is forced by Android. Feeding a file to the recogniser needs
 * 16kHz mono linear PCM, and Android's MediaRecorder cannot produce WAV at
 * all - so transcribing after the fact is not an option there, and the
 * recogniser has to own the microphone from the start.
 *
 * expo-speech-recognition is a native module, so it does not exist in Expo Go.
 * That is why both engines are here rather than one: the app still records in
 * Expo Go, and a dev build is a straight upgrade rather than a prerequisite.
 */

let speech = null;
try {
  // eslint-disable-next-line global-require
  speech = require('expo-speech-recognition');
  if (!speech?.ExpoSpeechRecognitionModule?.start) speech = null;
} catch {
  speech = null; // Expo Go, or the module is not linked into this build.
}

export const TRANSCRIPTION_AVAILABLE = speech !== null;

/**
 * Pause has no meaning for the recogniser: ending a session closes the WAV it
 * is writing, and resuming opens a new one, which would fragment the audio.
 * The UI hides the control rather than offering one that silently does the
 * wrong thing.
 */
export const SUPPORTS_PAUSE = !TRANSCRIPTION_AVAILABLE;

const LOCALE = 'en-US';

/**
 * Whether the device can recognise offline, and how to get it there.
 *
 * Asking for on-device recognition without the language pack does not
 * degrade - Android fails the whole session with ERROR_CLIENT, whose own
 * documentation calls it "other client side errors". Nobody can act on that,
 * and nobody should have to go and install a language pack by hand either, so
 * the app fetches it.
 *
 * What it cannot do is promise when. Android 13 shows a system dialog and
 * tells us nothing more; Android 14+ may schedule the download for wifi. So
 * this is written to re-check cheaply and often, and the app upgrades itself
 * the moment the pack lands rather than asking the user to do anything.
 */
const onDevice = {
  supported: false,
  downloadRequested: false,
  status: 'unknown',
};

export const onDeviceStatus = () => ({ ...onDevice });

function recognitionOptions() {
  return {
    lang: LOCALE,
    interimResults: true,
    continuous: true,
    // Always on-device, never negotiable. A lecture is not something to hand
    // to a speech API, and Android rate-limits network recognition well below
    // lecture length anyway. When the offline model is missing we decline to
    // transcribe at all rather than quietly uploading instead - which is why
    // no session starts unless the model has been confirmed present.
    requiresOnDeviceRecognition: true,
    recordingOptions: { persist: true },
    // The waveform is fed from here while the recogniser owns the microphone.
    // expo-audio is not running in this mode, so its metering reports nothing
    // and the trace would sit flat.
    volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
  };
}

/** Cheap enough to call repeatedly: just asks which locales are installed. */
export async function refreshOnDeviceSupport() {
  if (!TRANSCRIPTION_AVAILABLE) {
    onDevice.status = 'unavailable';
    return false;
  }
  try {
    if (!speech.ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
      onDevice.supported = false;
      onDevice.status = 'unsupported';
      return false;
    }
    const locales = await speech.ExpoSpeechRecognitionModule
      .getSupportedLocales({}).catch(() => null);
    const installed = locales?.installedLocales ?? [];
    onDevice.supported = installed.some(
      (entry) => String(entry).toLowerCase().startsWith('en'),
    );
    if (onDevice.supported) onDevice.status = 'ready';
    else if (onDevice.status !== 'downloading' && onDevice.status !== 'scheduled') {
      onDevice.status = 'missing';
    }
    return onDevice.supported;
  } catch {
    onDevice.supported = false;
    onDevice.status = 'unsupported';
    return false;
  }
}

/**
 * Asks Android for the language pack. Requested once per launch: on 13 this
 * opens a dialog, and reopening it every time the app checks would be its own
 * kind of broken.
 */
export async function requestModelDownload() {
  if (!TRANSCRIPTION_AVAILABLE || onDevice.supported) return onDevice.status;
  // The download API landed in Android 13. Below that there is genuinely
  // nothing to call, and saying so beats failing quietly.
  if (Platform.OS === 'android' && Number(Platform.Version) < 33) {
    onDevice.status = 'too-old';
    return onDevice.status;
  }
  if (onDevice.downloadRequested) return onDevice.status;
  onDevice.downloadRequested = true;

  try {
    const result = await speech.ExpoSpeechRecognitionModule
      .androidTriggerOfflineModelDownload({ locale: LOCALE });
    if (result?.status === 'download_success') {
      onDevice.supported = true;
      onDevice.status = 'ready';
    } else if (result?.status === 'download_scheduled') {
      onDevice.status = 'scheduled';
    } else {
      onDevice.status = 'downloading';  // opened_dialog, Android 13
    }
  } catch {
    onDevice.status = 'unsupported';
  }
  return onDevice.status;
}

/** Check, and start a download if the pack is absent. */
export async function ensureOnDeviceModel() {
  if (await refreshOnDeviceSupport()) return { supported: true, status: 'ready' };
  const status = await requestModelDownload();
  return { supported: onDevice.supported, status };
}

/** What to tell the user, for each state the model can be in. */
export function describeModelStatus(status) {
  switch (status) {
    case 'ready': return '';
    case 'downloading':
      return 'Android is installing the offline speech model. Recording works now, and transcripts start once it finishes.';
    case 'scheduled':
      return 'The offline speech model will download when you are on wifi. Recording works now; transcripts start once it arrives.';
    case 'missing':
      return 'The offline speech model has not arrived yet. Recording works now, and transcripts start once it does.';
    case 'too-old':
      return 'This phone is too old for offline speech recognition (Android 13 or newer is needed). Recording and notes still work.';
    case 'unsupported':
      return 'This phone does not offer offline speech recognition. Recording and notes still work.';
    default:
      return 'Transcription is unavailable on this device. Recording and notes still work.';
  }
}

// --- permissions -----------------------------------------------------------

export async function requestPermissions() {
  const mic = await requestRecordingPermissionsAsync();
  if (!mic.granted) return { ok: false, reason: 'microphone' };

  let background = true;
  if (Platform.OS === 'android') {
    // Background capture runs as a foreground service, and a foreground
    // service must post a notification.
    try {
      const notify = await requestNotificationPermissionsAsync();
      background = notify.granted;
    } catch {
      background = false;
    }
  }

  if (TRANSCRIPTION_AVAILABLE) {
    const recognizer = await speech.ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!recognizer.granted) {
      // Recording still works; only the transcript is lost.
      return { ok: true, background, transcription: false, reason: 'recognizer' };
    }
    // Settle on-device support before the first session, so a missing language
    // pack is a message about a language pack rather than ERROR_CLIENT.
    const model = await ensureOnDeviceModel();
    if (!model.supported) {
      return { ok: true, background, transcription: false, reason: model.status };
    }
  }
  return { ok: true, background, transcription: TRANSCRIPTION_AVAILABLE };
}

/**
 * Puts the audio session into recording mode for expo-audio.
 *
 * Only for the expo-audio engine. The recogniser opens the microphone itself,
 * and claiming the session here first is enough to stop it: Android hands back
 * ERROR_CLIENT, or worse, a session that runs and hears nothing. Two engines,
 * one microphone - whichever is going to record has to be the one that asks
 * for it.
 */
export async function configureAudio(background) {
  await setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: true,
    allowsBackgroundRecording: background,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  });
}

/**
 * Releases the recording session so the recogniser can take the microphone.
 * Playback still works; only the capture claim is dropped.
 */
export async function releaseAudioSession() {
  await setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: false,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  });
}

export const RECORDING_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

/**
 * Android reports most setup problems as one generic client error, whose own
 * documentation reads "other client side errors". Recognising the cases that
 * actually happen is the difference between a user knowing what to do and
 * staring at that sentence.
 */
export function explainRecognitionError(event) {
  const code = event?.error ?? '';
  if (code === 'client' || code === 5) {
    return onDevice.supported
      ? 'The recogniser could not start, usually because something else holds the microphone. Recording is unaffected. (client)'
      : 'Offline speech recognition is not set up yet. Recording is unaffected. (client)';
  }
  if (code === 'language-not-supported' || code === 'language-unavailable') {
    return 'English is not installed for offline recognition. Add it in Android speech settings.';
  }
  if (code === 'service-not-allowed' || code === 'insufficient-permissions') {
    return 'The recogniser was denied permission. Recording still works.';
  }
  if (code === 'busy' || code === 'recognizer-busy') {
    return 'Another app is using speech recognition. Close it and try again.';
  }
  if (code === 'network' || code === 'network-timeout') {
    return 'Speech recognition tried to use the network and could not reach it.';
  }
  return `${event?.message || 'Speech recognition failed'} (${code})`;
}

// --- the speech engine -----------------------------------------------------

/**
 * Wraps the recogniser as a session. The transcript is assembled from final
 * results only; interim text is reported separately so the page can show it
 * without it ever being committed twice.
 */
export function startSpeechSession({ onTranscript, onError, onLevel }) {
  const finals = [];
  // Each final result is stamped with when it arrived, so the transcript panel
  // can offer tap-to-seek. The recogniser reports no timings of its own, and
  // arrival time is close enough to be useful for jumping around a lecture.
  const segments = [];
  const startedAt = Date.now();
  let interim = '';
  let audioUri = null;
  let ended = false;

  const subscriptions = [];
  const on = (event, handler) => {
    subscriptions.push(speech.ExpoSpeechRecognitionModule.addListener(event, handler));
  };

  on('result', (event) => {
    const best = event?.results?.[0]?.transcript ?? '';
    if (event?.isFinal) {
      if (best.trim()) {
        finals.push(best.trim());
        segments.push({
          start_seconds: Math.max(0, (Date.now() - startedAt) / 1000),
          text: best.trim(),
        });
      }
      interim = '';
    } else {
      interim = best;
    }
    onTranscript?.({ text: finals.join(' '), interim });
  });

  // Reported between -2 and 10, with anything below zero inaudible. The page
  // wants 0..1, and the shell's own metering maps to the same range.
  on('volumechange', (event) => {
    const raw = Number(event?.value);
    if (!Number.isFinite(raw)) return;
    onLevel?.(Math.max(0, Math.min(1, raw / 10)));
  });

  on('audiostart', (event) => { audioUri = event?.uri ?? audioUri; });
  on('audioend', (event) => { audioUri = event?.uri ?? audioUri; });
  on('error', (event) => {
    // 'no-speech' fires routinely during a quiet stretch of a lecture and is
    // not a failure; continuous mode restarts on its own.
    if (event?.error === 'no-speech') return;
    onError?.(explainRecognitionError(event));
  });
  on('end', () => { ended = true; });

  speech.ExpoSpeechRecognitionModule.start(recognitionOptions());

  return {
    get transcript() { return finals.join(' '); },
    get segments() { return segments.slice(); },
    get uri() { return audioUri; },
    get ended() { return ended; },
    stop() {
      speech.ExpoSpeechRecognitionModule.stop();
    },
    abort() {
      try { speech.ExpoSpeechRecognitionModule.abort(); } catch { /* already stopped */ }
      subscriptions.forEach((subscription) => subscription?.remove?.());
    },
    release() {
      subscriptions.forEach((subscription) => subscription?.remove?.());
    },
    /** Resolves once the recogniser has closed the WAV it was writing. */
    waitForAudio(timeoutMs = 8000) {
      const startedAt = Date.now();
      return new Promise((resolve) => {
        const poll = () => {
          if (ended && audioUri) return resolve(audioUri);
          if (Date.now() - startedAt > timeoutMs) return resolve(audioUri);
          return setTimeout(poll, 100);
        };
        poll();
      });
    },
  };
}

/**
 * Re-runs the recogniser over a file already on disk. Only useful for audio
 * the recogniser itself wrote, since that is the one format Android accepts.
 */
export function transcribeFile(uri, { onTranscript, onDone, onError }) {
  const finals = [];
  const subscriptions = [];
  const on = (event, handler) => {
    subscriptions.push(speech.ExpoSpeechRecognitionModule.addListener(event, handler));
  };
  const cleanup = () => subscriptions.forEach((subscription) => subscription?.remove?.());

  on('result', (event) => {
    const best = event?.results?.[0]?.transcript ?? '';
    if (event?.isFinal && best.trim()) {
      finals.push(best.trim());
      onTranscript?.(finals.join(' '));
    }
  });
  on('error', (event) => {
    if (event?.error === 'no-speech') return;
    cleanup();
    onError?.(event?.message || event?.error || 'Could not transcribe that recording');
  });
  on('end', () => { cleanup(); onDone?.(finals.join(' ')); });

  speech.ExpoSpeechRecognitionModule.start({
    ...recognitionOptions(),
    recordingOptions: undefined,
    audioSource: {
      uri,
      audioChannels: 1,
      sampleRate: 16000,
      // Give the recogniser room between chunks; the default is tuned for
      // live audio, not a file being read as fast as the disk allows.
      chunkDelayMillis: 50,
    },
  });

  return () => { cleanup(); try { speech.ExpoSpeechRecognitionModule.abort(); } catch { /* done */ } };
}
