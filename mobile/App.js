import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useKeepAwake } from 'expo-keep-awake';
import { File } from 'expo-file-system';
import recorder, { HAS_RECORDER, RECORDER_PROBLEM } from './src/nativeAudio';
import { BRIDGE_JS } from './src/bridge';
import { WEB_APP_HTML } from './src/webapp.generated';
import {
  AUDIO_DIR, TRANSCRIPTION_ON_DEVICE, audioFile, claimRecording,
  dropRecording, finishRecording, handleApi, markTranscriptionPending,
  markTranscriptionProgress, newId, openDatabase, pendingTranscriptions,
  recoverInterrupted, saveTranscript,
} from './src/localApi';
import { transcribeOnDevice } from './src/onDeviceWhisper';

/**
 * Class Notes, as a native shell around the real web UI.
 *
 * The screen is the web build, unmodified, running in a WebView - which is why
 * it looks exactly like the desktop app. Everything the browser cannot do on a
 * phone is served from here instead: /api requests are answered from SQLite,
 * and the microphone plus Whisper run directly on the device.
 *
 * Recording is the reason this is a native app at all. A WebView's
 * MediaRecorder is suspended the moment the screen locks, so audio is captured
 * natively and only a token naming the file ever crosses into the page.
 */
const METERING_HERTZ = 12;

/** The recorder answers with the file it wrote; anything else is an error. */
function isWavPath(value) {
  return typeof value === 'string' && /\.wav$/i.test(value);
}

function asFileUri(path) {
  return path.startsWith('file://') ? path : `file://${path}`;
}

