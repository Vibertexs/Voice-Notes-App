import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, type } from './theme';
import { duration, fileSize, shortDate } from './util';

export default function LibraryScreen({ recordings, onOpen, onRecord, recovered }) {
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>On this phone</Text>
        <Text style={styles.title}>Lectures</Text>
        <Text style={styles.sub}>
          {recordings.length === 0
            ? 'Nothing recorded yet.'
            : `${recordings.length} recording${recordings.length === 1 ? '' : 's'}`}
        </Text>
      </View>

      {recovered > 0 && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            {recovered} recording{recovered === 1 ? '' : 's'} recovered after the app closed unexpectedly.
          </Text>
        </View>
      )}

      <FlatList
        data={recordings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Put your phone on the desk</Text>
            <Text style={styles.emptyBody}>
              Start a recording and lock the screen. It keeps going until you stop it.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onOpen(item.id)}>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.rowMeta}>
                {shortDate(item.created_at)} · {duration(item.duration_ms)} · {fileSize(item.size_bytes)}
              </Text>
            </View>
            {item.status === 'recovered' && <Text style={styles.tag}>recovered</Text>}
          </Pressable>
        )}
      />

      <Pressable style={styles.record} onPress={onRecord} accessibilityLabel="New recording">
        <View style={styles.recordDot} />
        <Text style={styles.recordText}>Record</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  eyebrow: { ...type.label, color: colors.faint },
  title: { ...type.title, color: colors.ink, marginTop: 2 },
  sub: { ...type.body, color: colors.soft, marginTop: 2 },
  banner: {
    marginHorizontal: 20, marginBottom: 8, padding: 12, borderRadius: 10,
    backgroundColor: 'rgba(42,99,221,0.1)',
  },
  bannerText: { ...type.body, color: colors.accentDeep },
  list: { padding: 20, paddingTop: 8, gap: 10 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 12, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line,
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowTitle: { ...type.heading, color: colors.ink },
  rowMeta: { ...type.body, color: colors.faint, marginTop: 3 },
  tag: {
    ...type.body, fontSize: 11, color: colors.accentDeep,
    backgroundColor: 'rgba(42,99,221,0.12)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  empty: { alignItems: 'center', paddingVertical: 64, paddingHorizontal: 24 },
  emptyTitle: { ...type.heading, color: colors.ink },
  emptyBody: { ...type.body, color: colors.soft, textAlign: 'center', marginTop: 6 },
  record: {
    position: 'absolute', left: 20, right: 20, bottom: 28,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    minHeight: 56, borderRadius: 16, backgroundColor: colors.accent,
  },
  recordDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#fff' },
  recordText: { ...type.button, fontSize: 16, color: '#fff' },
});
