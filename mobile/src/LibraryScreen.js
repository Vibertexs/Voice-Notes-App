import { useState } from 'react';
import {
  Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import ClassCard from './ClassCard';
import { CLASS_COLORS, colors, lift, toneFor, type } from './theme';
import { duration, fileSize, shortDate } from './util';

function Chevron({ color = colors.ink, size = 20 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20">
      <Path d="M12 4.5 6.5 10l5.5 5.5" fill="none" stroke={color}
        strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** The lecture card: navy, so recordings feel like the valuable half. */
function LectureCard({ item, onOpen }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.lecture, lift[2], pressed && styles.lecturePressed]}
      onPress={() => onOpen(item.id)}
      accessibilityLabel={`Open lecture ${item.title}`}
    >
      <Svg width={22} height={22} viewBox="0 0 24 24">
        <Path d="M6 10v4M10 7v10M14 9v6M18 5v14" fill="none" stroke="#7fb0ff"
          strokeWidth={2.2} strokeLinecap="round" />
      </Svg>
      <Text style={styles.lectureTitle} numberOfLines={2}>{item.title}</Text>
      <Text style={styles.lectureCopy}>
        {shortDate(item.created_at)} · {duration(item.duration_ms)}
      </Text>
      <Text style={styles.lectureFoot}>{fileSize(item.size_bytes)}</Text>
      {item.status === 'recovered' && <Text style={styles.tag}>recovered</Text>}
    </Pressable>
  );
}

