import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useKeepAwake } from 'expo-keep-awake';
import { File } from 'expo-file-system';
import { BRIDGE_JS } from './src/bridge';
import { WEB_APP_HTML } from './src/webapp.generated';
import {
  AUDIO_DIR, TRANSCRIPTION_ON_DEVICE, TRANSCRIPTION_SERVER, audioFile, claimRecording,
  dropRecording, finishRecording, getSetting, handleApi, markTranscriptionPending,
  markTranscriptionProgress, newId, openDatabase, pendingTranscriptions,
  recoverInterrupted, saveTranscript,
} from './src/localApi';
import { probe, transcribeRemotely } from './src/remote';
import {
  RECORDING_OPTIONS, SUPPORTS_PAUSE, TRANSCRIPTION_AVAILABLE,
  configureAudio, describeModelStatus, refreshOnDeviceSupport,
  requestPermissions, startSpeechSession,
} from './src/capture';

/**
 * Class Notes, as a native shell around the real web UI.
 *
 * The screen is the web build, unmodified, running in a WebView - which is why
 * it looks exactly like the desktop app. Everything the browser cannot do on a
 * phone is served from here instead: /api requests are answered from SQLite,
 * and the microphone is driven by expo-audio.
 *
 * Recording is the reason this is a native app at all. A WebView's
 * MediaRecorder is suspended the moment the screen locks, so audio is captured
 * natively and only a token naming the file ever crosses into the page.
 */
/** Fast enough that the trace follows a voice rather than stepping. */
const METERING_INTERVAL_MS = 80;