export default function App() {
  const webRef = useRef(null);
  const active = useRef(null);
  const draining = useRef(false);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState('');
  const [pageError, setPageError] = useState('');
  useKeepAwake();

  useEffect(() => {
    (async () => {
      try {
        await openDatabase();
        // Audio and speech recognition both happen on this phone. The initial
        // model download contains only Whisper weights; no lecture audio ever
        // leaves the device.
        TRANSCRIPTION_ON_DEVICE.value = true;
        if (!AUDIO_DIR.exists) AUDIO_DIR.create({ intermediates: true });
        await recoverInterrupted();
        setReady(true);
      } catch (caught) {
        setFatal(String(caught?.message ?? caught));
      }
    })();
  }, []);

  // Feed the page's waveform. The browser has no audio graph here, so the
  // level is pushed in rather than measured in the page - and it comes from
  // whichever engine currently holds the microphone.
  const pushLevel = useCallback((level) => {
    webRef.current?.injectJavaScript(
      `window.__cnSetLevel && window.__cnSetLevel(${Math.max(0, Math.min(1, level)).toFixed(3)}); true;`,
    );
  }, []);

  useEffect(() => {
    if (!HAS_RECORDER) return undefined;
    recorder.setAmplitudeUpdateFrequency(METERING_HERTZ);
    const subscription = recorder.addListener('onRecorderAmplitude', ({ amplitude }) => {
      // The recorder measures loudness off the PCM it is writing and reports it
      // already gated and curved, 0 to 1, which is the scale the waveform draws.
      pushLevel(Number(amplitude ?? 0));
    });
    return () => subscription.remove();
  }, [pushLevel]);

  const reply = useCallback((id, okValue, data) => {
    webRef.current?.injectJavaScript(
      `window.__cnSettle(${id}, ${okValue ? 'true' : 'false'}, ${JSON.stringify(data)}); true;`,
    );
  }, []);

  /**
   * Runs on launch and after each save, so an interrupted transcription picks
   * itself up again. One at a time keeps inference within a phone's memory
   * budget and prevents duplicate Whisper jobs.
   */
  const drainTranscriptions = useCallback(async () => {
    if (draining.current) return;

    draining.current = true;
    try {
      for (const lecture of await pendingTranscriptions()) {
        const file = audioFile(lecture.file_name);
        if (!file.exists) continue;
        try {
          const { transcript, segments } = await transcribeOnDevice(file.uri, {
            onProgress: (progress) => markTranscriptionProgress(lecture.id, progress).catch(() => {}),
          });
          await saveTranscript(lecture.id, transcript, segments);
        } catch (caught) {
          // Left pending on purpose: the audio is safe and the next drain
          // will try again. Only a message surfaces, never a lost lecture.
          setPageError((current) => current || `transcription: ${String(caught?.message ?? caught)}`);
          break;
        }
      }
    } finally {
      draining.current = false;
    }
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    drainTranscriptions();
    // A download or inference interrupted by a background event gets another
    // chance while the app is open, with no server dependency.
    const timer = setInterval(drainTranscriptions, 60_000);
    return () => clearInterval(timer);
  }, [ready, drainTranscriptions]);

  const startRecording = useCallback(async () => {
    const id = newId();
    const title = new Date().toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });

    const fileName = `${id}.wav`;
    // Claim the row before any audio exists, so a crash mid-lecture still
    // leaves a pointer to whatever reached the disk.
    await claimRecording({ id, title, fileName });
    // Set this before starting the native recorder so the shared error handler
    // can remove the claimed row if Android rejects the start request.
    active.current = { id, fileName, startedAt: Date.now(), sourceUri: null };
    const startedPath = recorder.startRecording();
    if (!isWavPath(startedPath)) {
      throw new Error(`Could not start recording: ${startedPath || 'unknown recorder error'}`);
    }
    active.current.sourceUri = asFileUri(startedPath);
    return { id };
  }, []);

  const stopRecording = useCallback(async () => {
    if (!active.current) throw new Error('Nothing is recording.');
    const { id, fileName, startedAt } = active.current;
    const completedPath = recorder.stopRecording();
    if (!isWavPath(completedPath)) {
      throw new Error(`Could not finish recording: ${completedPath || 'unknown recorder error'}`);
    }
    const source = new File(asFileUri(completedPath));
    if (!source?.exists) throw new Error('The recording file was not written.');
    const destination = audioFile(fileName);
    if (destination.exists) destination.delete();
    const durationSeconds = Number(recorder.getDuration(completedPath) ?? 0);
    // The file's length is measured from the bytes written, and the recorder
    // was open for a knowable amount of time. Pausing can only make the audio
    // shorter than the wall clock, never longer - so audio that outruns the
    // clock means chunks were written more than once, which is heard as a
    // stutter and read by Whisper as repeated words. Say so with the numbers
    // rather than leaving a corrupt file to explain itself.
    const wallSeconds = (Date.now() - startedAt) / 1000;
    if (durationSeconds > wallSeconds * 1.05 + 0.5) {
      // Where the extra audio came from is the useful half. The recorder
      // counts what it handed to the file, so bytes that match the file's own
      // length mean it wrote faithfully what it was given and the duplication
      // happened upstream, in the chunks it was handed.
      const stats = recorder.getStats?.() ?? {};
      const written = Number(stats.bytes ?? 0);
      const onDisk = Math.max(0, Number(source.size ?? 0) - 44);
      const faithful = written > 0 && Math.abs(written - onDisk) < 4096;
      setPageError((current) => current
        || `capture: ${durationSeconds.toFixed(1)}s of audio from ${wallSeconds.toFixed(1)}s of recording `
        + `(${(durationSeconds / Math.max(0.1, wallSeconds)).toFixed(2)}x). `
        + `${stats.chunks ?? '?'} chunks, ${written} bytes written vs ${onDisk} on disk `
        + `- ${faithful ? 'duplicated before the recorder' : 'written more than once'}`);
    }
    await source.move(destination);
    await finishRecording({
      id,
      durationMs: durationSeconds > 0 ? durationSeconds * 1000 : Date.now() - startedAt,
      sizeBytes: destination.size ?? 0,
    });
    await markTranscriptionPending(id);
    drainTranscriptions();
    active.current = null;
    return { id };
  }, [drainTranscriptions]);

  const cancelRecording = useCallback(async () => {
    const current = active.current;
    if (!current) return { cancelled: true };
    // `stopRecording()` finalises a temporary WAV, but we intentionally never
    // move it into the library. The claimed row is removed afterwards.
    const path = recorder.stopRecording();
    if (isWavPath(path)) {
      const file = new File(asFileUri(path));
      if (file.exists) file.delete();
    }
    await dropRecording(current.id).catch(() => {});
    active.current = null;
    return { id: current.id, cancelled: true };
  }, []);

  const onMessage = useCallback(async (event) => {
    let message;
    try { message = JSON.parse(event.nativeEvent.data); } catch { return; }
    const { id, channel, payload } = message ?? {};

    // Page failures carry no id: nothing is waiting on an answer, they just
    // need to become visible. A WebView that fails to render is otherwise a
    // white rectangle with no way to see why.
    if (channel === 'page.error') {
      setPageError((current) => current || `${payload?.kind}: ${payload?.detail}`);
      return;
    }
    if (!id) return;

    try {
      if (channel === 'api') {
        reply(id, true, await handleApi(payload));
        return;
      }
      if (channel === 'mic.permission') {
        if (!HAS_RECORDER) { reply(id, false, { message: RECORDER_PROBLEM }); return; }
        const granted = await recorder.requestMicrophonePermission();
        if (!granted.granted) { reply(id, true, { ok: false }); return; }
        await recorder.configureAudioSession({
          category: 'playAndRecord',
          mode: 'measurement',
          options: { allowBluetooth: true, defaultToSpeaker: true },
        });
        // The page no longer offers a live recogniser. A saved lecture is
        // transcribed by on-device Whisper after the user finishes recording.
        webRef.current?.injectJavaScript(
          `window.__CN_CAPS__ = { transcription: false, pause: true, recorder: ${HAS_RECORDER} };`
          + 'window.dispatchEvent(new Event("cn:caps")); true;',
        );
        reply(id, true, { ok: true });
        return;
      }
      if (channel === 'rec.start') { reply(id, true, await startRecording()); return; }
      if (channel === 'rec.pause') {
        const result = recorder.pauseRecording();
        if (result !== 'paused') throw new Error(`Could not pause recording: ${result}`);
        reply(id, true, { ok: true });
        return;
      }
      if (channel === 'rec.resume') {
        const result = recorder.resumeRecording();
        if (result !== 'resumed') throw new Error(`Could not resume recording: ${result}`);
        reply(id, true, { ok: true });
        return;
      }
      if (channel === 'rec.stop') { reply(id, true, await stopRecording()); return; }
      if (channel === 'rec.cancel') { reply(id, true, await cancelRecording()); return; }
      reply(id, false, { message: `Unknown channel ${channel}` });
    } catch (caught) {
      // A failed start leaves a claimed row with no audio behind it. Drop it
      // rather than let recovery adopt an empty lecture on the next launch.
      if (channel === 'rec.start' && active.current) {
        await dropRecording(active.current.id).catch(() => {});
        active.current = null;
      }
      reply(id, false, { message: String(caught?.message ?? caught) });
    }
  }, [reply, startRecording, stopRecording, cancelRecording]);

  if (fatal) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorTitle}>Class Notes could not start</Text>
        <Text style={styles.errorBody}>{fatal}</Text>
      </SafeAreaView>
    );
  }

  if (!ready) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color="#2a63dd" />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <WebView
        ref={webRef}
        // A file:// base origin lets an <audio> tag load a recording straight
        // off disk, which is how playback avoids a server.
        source={{ html: WEB_APP_HTML, baseUrl: AUDIO_DIR.uri }}
        originWhitelist={['*']}
        injectedJavaScriptBeforeContentLoaded={
          // Recording supports a pause-safe native WAV on every app build.
          // Whisper runs after save rather than showing an unreliable live
          // transcript while a student is speaking.
          `window.__CN_CAPS__ = { transcription: false, pause: true, recorder: ${HAS_RECORDER} };
${INSET_JS}
${BRIDGE_JS}`
        }
        onMessage={onMessage}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        mediaPlaybackRequiresUserAction={false}
        domStorageEnabled
        javaScriptEnabled
        // The page handles its own scrolling; a bouncing WebView on top of it
        // reads as a bug.
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        style={styles.web}
        onRenderProcessGone={() => setFatal('The interface stopped unexpectedly. Reopen the app.')}
        onError={(event) => setFatal(String(event.nativeEvent?.description ?? 'The interface failed to load.'))}
      />
      {pageError ? (
        <Pressable style={styles.pageError} onPress={() => setPageError('')}>
          <Text style={styles.pageErrorTitle}>The page reported a problem</Text>
          <Text style={styles.pageErrorBody}>{pageError}</Text>
          <Text style={styles.pageErrorHint}>Tap to dismiss</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The page draws under the status bar, so the yellow panel reaches the top
 * edge of the screen rather than starting below a bar of shell background.
 * That means the page has to reserve the status bar's height itself.
 *
 * iOS reports it through env(safe-area-inset-top), which the page already
 * reads and the viewport is already set to cover. Android's WebView does not
 * report it reliably, so the shell measures it and sets --top directly; an
 * inline custom property on :root outranks the stylesheet's env() default.
 */
const STATUS_INSET = Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : null;

const INSET_JS = STATUS_INSET == null ? '' : `
(function () {
  var apply = function () {
    try { document.documentElement.style.setProperty('--top', '${STATUS_INSET}px'); }
    catch (error) { /* documentElement not up yet; the listener below retries */ }
  };
  apply();
  document.addEventListener('DOMContentLoaded', apply);
})();
`;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#08080C' },
  web: { flex: 1, backgroundColor: '#08080C' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#08080C' },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  errorBody: { fontSize: 13.5, lineHeight: 19, color: 'rgba(255,255,255,.62)', marginTop: 6, textAlign: 'center' },
  pageError: {
    position: 'absolute', left: 12, right: 12, bottom: 18,
    padding: 14, borderRadius: 14, backgroundColor: '#2c071c',
    borderWidth: 1, borderColor: '#a51b60',
  },
  pageErrorTitle: { fontSize: 13, fontWeight: '800', color: '#ff9dcc' },
  pageErrorBody: { fontSize: 12.5, lineHeight: 18, color: '#ffe3f0', marginTop: 5 },
  pageErrorHint: { fontSize: 11, color: 'rgba(255,227,240,.6)', marginTop: 8 },
});
