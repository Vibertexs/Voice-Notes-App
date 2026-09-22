import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
/**
 * whisper.rn is native too, so it is loaded when it is first needed rather
 * than at import. A binary compiled before it was added would otherwise throw
 * at module scope and take the whole app down before anything renders.
 */
function loadWhisper() {
  try {
    const module = require('whisper.rn');
    const init = module?.initWhisper ?? module?.default?.initWhisper;
    if (typeof init !== 'function') throw new Error('initWhisper is missing');
    return init;
  } catch (error) {
    throw new Error(
      'On-device transcription is not in this build. Rebuild the development '
      + `client and install it again. (${error?.message ?? error})`,
    );
  }
}

/**
 * A private, offline transcription engine for the mobile app.
 *
 * The only download is the Whisper model itself. Audio is never uploaded: the
 * recorder writes a 16 kHz WAV on the phone and whisper.cpp reads that same
 * file directly from the app's documents directory.
 */
const MODEL_DIRECTORY = new Directory(Paths.document, 'whisper-models');
const MODEL_FILE_NAME = 'ggml-small.en-q5_1.bin';
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE_NAME}`;
const MODEL_FILE = new File(MODEL_DIRECTORY, MODEL_FILE_NAME);
const PARTIAL_MODEL_FILE = new File(MODEL_DIRECTORY, `${MODEL_FILE_NAME}.partial`);

// The q5 small English model is about 181 MB. It is roughly three times the
// work of base.en, which a phone can afford: base transcribed at about eight
// times realtime on a 2023 handset, so small still lands near three, and an
// hour of lecture takes about twenty minutes. The accuracy is worth it - base
// mishears ordinary words often enough to make a transcript annoying to read.
//
// Anything substantially smaller than the real file is an interrupted
// download; catching it here beats an opaque failure inside the model loader.
const MIN_MODEL_BYTES = 150 * 1024 * 1024;

let contextPromise = null;

export const ON_DEVICE_MODEL = Object.freeze({
  name: 'Whisper Small English',
  sizeLabel: 'about 181 MB',
  downloadUrl: MODEL_URL,
});

function hasCompleteModel() {
  return MODEL_FILE.exists && Number(MODEL_FILE.size ?? 0) >= MIN_MODEL_BYTES;
}

async function ensureModel(onProgress) {
  if (hasCompleteModel()) return MODEL_FILE;

  if (!MODEL_DIRECTORY.exists) MODEL_DIRECTORY.create({ intermediates: true });
  if (PARTIAL_MODEL_FILE.exists) PARTIAL_MODEL_FILE.delete();

  const download = File.createDownloadTask(MODEL_URL, PARTIAL_MODEL_FILE, {
    onProgress: ({ bytesWritten, totalBytes }) => {
      if (totalBytes > 0) onProgress?.(Math.min(0.24, (bytesWritten / totalBytes) * 0.24));
    },
  });
  const downloaded = await download.downloadAsync();
  download.release();

  if (!downloaded || Number(downloaded.size ?? 0) < MIN_MODEL_BYTES) {
    if (downloaded?.exists) downloaded.delete();
    throw new Error('The Whisper model download did not finish. Keep the app open and try again.');
  }

  if (MODEL_FILE.exists) MODEL_FILE.delete();
  await downloaded.move(MODEL_FILE);
  onProgress?.(0.24);
  return MODEL_FILE;
}

async function getContext(onProgress) {
  if (!contextPromise) {
    contextPromise = ensureModel(onProgress)
      .then((model) => loadWhisper()({
        filePath: model.uri,
        // The binding supports GPU acceleration on iOS. Android safely uses
        // whisper.cpp's CPU path, which keeps the build portable.
        useGpu: Platform.OS === 'ios',
      }))
      .catch((error) => {
        contextPromise = null;
        throw error;
      });
  }
  return contextPromise;
}

/** Roughly a comfortable line of a transcript. */
const MAX_LINE_WORDS = 12;
const MAX_LINE_CHARS = 72;
/** Above this, `maxLen` clearly did not take effect and pieces are sentences. */
const PIECE_IS_A_LINE = 3;

/**
 * Rebuild whole words from the pieces whisper emits.
 *
 * whisper.cpp only splits on word boundaries when `split_on_word` is set, and
 * whisper.rn does not expose it - so with `maxLen: 1` every split lands on a
 * token, and tokens are subword. "mitosis" arrives as " mit" + "osis", and a
 * full stop arrives as its own piece.
 *
 * The leading space is the whole signal: whisper gives a word-initial token
 * one and a continuation none. Joining on that puts the words back together
 * and keeps punctuation tight against them, while each word keeps the start of
 * its first piece and the end of its last.
 */
function joinIntoWords(pieces) {
  const words = [];
  for (const piece of pieces) {
    const raw = String(piece.text ?? '');
    const text = raw.trim();
    if (!text) continue;
    const start = Math.max(0, Number(piece.t0 ?? 0) / 100);
    const end = Math.max(0, Number(piece.t1 ?? 0) / 100);
    const previous = words[words.length - 1];
    if (previous && !/^\s/.test(raw)) {
      previous.text += text;
      previous.end = Math.max(previous.end, end);
    } else {
      words.push({ text, start, end });
    }
  }
  return words;
}

/**
 * Turn whisper's pieces back into readable lines, keeping each word's timing.
 *
 * whisper.rn reports a start and an end per segment and nothing finer - its
 * Android bridge compiles with `dtw_token_timestamps = false`, so real word
 * timings are not available to ask for. Transcribing with a small `maxLen`
 * gets a piece per token instead, and joining them here rebuilds the words and
 * then the lines the transcript displays. The result is the same shape the
 * desktop produces from faster-whisper's word timestamps, so the player treats
 * both identically.
 */
function groupIntoLines(pieces) {
  const clean = pieces
    .map((piece) => ({
      text: String(piece.text ?? '').trim(),
      start: Math.max(0, Number(piece.t0 ?? 0) / 100),
      end: Math.max(0, Number(piece.t1 ?? 0) / 100),
    }))
    .filter((piece) => piece.text);
  if (!clean.length) return [];

  // If the pieces are already whole sentences, there is no finer timing to
  // keep; say so by omitting `words` rather than implying a precision that
  // would light an entire line at once.
  const averageWords = clean.reduce((total, piece) => total + piece.text.split(/\s+/).length, 0) / clean.length;
  if (averageWords > PIECE_IS_A_LINE) {
    return clean.map((piece) => ({
      text: piece.text,
      start_seconds: piece.start,
      end_seconds: Math.max(piece.start, piece.end),
    }));
  }

  const lines = [];
  let line = null;
  for (const word of joinIntoWords(pieces)) {
    if (!line) line = { text: '', start_seconds: word.start, end_seconds: word.end, words: [] };
    // A leading space on every word but the first, matching what the desktop
    // stores, so the player can render words without inventing separators.
    line.words.push({ start: word.start, end: word.end, word: line.words.length ? ` ${word.text}` : word.text });
    line.text = line.text ? `${line.text} ${word.text}` : word.text;
    line.end_seconds = Math.max(line.end_seconds, word.end);
    // Breaking here is safe because a whole word has just landed - a line can
    // no longer end in the middle of one.
    if (/[.!?]$/.test(word.text) || line.words.length >= MAX_LINE_WORDS || line.text.length >= MAX_LINE_CHARS) {
      lines.push(line);
      line = null;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Transcribe a PCM WAV already stored on the phone. whisper.cpp timestamps use
 * centiseconds, while the app's segment format uses seconds.
 */
export async function transcribeOnDevice(fileUri, { onProgress } = {}) {
  const context = await getContext(onProgress);
  const job = context.transcribe(fileUri, {
    language: 'en',
    maxThreads: 4,
    tokenTimestamps: true,
    // Short pieces, regrouped into lines below. This is what buys the
    // transcript its timing resolution.
    maxLen: 1,
    onProgress: (percent) => onProgress?.(0.24 + (Math.max(0, Math.min(100, percent)) / 100) * 0.76),
  });
  const result = await job.promise;

  if (result.isAborted) throw new Error('Whisper stopped before the transcript was complete.');

  const segments = groupIntoLines(result.segments ?? []);
  onProgress?.(1);
  return { transcript: String(result.result ?? '').trim(), segments };
}