export default function App() {
  const webRef = useRef(null);
  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const state = useAudioRecorderState(recorder, METERING_INTERVAL_MS);
  const active = useRef(null);
  const session = useRef(null);
  const draining = useRef(false);
  // Whether the recogniser is actually usable, as opposed to merely linked.
  // Settled at permission time, because a linked module with no offline
  // language pack fails the whole session rather than degrading.
  const transcriptionReady = useRef(false);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState('');
  const [pageError, setPageError] = useState('');
  const backgroundOk = useRef(true);

  useKeepAwake();

  useEffect(() => {
    (async () => {
      try {
        await openDatabase();
        TRANSCRIPTION_ON_DEVICE.value = TRANSCRIPTION_AVAILABLE;
        if (!AUDIO_DIR.exists) AUDIO_DIR.create({ intermediates: true });
        await recoverInterrupted();
        setReady(true);
      } catch (caught) {
        setFatal(String(caught?.message ?? caught));
      }
    })();
  }, []);

  // Feed the page's waveform from native metering. The browser has no audio
  // graph here, so the level is pushed in rather than measured in the page.
  useEffect(() => {
    if (!webRef.current) return;
    // Metering is dBFS: roughly -60 in a silent room, 0 at the clipping point.
    const level = Math.max(0, Math.min(1, ((state.metering ?? -60) + 60) / 60));
    webRef.current.injectJavaScript(
      `window.__cnSetLevel && window.__cnSetLevel(${level.toFixed(3)}); true;`,
    );
  }, [state.metering]);

  const reply = useCallback((id, okValue, data) => {
    webRef.current?.injectJavaScript(
      `window.__cnSettle(${id}, ${okValue ? 'true' : 'false'}, ${JSON.stringify(data)}); true;`,
    );
  }, []);

  /**
   * Sends anything still waiting for a server transcript.
   *
   * Runs on launch and after each save, so a lecture recorded with no server
   * in reach transcribes itself the next time one is. One at a time and
   * guarded by a flag: two drains would upload the same lecture twice.
   */
  const drainTranscriptions = useCallback(async () => {
    if (draining.current) return;
    const server = await getSetting(TRANSCRIPTION_SERVER, '');
    if (!server) return;

    draining.current = true;
    try {
      const reachable = await probe(server);
      if (!reachable.ok) return;

      for (const lecture of await pendingTranscriptions()) {
        const file = audioFile(lecture.file_name);
        if (!file.exists) continue;
        try {
          const { transcript } = await transcribeRemotely({
            baseUrl: server,
            fileUri: file.uri,
            fileName: lecture.file_name,
            mimeType: lecture.file_name.endsWith('.wav') ? 'audio/wav' : 'audio/m4a',
            title: lecture.title,
            notes: lecture.note_body,
            onProgress: ({ progress }) => markTranscriptionProgress(lecture.id, progress).catch(() => {}),
          });
          await saveTranscript(lecture.id, transcript);
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
    // A server that was unreachable at launch usually is not for long.
    const timer = setInterval(drainTranscriptions, 60_000);
    return () => clearInterval(timer);
  }, [ready, drainTranscriptions]);

  const startRecording = useCallback(async () => {
    const id = newId();
    const title = new Date().toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });

    if (transcriptionReady.current) {
      // The recogniser writes its own WAV, so the final name is not known
      // until it closes the file. The row is still claimed first; recovery
      // tolerates a row whose audio never arrived.
      const fileName = `${id}.wav`;
      await claimRecording({ id, title, fileName });
      active.current = { id, fileName, startedAt: Date.now(), engine: 'speech' };
      session.current = startSpeechSession({
        onTranscript: ({ text, interim }) => {
          // Live text goes straight to the page; it is only persisted at stop.
          webRef.current?.injectJavaScript(
            `window.__cnTranscript && window.__cnTranscript(${JSON.stringify(text)}, ${JSON.stringify(interim)}); true;`,
          );
        },
        onError: (message) => setPageError((current) => current || `transcription: ${message}`),
      });
      return { id };
    }

    const fileName = `${id}.m4a`;
    // Claim the row before any audio exists, so a crash mid-lecture still
    // leaves a pointer to whatever reached the disk.
    await claimRecording({ id, title, fileName });
    active.current = { id, fileName, startedAt: Date.now(), engine: 'audio' };

    try {
      await recorder.prepareToRecordAsync();
    } catch (refused) {
      // Background capture needs manifest entries that only exist in a dev or
      // production build; Expo Go ships its own fixed manifest. Rather than
      // leave the user unable to record, drop background and try once more.
      if (!backgroundOk.current) throw refused;
      backgroundOk.current = false;
      await configureAudio(false);
      await recorder.prepareToRecordAsync();
    }
    recorder.record();
    return { id };
  }, [recorder]);

  const stopRecording = useCallback(async () => {
    if (!active.current) throw new Error('Nothing is recording.');
    const { id, fileName, startedAt, engine } = active.current;

    if (engine === 'speech') {
      const current = session.current;
      current.stop();
      // The WAV is not readable until the recogniser closes it.
      const uri = await current.waitForAudio();
      const transcript = current.transcript;
      current.release();
      session.current = null;
      if (!uri) throw new Error('The recording file was not written.');

      const source = new File(uri);
      if (!source.exists) throw new Error('The recording file was not written.');
      const destination = audioFile(fileName);
      if (destination.exists) destination.delete();
      await source.move(destination);
      await finishRecording({
        id,
        durationMs: Date.now() - startedAt,
        sizeBytes: destination.size ?? 0,
      });
      await saveTranscript(id, transcript);
      // A server transcript is better than the on-device one, so queue the
      // lecture for it. The device text stands in until it arrives.
      if (await getSetting(TRANSCRIPTION_SERVER, '')) {
        await markTranscriptionPending(id);
        drainTranscriptions();
      }
      active.current = null;
      return { id };
    }

    await recorder.stop();
    const source = recorder.uri ? new File(recorder.uri) : null;
    if (!source?.exists) throw new Error('The recording file was not written.');
    const destination = audioFile(fileName);
    if (destination.exists) destination.delete();
    await source.move(destination);
    await finishRecording({
      id,
      durationMs: state.durationMillis || Date.now() - startedAt,
      sizeBytes: destination.size ?? 0,
    });
    // Nothing heard it on this device, so a server is the only way this
    // lecture gets a transcript at all.
    if (await getSetting(TRANSCRIPTION_SERVER, '')) {
      await markTranscriptionPending(id);
      drainTranscriptions();
    }
    active.current = null;
    return { id };
  }, [recorder, state.durationMillis, drainTranscriptions]);

  // The language pack can arrive minutes after it was asked for - Android may
  // wait for wifi, or for the user to accept a dialog. Re-checking is cheap,
  // so the app upgrades itself the moment it lands instead of asking anyone to
  // restart or go into settings.
  useEffect(() => {
    if (!ready || !TRANSCRIPTION_AVAILABLE) return undefined;
    let cancelled = false;

    const recheck = async () => {
      if (cancelled || transcriptionReady.current) return;
      const nowSupported = await refreshOnDeviceSupport();
      if (cancelled || !nowSupported) return;
      transcriptionReady.current = true;
      webRef.current?.injectJavaScript(
        'window.__CN_CAPS__ = { transcription: true, pause: false };'
        + 'window.dispatchEvent(new Event("cn:caps")); true;',
      );
      setPageError((current) => (current?.startsWith('transcription:') ? '' : current));
    };

    const timer = setInterval(recheck, 20_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [ready]);

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
        const granted = await requestPermissions();
        if (!granted.ok) { reply(id, true, { ok: false }); return; }
        backgroundOk.current = granted.background;
        transcriptionReady.current = granted.transcription === true;
        if (TRANSCRIPTION_AVAILABLE && !transcriptionReady.current) {
          const explanation = describeModelStatus(granted.reason);
          if (explanation) setPageError((current) => current || `transcription: ${explanation}`);
        }
        // The capability the page was told about at load may be wrong now.
        webRef.current?.injectJavaScript(
          `window.__CN_CAPS__ = ${JSON.stringify({ transcription: transcriptionReady.current, pause: !transcriptionReady.current })}; true;`,
        );
        await configureAudio(granted.background);
        reply(id, true, { ok: true });
        return;
      }
      if (channel === 'rec.start') { reply(id, true, await startRecording()); return; }
      if (channel === 'rec.pause') {
        const canPause = !transcriptionReady.current;
        if (canPause) recorder.pause();
        reply(id, true, { ok: canPause });
        return;
      }
      if (channel === 'rec.resume') {
        const canPause = !transcriptionReady.current;
        if (canPause) recorder.record();
        reply(id, true, { ok: canPause });
        return;
      }
      if (channel === 'rec.stop') { reply(id, true, await stopRecording()); return; }
      reply(id, false, { message: `Unknown channel ${channel}` });
    } catch (caught) {
      // A failed start leaves a claimed row with no audio behind it. Drop it
      // rather than let recovery adopt an empty lecture on the next launch.
      if (channel === 'rec.start' && active.current) {
        session.current?.abort();
        session.current = null;
        await dropRecording(active.current.id).catch(() => {});
        active.current = null;
      }
      reply(id, false, { message: String(caught?.message ?? caught) });
    }
  }, [reply, startRecording, stopRecording, recorder]);

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
      <StatusBar barStyle="dark-content" />
      <WebView
        ref={webRef}
        // A file:// base origin lets an <audio> tag load a recording straight
        // off disk, which is how playback avoids a server.
        source={{ html: WEB_APP_HTML, baseUrl: AUDIO_DIR.uri }}
        originWhitelist={['*']}
        injectedJavaScriptBeforeContentLoaded={
          // A starting guess. Whether the recogniser really works is only
          // known once permissions and the offline model are checked, and the
          // page is corrected then.
          `window.__CN_CAPS__ = ${JSON.stringify({
            transcription: TRANSCRIPTION_AVAILABLE, pause: SUPPORTS_PAUSE,
          })};
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#e8eef7' },
  web: { flex: 1, backgroundColor: '#e8eef7' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#e8eef7' },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#131b2e' },
  errorBody: { fontSize: 13.5, lineHeight: 19, color: '#5b6a86', marginTop: 6, textAlign: 'center' },
  pageError: {
    position: 'absolute', left: 12, right: 12, bottom: 18,
    padding: 14, borderRadius: 14, backgroundColor: '#2c071c',
    borderWidth: 1, borderColor: '#a51b60',
  },
  pageErrorTitle: { fontSize: 13, fontWeight: '800', color: '#ff9dcc' },
  pageErrorBody: { fontSize: 12.5, lineHeight: 18, color: '#ffe3f0', marginTop: 5 },
  pageErrorHint: { fontSize: 11, color: 'rgba(255,227,240,.6)', marginTop: 8 },
});
