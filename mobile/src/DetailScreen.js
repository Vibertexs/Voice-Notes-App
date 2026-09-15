import { useEffect, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { deleteRecording, recordingFile, renameRecording, saveNotes } from './store';
import { colors, type } from './theme';
import { duration, fileSize, shortDate } from './util';

export default function DetailScreen({ recording, onBack, onChanged }) {
  const file = recordingFile(recording.file_name);
  const player = useAudioPlayer(file.exists ? file.uri : null);
  const status = useAudioPlayerStatus(player);
  const [title, setTitle] = useState(recording.title);
  const [notes, setNotes] = useState(recording.notes ?? '');

  // Persist notes a moment after typing stops rather than on every keystroke.
  useEffect(() => {
    if (notes === (recording.notes ?? '')) return undefined;
    const timer = setTimeout(() => {
      saveNotes(recording.id, notes).then(onChanged).catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [notes, recording.id, recording.notes, onChanged]);

  const total = status?.duration ? status.duration * 1000 : recording.duration_ms;
  const played = (status?.currentTime ?? 0) * 1000;

  function confirmDelete() {
    Alert.alert('Delete this lecture?', 'The audio and notes go with it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => { await deleteRecording(recording.id); onBack(); },
      },
    ]);
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Pressable onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>‹  Lectures</Text>
        </Pressable>

        <TextInput
          style={styles.title}
          value={title}
          onChangeText={setTitle}
          onBlur={() => renameRecording(recording.id, title.trim() || recording.title).then(onChanged)}
          placeholder="Untitled lecture"
          placeholderTextColor={colors.faint}
        />
        <Text style={styles.meta}>
          {shortDate(recording.created_at)} · {duration(recording.duration_ms)} · {fileSize(recording.size_bytes)}
        </Text>

        {!file.exists ? (
          <Text style={styles.missing}>The audio file for this recording is missing.</Text>
        ) : (
          <View style={styles.player}>
            <Pressable
              style={styles.play}
              onPress={() => (status?.playing ? player.pause() : player.play())}
              accessibilityLabel={status?.playing ? 'Pause' : 'Play'}
            >
              {status?.playing
                ? <View style={styles.pauseGlyph}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View>
                : <View style={styles.playGlyph} />}
            </Pressable>
            <View style={styles.track}>
              <View style={styles.trackBase}>
                <View style={[styles.trackFill, { width: `${total ? Math.min(100, (played / total) * 100) : 0}%` }]} />
              </View>
              <Text style={styles.time}>{duration(played)} / {duration(total)}</Text>
            </View>
          </View>
        )}

        <Text style={styles.label}>Notes</Text>
        <TextInput
          style={styles.notes}
          value={notes}
          onChangeText={setNotes}
          multiline
          textAlignVertical="top"
          placeholder="What mattered in this lecture?"
          placeholderTextColor={colors.faint}
        />

        <Pressable style={styles.delete} onPress={confirmDelete}>
          <Text style={styles.deleteText}>Delete lecture</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  body: { padding: 20, paddingBottom: 48, gap: 10 },
  back: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingRight: 12 },
  backText: { ...type.button, color: colors.accent },
  title: { ...type.title, color: colors.ink, padding: 0, marginTop: 4 },
  meta: { ...type.body, color: colors.faint },
  missing: { ...type.body, color: colors.danger, marginTop: 12 },
  player: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10,
    padding: 14, borderRadius: 14, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line,
  },
  play: {
    width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  playGlyph: {
    width: 0, height: 0, marginLeft: 4,
    borderTopWidth: 10, borderBottomWidth: 10, borderLeftWidth: 16,
    borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: '#fff',
  },
  pauseGlyph: { flexDirection: 'row', gap: 5 },
  pauseBar: { width: 5, height: 18, borderRadius: 2, backgroundColor: '#fff' },
  track: { flex: 1, gap: 6 },
  trackBase: { height: 5, borderRadius: 3, backgroundColor: 'rgba(19,27,46,0.1)', overflow: 'hidden' },
  trackFill: { height: 5, borderRadius: 3, backgroundColor: colors.accent },
  time: { ...type.mono, color: colors.faint },
  label: { ...type.label, color: colors.faint, marginTop: 18 },
  notes: {
    minHeight: 180, padding: 14, borderRadius: 14, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line, color: colors.ink, fontSize: 15, lineHeight: 22,
  },
  delete: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: 18 },
  deleteText: { ...type.button, color: colors.danger },
});
