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

const RECOGNITION_OPTIONS = {
  lang: 'en-US',
  interimResults: true,
  continuous: true,
  // Never send a lecture to a speech API over the network. It is also the only
  // way this works with the phone in a bag for fifty minutes.
  requiresOnDeviceRecognition: true,
  recordingOptions: { persist: true },
};

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
  }
  return { ok: true, background, transcription: TRANSCRIPTION_AVAILABLE };
}

export async function configureAudio(background) {
  await setAudioModeAsync({
    playsInSilentMode: true,
    allowsRecording: true,
    allowsBackgroundRecording: background,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  });
}

export const RECORDING_OPTIONS = { ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true };

// --- the speech engine -----------------------------------------------------

/**
 * Wraps the recogniser as a session. The transcript is assembled from final
 * results only; interim text is reported separately so the page can show it
 * without it ever being committed twice.
 */
export function startSpeechSession({ onTranscript, onError }) {
  const finals = [];
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
      if (best.trim()) finals.push(best.trim());
      interim = '';
    } else {
      interim = best;
    }
    onTranscript?.({ text: finals.join(' '), interim });
  });

  on('audiostart', (event) => { audioUri = event?.uri ?? audioUri; });
  on('audioend', (event) => { audioUri = event?.uri ?? audioUri; });
  on('error', (event) => {
    // 'no-speech' fires routinely during a quiet stretch of a lecture and is
    // not a failure; continuous mode restarts on its own.
    if (event?.error === 'no-speech') return;
    onError?.(event?.message || event?.error || 'Speech recognition failed');
  });
  on('end', () => { ended = true; });

  speech.ExpoSpeechRecognitionModule.start(RECOGNITION_OPTIONS);

  return {
    get transcript() { return finals.join(' '); },
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
    ...RECOGNITION_OPTIONS,
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
