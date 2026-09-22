import LiveAudioStream from '@fugood/react-native-audio-pcm-stream';
import { Buffer } from 'buffer';
import { File, FileMode, Paths } from 'expo-file-system';
import { PermissionsAndroid, Platform } from 'react-native';

/**
 * The recorder, written against the raw PCM stream.
 *
 * whisper.cpp reads one thing: 16 kHz, mono, signed 16-bit PCM in a WAV
 * container. Nothing in Expo records that on Android - expo-audio writes AAC -
 * so the audio arrives here as raw PCM chunks and this module puts the WAV
 * around it.
 *
 * Writing the file rather than delegating it is what buys pause. The stream
 * keeps running while paused and the chunks are simply not appended, so the
 * file contains the audio the user meant to keep and the timeline has no gap
 * to explain. A recorder that owned the file could not do that.
 *
 * The header is written first with zeroed sizes and patched on stop, because
 * an hour of lecture is about 115 MB and must never be held in memory to work
 * out how long it was.
 */

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
const HEADER_BYTES = 44;
/** Android's VOICE_RECOGNITION source: tuned for speech, minimal processing. */
const AUDIO_SOURCE_VOICE_RECOGNITION = 6;

/** A canonical 44-byte WAV header. Sizes are patched in when the take ends. */
function wavHeader(dataBytes) {
  const header = new Uint8Array(HEADER_BYTES);
  const view = new DataView(header.buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);              // PCM header length
  view.setUint16(20, 1, true);               // format 1 = uncompressed PCM
  view.setUint16(22, CHANNELS, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, BYTES_PER_SECOND, true);
  view.setUint16(32, CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return header;
}

/** Loudness of one chunk, 0..1, as the waveform wants it. */
function levelOf(bytes) {
  const samples = Math.floor(bytes.byteLength / BYTES_PER_SAMPLE);
  if (!samples) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sum = 0;
  // Every fourth sample is plenty for a meter and a quarter of the work.
  let counted = 0;
  for (let i = 0; i < samples; i += 4) {
    const value = view.getInt16(i * BYTES_PER_SAMPLE, true) / 32768;
    sum += value * value;
    counted += 1;
  }
  const rms = Math.sqrt(sum / Math.max(1, counted));
  // Gate room noise so silence reads flat, then curve it so speech uses the
  // upper half of the meter rather than hugging the floor.
  return Math.min(1, Math.max(0, (rms - 0.006) / 0.12) ** 0.55);
}

const state = {
  handle: null,
  file: null,
  dataBytes: 0,
  recording: false,
  paused: false,
  subscription: null,
  listeners: new Set(),
  lastEmit: 0,
  emitEveryMs: 100,
};

function emitLevel(level) {
  const now = Date.now();
  if (now - state.lastEmit < state.emitEveryMs) return;
  state.lastEmit = now;
  state.listeners.forEach((listener) => {
    // One bad listener must not stop the rest, or the take.
    try { listener({ amplitude: level }); } catch { /* ignore */ }
  });
}

function onChunk(base64) {
  if (!state.recording || state.paused || !state.handle) return;
  const buffer = Buffer.from(base64, 'base64');
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  try {
    state.handle.writeBytes(bytes);
    state.dataBytes += bytes.byteLength;
  } catch {
    // A failed write must not take the app down mid-lecture; the header is
    // patched from dataBytes, so what did land stays playable.
    return;
  }
  emitLevel(levelOf(bytes));
}

/* ---- the surface the shell calls ---------------------------------------- */

export async function requestMicrophonePermission() {
  if (Platform.OS !== 'android') return { granted: true };
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone',
      message: 'Class Notes records lectures so you can replay and search them later.',
      buttonPositive: 'Allow',
    },
  );
  return { granted: granted === PermissionsAndroid.RESULTS.GRANTED };
}

/** The platform session is configured by the stream itself; kept for parity. */
export function configureAudioSession() { return true; }

export function setAmplitudeUpdateFrequency(hertz) {
  const rate = Number(hertz);
  state.emitEveryMs = rate > 0 ? Math.max(30, Math.round(1000 / rate)) : 100;
}

export function addListener(_event, callback) {
  state.listeners.add(callback);
  return { remove: () => state.listeners.delete(callback) };
}

/** Begins a take and returns the file it is being written to. */
export function startRecording() {
  if (state.recording) throw new Error('Already recording.');

  const target = new File(Paths.cache, `take-${Date.now()}.wav`);
  if (target.exists) target.delete();
  target.create();

  const handle = target.open(FileMode.ReadWrite);
  handle.writeBytes(wavHeader(0));

  state.file = target;
  state.handle = handle;
  state.dataBytes = 0;
  state.paused = false;
  state.recording = true;

  LiveAudioStream.init({
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    bitsPerSample: BITS_PER_SAMPLE,
    audioSource: AUDIO_SOURCE_VOICE_RECOGNITION,
    bufferSize: 4096,
  });
  state.subscription = LiveAudioStream.on('data', onChunk);
  LiveAudioStream.start();

  return target.uri;
}

export function pauseRecording() {
  if (!state.recording) return 'idle';
  state.paused = true;
  emitLevel(0);
  return 'paused';
}

export function resumeRecording() {
  if (!state.recording) return 'idle';
  state.paused = false;
  return 'recording';
}

/** Ends the take, patches the header to the real sizes, returns the file. */
export function stopRecording() {
  if (!state.recording) return '';
  state.recording = false;
  state.paused = false;

  try { LiveAudioStream.stop(); } catch { /* already stopped */ }
  state.subscription?.remove?.();
  state.subscription = null;

  const { handle, file, dataBytes } = state;
  if (handle) {
    try {
      // RIFF size at byte 4, data size at byte 40. Both are little-endian
      // uint32 and both are only knowable now.
      const sizes = new DataView(new ArrayBuffer(4));
      handle.offset = 4;
      sizes.setUint32(0, 36 + dataBytes, true);
      handle.writeBytes(new Uint8Array(sizes.buffer.slice(0)));
      handle.offset = 40;
      sizes.setUint32(0, dataBytes, true);
      handle.writeBytes(new Uint8Array(sizes.buffer.slice(0)));
    } catch { /* the file is still playable with a zeroed size on most players */ }
    try { handle.close(); } catch { /* already closed */ }
  }

  state.handle = null;
  state.file = null;
  state.dataBytes = dataBytes;
  emitLevel(0);
  return file ? file.uri : '';
}

/** Seconds of audio, from the bytes actually written. */
export function getDuration(uri) {
  if (uri && state.file?.uri !== uri) {
    try {
      const file = new File(uri);
      if (file.exists) {
        return Math.max(0, (Number(file.size ?? 0) - HEADER_BYTES) / BYTES_PER_SECOND);
      }
    } catch { /* fall through to what this session wrote */ }
  }
  return state.dataBytes / BYTES_PER_SECOND;
}

export const RECORDING_FORMAT = Object.freeze({
  sampleRate: SAMPLE_RATE,
  channels: CHANNELS,
  bitsPerSample: BITS_PER_SAMPLE,
});

export default {
  requestMicrophonePermission,
  configureAudioSession,
  setAmplitudeUpdateFrequency,
  addListener,
  startRecording,
  pauseRecording,
  resumeRecording,
  stopRecording,
  getDuration,
};
