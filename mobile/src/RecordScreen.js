import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  requestRecordingPermissionsAsync,
  requestNotificationPermissionsAsync,
} from 'expo-audio';
import { useKeepAwake } from 'expo-keep-awake';
import { File } from 'expo-file-system';
import { beginRecording, completeRecording, RECORDINGS_DIR } from './store';
import { clock, newId, timestampTitle } from './util';
import { colors, type } from './theme';

/**
 * The recorder. A phone left on a desk for fifty minutes is a hostile place:
 * the screen locks, the OS backgrounds the app, a call can seize the mic.
 *
 * Two defences: the audio session is configured to survive backgrounding, and
 * the database row is written *before* recording starts, so audio that reached
 * the disk is recoverable even if the process is killed.
 */
export default function RecordScreen({ onSaved, onCancel, classId = null }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [backgroundOk, setBackgroundOk] = useState(true);
  const pending = useRef(null);

  // Stops the screen locking while the user is still looking at it. Recording
  // survives a lock anyway, but the lock is the moment users lose confidence.
  useKeepAwake();

  useEffect(() => {
    (async () => {
      const granted = await requestRecordingPermissionsAsync();
      if (!granted.granted) {
        setError('Microphone access is off. Enable it in Settings to record.');
        return;
      }

      // Android runs background capture as a foreground service, and a
      // foreground service must post a notification. Without POST_NOTIFICATIONS
      // the OS refuses to prepare the recorder at all, so ask before arming it.
      // Denying is survivable: we drop to foreground-only rather than refusing
      // to record, and say so, because a recording that stops at screen-lock
      // still beats no recording.
      let background = true;
      if (Platform.OS === 'android') {
        try {
          const notify = await requestNotificationPermissionsAsync();
          background = notify.granted;
        } catch {
          background = false;
        }
        if (!background) {
          setWarning('Notifications are off, so recording stops when you leave the app. Turn them on to record with the screen locked.');
        }
      }
      setBackgroundOk(background);

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
        // The whole point: keep capturing once the screen locks.
        allowsBackgroundRecording: background,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      });
    })().catch((caught) => setError(String(caught?.message ?? caught)));
  }, []);

  const start = useCallback(async () => {
    try {
      const id = newId();
      const createdAt = new Date().toISOString();
      const fileName = `${id}.m4a`;
      // Claim the row first: a crash after this still leaves a pointer to the audio.
      await beginRecording({ id, title: timestampTitle(new Date()), fileName, createdAt, classId });
      pending.current = { id, fileName, startedAt: Date.now() };
      await recorder.prepareToRecordAsync();
      recorder.record();
      setPhase('recording');
    } catch (caught) {
      setError(String(caught?.message ?? caught));
      setPhase('idle');
    }
  }, [recorder, classId]);

  const toggle = useCallback(() => {
    if (phase === 'recording') { recorder.pause(); setPhase('paused'); }
    else if (phase === 'paused') { recorder.record(); setPhase('recording'); }
  }, [phase, recorder]);

  const finish = useCallback(async () => {
    if (!pending.current) return;
    setPhase('saving');
    const { id, fileName, startedAt } = pending.current;
    try {
      await recorder.stop();
      const source = recorder.uri ? new File(recorder.uri) : null;
      if (!source?.exists) throw new Error('The recording file was not written.');
      const destination = new File(RECORDINGS_DIR, fileName);
      if (destination.exists) destination.delete();
      await source.move(destination);
      await completeRecording({
        id,
        durationMs: state.durationMillis || Date.now() - startedAt,
        sizeBytes: destination.size ?? 0,
      });
      pending.current = null;
      onSaved(id);
    } catch (caught) {
      setError(String(caught?.message ?? caught));
      setPhase('paused');
    }
  }, [recorder, state.durationMillis, onSaved]);

  const discard = useCallback(() => {
    Alert.alert('Discard this recording?', 'The audio will be deleted.', [
      { text: 'Keep recording', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          try { await recorder.stop(); } catch { /* already stopped */ }
          const { deleteRecording } = await import('./store');
          if (pending.current) await deleteRecording(pending.current.id);
          pending.current = null;
          onCancel();
        },
      },
    ]);
  }, [recorder, onCancel]);

  const elapsed = phase === 'idle' ? 0 : state.durationMillis ?? 0;
  const level = Math.max(0, Math.min(1, ((state.metering ?? -60) + 60) / 60));

  return (
    <View style={styles.screen}>
      <Text style={styles.phase}>
        {phase === 'idle' ? 'Ready' : phase === 'recording' ? 'Recording' : phase === 'paused' ? 'Paused' : 'Saving'}
      </Text>
      <Text style={styles.clock}>{clock(elapsed)}</Text>

      <View style={styles.meter}>
        {Array.from({ length: 28 }).map((_, index) => {
          const active = phase === 'recording' && level * 28 > index;
          return <View key={index} style={[styles.bar, active && styles.barActive, { height: 6 + index % 7 * 4 }]} />;
        })}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!error && warning ? <Text style={styles.warning}>{warning}</Text> : null}

      <View style={styles.controls}>
        {phase === 'idle' && (
          <Pressable style={styles.shutter} onPress={start} accessibilityLabel="Start recording">
            <View style={styles.shutterDot} />
          </Pressable>
        )}
        {(phase === 'recording' || phase === 'paused') && (
          <Pressable style={styles.shutter} onPress={toggle} accessibilityLabel={phase === 'recording' ? 'Pause' : 'Resume'}>
            {phase === 'recording'
              ? <View style={styles.pauseGlyph}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View>
              : <View style={styles.shutterDot} />}
          </Pressable>
        )}
        {phase === 'saving' && <ActivityIndicator size="large" color={colors.accent} />}
      </View>

      <Text style={styles.hint}>
        {phase === 'idle'
          ? (backgroundOk
            ? 'Tap to record. You can lock the screen and put the phone down.'
            : 'Tap to record. Keep this screen open — background capture is off.')
          : phase === 'recording'
            ? (backgroundOk ? 'Recording continues with the screen off.' : 'Keep the app open while recording.')
            : phase === 'paused' ? 'Paused' : 'Writing the file…'}
      </Text>

      {phase === 'paused' && (
        <View style={styles.finishRow}>
          <Pressable style={[styles.button, styles.buttonGhost]} onPress={discard}>
            <Text style={styles.buttonGhostText}>Discard</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.buttonPrimary]} onPress={finish}>
            <Text style={styles.buttonPrimaryText}>Save lecture</Text>
          </Pressable>
        </View>
      )}

      {phase === 'idle' && (
        <Pressable onPress={onCancel} style={styles.cancel}>
          <Text style={styles.cancelText}>Back</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.deep },
  phase: { ...type.label, color: colors.dim },
  clock: { ...type.clock, color: colors.onDeep, marginTop: 4 },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 48, marginVertical: 28 },
  bar: { width: 3, borderRadius: 2, backgroundColor: 'rgba(200,214,245,0.25)' },
  barActive: { backgroundColor: colors.rec },
  controls: { height: 110, justifyContent: 'center' },
  shutter: {
    width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.28)',
  },
  shutterDot: { width: 66, height: 66, borderRadius: 33, backgroundColor: colors.rec },
  pauseGlyph: { flexDirection: 'row', gap: 8 },
  pauseBar: { width: 9, height: 32, borderRadius: 3, backgroundColor: colors.rec },
  hint: { ...type.body, color: colors.dim, textAlign: 'center', marginTop: 8 },
  error: { ...type.body, color: '#ff9b93', textAlign: 'center', marginBottom: 8 },
  warning: { ...type.body, color: '#f3c77b', textAlign: 'center', marginBottom: 8, paddingHorizontal: 12 },
  finishRow: { flexDirection: 'row', gap: 12, marginTop: 28 },
  button: { minHeight: 48, paddingHorizontal: 22, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonPrimaryText: { ...type.button, color: '#fff' },
  buttonGhost: { backgroundColor: 'rgba(255,255,255,0.12)' },
  buttonGhostText: { ...type.button, color: colors.onDeep },
  cancel: { marginTop: 26, padding: 10 },
  cancelText: { ...type.body, color: colors.dim },
});
