import { useEffect, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import {
  deleteRecording, fileRecording, recordingFile, renameRecording, saveNotes,
} from './store';
import { colors, lift, toneFor, type } from './theme';
import { duration, fileSize, shortDate } from './util';

export default function DetailScreen({ recording, classes = [], onBack, onChanged }) {
  const file = recordingFile(recording.file_name);
  const player = useAudioPlayer(file.exists ? file.uri : null);
  const status = useAudioPlayerStatus(player);
  const [title, setTitle] = useState(recording.title);
  const [notes, setNotes] = useState(recording.notes ?? '');
  const [classId, setClassId] = useState(recording.class_id ?? null);

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

  async function file_(next) {
    setClassId(next);
    await fileRecording(recording.id, next);
    onChanged();
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Pressable onPress={onBack} style={styles.back} hitSlop={8}>
          <Svg width={20} height={20} viewBox="0 0 20 20">
            <Path d="M12 4.5 6.5 10l5.5 5.5" fill="none" stroke={colors.accent}
              strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          <Text style={styles.backText}>Lectures</Text>
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
          <View style={[styles.player, lift[1]]}>
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

        {classes.length > 0 && (
          <>
            <Text style={styles.label}>Class</Text>
            <View style={styles.chips}>
              <Pressable
                onPress={() => file_(null)}
                style={[styles.chip, classId === null && styles.chipOn]}
              >
                <Text style={[styles.chipText, classId === null && styles.chipTextOn]}>Unfiled</Text>
              </Pressable>
              {classes.map((folder) => {
                const on = classId === folder.id;
                return (
                  <Pressable
                    key={folder.id}
                    onPress={() => file_(folder.id)}
                    style={[
                      styles.chip,
                      on && { backgroundColor: toneFor(folder.color).sleeve, borderColor: toneFor(folder.color).edge },
                    ]}
                  >
                    <View style={[styles.chipDot, { backgroundColor: toneFor(folder.color).a }]} />
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{folder.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
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
  back: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    alignSelf: 'flex-start', minHeight: 44, paddingRight: 12,
  },
  backText: { ...type.button, color: colors.accent },
  title: { ...type.title, fontSize: 27, color: colors.ink, padding: 0, marginTop: 4 },
  meta: { ...type.body, color: colors.faint },
  missing: { ...type.body, color: colors.danger, marginTop: 12 },
  player: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10,
    padding: 14, borderRadius: 16, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.glassBorder,
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
  label: { ...type.label, color: colors.soft, marginTop: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    minHeight: 38, paddingHorizontal: 13, borderRadius: 19,
    borderWidth: 1, borderColor: colors.edge, backgroundColor: 'rgba(255,255,255,.66)',
  },
  chipOn: { backgroundColor: colors.navy, borderColor: colors.navyDeep },
  chipDot: { width: 9, height: 9, borderRadius: 5 },
  chipText: { fontSize: 13.5, fontWeight: '600', color: colors.soft },
  chipTextOn: { color: '#fff' },
  notes: {
    minHeight: 180, padding: 14, borderRadius: 16, backgroundColor: '#fff',
    borderWidth: 1, borderColor: '#bdcce0', color: colors.ink, fontSize: 15, lineHeight: 22,
  },
  delete: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', marginTop: 18 },
  deleteText: { ...type.button, color: colors.danger },
});