export default function LibraryScreen({
  classes, recordings, openClass, recovered,
  onOpen, onRecord, onOpenClass, onNewClass,
  onArchiveClass, onRecolorClass, onDeleteClass,
  showArchived, onToggleArchived,
}) {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftColor, setDraftColor] = useState('blue');

  function confirmDelete(folder) {
    Alert.alert(
      `Delete ${folder.name}?`,
      'The class goes away. Its lectures stay, unfiled.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => onDeleteClass(folder.id) },
      ],
    );
  }

  function submitClass() {
    const name = draft.trim();
    if (!name) return;
    onNewClass(name, draftColor);
    setDraft('');
    setDraftColor('blue');
    setNaming(false);
  }

  const count = recordings.length;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          {openClass ? <Text style={styles.eyebrow}>Class</Text> : null}
          <Text style={styles.title}>
            {openClass ? openClass.name : showArchived ? 'Archived' : 'Your classes'}
          </Text>
          <Text style={styles.muted}>
            {openClass
              ? `${count} lecture${count === 1 ? '' : 's'}`
              : 'Everything here lives on this phone.'}
          </Text>
        </View>

        {openClass ? (
          <Pressable style={styles.parentTarget} onPress={() => onOpenClass(null)}>
            <Chevron color={colors.accent} />
            <View style={styles.parentCopy}>
              <Text style={styles.parentStrong}>All classes</Text>
              <Text style={styles.parentSmall}>Back to the library</Text>
            </View>
          </Pressable>
        ) : null}

        {recovered > 0 ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>
              {recovered} recording{recovered === 1 ? '' : 's'} recovered after the app closed unexpectedly.
            </Text>
          </View>
        ) : null}

        {!openClass ? (
          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.eyebrow}>Classes</Text>
                <Text style={styles.h2}>{showArchived ? 'Archived' : 'This term'}</Text>
              </View>
              <Pressable onPress={() => onToggleArchived(!showArchived)} hitSlop={8}>
                <Text style={styles.textButton}>
                  {showArchived ? 'Current classes' : 'View archived'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.grid}>
              {classes.map((folder) => (
                <ClassCard
                  key={folder.id}
                  folder={folder}
                  onOpen={onOpenClass}
                  onArchive={onArchiveClass}
                  onRecolor={onRecolorClass}
                  onDelete={confirmDelete}
                />
              ))}
              {!showArchived ? (
                <Pressable style={styles.addCard} onPress={() => setNaming(true)}>
                  <Text style={styles.addPlus}>+</Text>
                  <Text style={styles.addStrong}>Add a class</Text>
                  <Text style={styles.addSmall}>Biology, Algorithms, whatever you are taking</Text>
                </Pressable>
              ) : null}
              {showArchived && classes.length === 0 ? (
                <Text style={styles.emptyCopy}>Nothing archived yet.</Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {!showArchived ? (
          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <View>
                <Text style={styles.eyebrow}>Lecture notes</Text>
                <Text style={styles.h2}>
                  {count ? `${count} lecture${count === 1 ? '' : 's'}` : 'Start your first lecture'}
                </Text>
              </View>
            </View>

            {count > 0 ? (
              <View style={styles.grid}>
                {recordings.map((item) => (
                  <LectureCard key={item.id} item={item} onOpen={onOpen} />
                ))}
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No lectures here yet</Text>
                <Text style={styles.emptyBody}>
                  Put your phone on the desk, start a recording and lock the screen.
                  It keeps going until you stop it.
                </Text>
              </View>
            )}
          </View>
        ) : null}

        <View style={styles.tail} />
      </ScrollView>

      <Pressable
        style={({ pressed }) => [styles.record, lift[2], pressed && styles.recordPressed]}
        onPress={onRecord}
        accessibilityLabel="New recording"
      >
        <View style={styles.recordDot} />
        <Text style={styles.recordText}>Record &amp; note</Text>
      </Pressable>

      <Modal visible={naming} transparent animationType="fade" onRequestClose={() => setNaming(false)}>
        <Pressable style={styles.backdrop} onPress={() => setNaming(false)}>
          <Pressable style={styles.modal} onPress={() => {}}>
            <Text style={styles.modalTitle}>New class</Text>
            <Text style={styles.sheetLabel}>Name</Text>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              autoFocus
              placeholder="Organic Chemistry"
              placeholderTextColor={colors.faint}
              returnKeyType="done"
              onSubmitEditing={submitClass}
            />
            <Text style={[styles.sheetLabel, { marginTop: 16 }]}>Colour</Text>
            <View style={styles.swatches}>
              {CLASS_COLORS.map((color) => (
                <Pressable
                  key={color}
                  accessibilityLabel={`Colour ${color}`}
                  onPress={() => setDraftColor(color)}
                  style={[
                    styles.swatch,
                    { backgroundColor: toneFor(color).a },
                    color === draftColor && styles.swatchCurrent,
                  ]}
                />
              ))}
            </View>
            <View style={styles.modalActions}>
              <Pressable style={styles.ghost} onPress={() => setNaming(false)}>
                <Text style={styles.ghostText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.primary} onPress={submitClass}>
                <Text style={styles.primaryText}>Create</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  body: { padding: 20, paddingBottom: 12 },
  header: { paddingTop: 8 },
  eyebrow: { ...type.eyebrow, color: '#61708a', marginBottom: 5 },
  title: { ...type.title, color: colors.ink },
  muted: { ...type.body, color: colors.soft, marginTop: 4 },
  h2: { ...type.h2, color: colors.ink, marginTop: 2 },

  parentTarget: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18,
    padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,.62)',
    borderWidth: 1, borderColor: colors.glassBorder,
  },
  parentCopy: { flex: 1 },
  parentStrong: { ...type.button, color: colors.ink },
  parentSmall: { fontSize: 12, color: colors.faint, marginTop: 1 },

  banner: {
    marginTop: 16, padding: 12, borderRadius: 12,
    backgroundColor: 'rgba(42,99,221,.1)',
  },
  bannerText: { ...type.body, color: colors.accentDeep },

  section: { marginTop: 34 },
  sectionHeading: {
    flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'space-between', marginBottom: 14, gap: 12,
  },
  textButton: { ...type.button, fontSize: 13, color: colors.accent },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14 },

  addCard: {
    width: '47.5%', aspectRatio: 5 / 6,
    alignItems: 'center', justifyContent: 'center', gap: 4, padding: 14,
    borderWidth: 3, borderColor: '#aebfd7', borderStyle: 'dashed', borderRadius: 22,
    backgroundColor: 'rgba(250,252,255,.42)',
  },
  addPlus: { fontSize: 28, fontWeight: '300', color: '#415b83' },
  addStrong: { ...type.button, color: '#415b83' },
  addSmall: { fontSize: 11.5, lineHeight: 16, color: colors.faint, textAlign: 'center' },
  emptyCopy: { ...type.body, color: colors.soft },

  lecture: {
    width: '47.5%', minHeight: 160, padding: 14,
    borderRadius: 20, borderWidth: 4, borderColor: colors.edge,
    backgroundColor: colors.navy,
  },
  lecturePressed: { opacity: 0.9 },
  lectureTitle: { ...type.heading, fontSize: 16, color: '#f8fbff', marginTop: 'auto', marginBottom: 5 },
  lectureCopy: { fontSize: 12.5, lineHeight: 17, color: 'rgba(206,216,240,.7)' },
  lectureFoot: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6, color: '#7fb0ff', marginTop: 6 },
  tag: {
    position: 'absolute', top: 12, right: 12, fontSize: 10, fontWeight: '800',
    color: '#0b1027', backgroundColor: '#ffd479',
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, overflow: 'hidden',
  },

  empty: {
    alignItems: 'center', paddingVertical: 40, paddingHorizontal: 18,
    borderRadius: 20, backgroundColor: 'rgba(255,255,255,.55)',
    borderWidth: 1, borderColor: colors.glassBorder,
  },
  emptyTitle: { ...type.h2, fontSize: 18, color: colors.ink },
  emptyBody: { ...type.body, color: colors.soft, textAlign: 'center', marginTop: 8 },

  tail: { height: 96 },

  record: {
    position: 'absolute', left: 20, right: 20, bottom: 24,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    minHeight: 56, borderRadius: 16, backgroundColor: colors.accent,
  },
  recordPressed: { backgroundColor: colors.accentDeep },
  recordDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#fff' },
  recordText: { ...type.button, fontSize: 16, color: '#fff' },

  backdrop: { flex: 1, backgroundColor: 'rgba(8,17,40,.42)', justifyContent: 'center', padding: 20 },
  modal: {
    padding: 20, borderRadius: 20, backgroundColor: '#f5f8fd',
    borderWidth: 1, borderColor: colors.glassBorder,
  },
  modalTitle: { ...type.h2, color: colors.ink, marginBottom: 14 },
  sheetLabel: { ...type.label, color: colors.soft, marginBottom: 8 },
  input: {
    minHeight: 48, paddingHorizontal: 13, borderRadius: 11,
    borderWidth: 1, borderColor: '#bdcce0', backgroundColor: '#fff',
    color: colors.ink, fontSize: 15,
  },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 3, borderColor: 'transparent' },
  swatchCurrent: { borderColor: colors.ink },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 22 },
  ghost: { minHeight: 46, paddingHorizontal: 18, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  ghostText: { ...type.button, color: colors.soft },
  primary: {
    minHeight: 46, paddingHorizontal: 22, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent,
  },
  primaryText: { ...type.button, color: '#fff' },
});
