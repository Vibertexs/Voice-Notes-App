import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Platform, SafeAreaView, StatusBar, StyleSheet, Text, View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import {
  RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
  requestRecordingPermissionsAsync, requestNotificationPermissionsAsync,
} from 'expo-audio';
import { useKeepAwake } from 'expo-keep-awake';
import { File } from 'expo-file-system';
import { BRIDGE_JS } from './src/bridge';
import { WEB_APP_HTML } from './src/webapp.generated';
import {
  AUDIO_DIR, audioFile, claimRecording, dropRecording, finishRecording,
  handleApi, newId, openDatabase, recoverInterrupted,
} from './src/localApi';

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
export default function App() {
  const webRef = useRef(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 200);
  const active = useRef(null);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState('');
  const backgroundOk = useRef(true);

  useKeepAwake();

  useEffect(() => {
    (async () => {
      try {
        await openDatabase();
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
    if (!webRef.current || state.metering === undefined) return;
    const level = Math.max(0, Math.min(1, ((state.metering ?? -60) + 60) / 60));
    webRef.current.injectJavaScript(`window.__cnSetLevel && window.__cnSetLevel(${level.toFixed(3)}); true;`);
  }, [state.metering]);

  const reply = useCallback((id, okValue, data) => {
    webRef.current?.injectJavaScript(
      `window.__cnSettle(${id}, ${okValue ? 'true' : 'false'}, ${JSON.stringify(data)}); true;`,
    );
  }, []);

  const configureAudio = useCallback(async (background) => {
    await setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
      allowsBackgroundRecording: background,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
  }, []);

  const startRecording = useCallback(async () => {
    const id = newId();
    const fileName = `${id}.m4a`;
    const title = new Date().toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    // Claim the row before any audio exists, so a crash mid-lecture still
    // leaves a pointer to whatever reached the disk.
    await claimRecording({ id, title, fileName });
    active.current = { id, fileName, startedAt: Date.now() };

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
  }, [recorder, configureAudio]);

  const stopRecording = useCallback(async () => {
    if (!active.current) throw new Error('Nothing is recording.');
    const { id, fileName, startedAt } = active.current;
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
    active.current = null;
    return { id };
  }, [recorder, state.durationMillis]);

  const onMessage = useCallback(async (event) => {
    let message;
    try { message = JSON.parse(event.nativeEvent.data); } catch { return; }
    const { id, channel, payload } = message ?? {};
    if (!id) return;

    try {
      if (channel === 'api') {
        reply(id, true, await handleApi(payload));
        return;
      }
      if (channel === 'mic.permission') {
        const granted = await requestRecordingPermissionsAsync();
        if (!granted.granted) { reply(id, true, { ok: false }); return; }
        if (Platform.OS === 'android') {
          // Android runs background capture as a foreground service, and a
          // foreground service must post a notification.
          try {
            const notify = await requestNotificationPermissionsAsync();
            backgroundOk.current = notify.granted;
          } catch { backgroundOk.current = false; }
        }
        await configureAudio(backgroundOk.current);
        reply(id, true, { ok: true });
        return;
      }
      if (channel === 'rec.start') { reply(id, true, await startRecording()); return; }
      if (channel === 'rec.pause') { recorder.pause(); reply(id, true, { ok: true }); return; }
      if (channel === 'rec.resume') { recorder.record(); reply(id, true, { ok: true }); return; }
      if (channel === 'rec.stop') { reply(id, true, await stopRecording()); return; }
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
  }, [reply, configureAudio, startRecording, stopRecording, recorder]);

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
        injectedJavaScriptBeforeContentLoaded={BRIDGE_JS}
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#e8eef7' },
  web: { flex: 1, backgroundColor: '#e8eef7' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#e8eef7' },
  errorTitle: { fontSize: 16, fontWeight: '700', color: '#131b2e' },
  errorBody: { fontSize: 13.5, lineHeight: 19, color: '#5b6a86', marginTop: 6, textAlign: 'center' },
});
