import { useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import ClassFolderArt from './ClassFolderArt';
import { CLASS_COLORS, colors, lift, toneFor, type } from './theme';

/**
 * A class, drawn as the same navy sleeve and folder the web app uses.
 *
 * The web card reveals its actions on hover. A phone has no hover, so the dial
 * sits at the web's resting opacity permanently, and its menu is a sheet rather
 * than a popover — a popover anchored to a card in a scroll view ends up
 * off-screen on a narrow display.
 */
export default function ClassCard({ folder, onOpen, onArchive, onRecolor, onDelete }) {
  const [menu, setMenu] = useState(false);
  const press = useRef(new Animated.Value(0)).current;
  const tone = toneFor(folder.color);

  const lectures = folder.lecture_count ?? 0;
  const summary = lectures === 0 ? 'Nothing recorded yet' : `${lectures} lecture${lectures === 1 ? '' : 's'}`;

  // The web card lifts on hover; touch gets the equivalent acknowledgement on
  // press, using the same spring easing.
  const animate = (to) => Animated.spring(press, {
    toValue: to, useNativeDriver: true, speed: 40, bounciness: 6,
  }).start();

  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.965] });

  return (
    <View style={styles.wrap}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          onPress={() => onOpen(folder.id)}
          onPressIn={() => animate(1)}
          onPressOut={() => animate(0)}
          accessibilityLabel={`Open ${folder.name}`}
          style={[styles.card, { backgroundColor: tone.sleeve, borderColor: tone.edge }, lift[3]]}
        >
          <View style={styles.stage}>
            <ClassFolderArt tone={tone} width={132} height={95} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.name} numberOfLines={1}>{folder.name}</Text>
            <Text style={styles.meta} numberOfLines={1}>{summary}</Text>
          </View>
        </Pressable>
      </Animated.View>

      <Pressable
        style={styles.dial}
        onPress={() => setMenu(true)}
        hitSlop={10}
        accessibilityLabel={`Options for ${folder.name}`}
      >
        <View style={styles.dialDot} />
      </Pressable>

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenu(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{folder.name}</Text>

            <Text style={styles.sheetLabel}>Colour</Text>
            <View style={styles.swatches}>
              {CLASS_COLORS.map((color) => {
                const swatchTone = toneFor(color);
                const current = color === folder.color;
                return (
                  <Pressable
                    key={color}
                    accessibilityLabel={`Colour ${color}`}
                    onPress={() => { onRecolor(folder.id, color); setMenu(false); }}
                    style={[
                      styles.swatch,
                      { backgroundColor: swatchTone.a },
                      current && styles.swatchCurrent,
                    ]}
                  />
                );
              })}
            </View>

            <Pressable
              style={styles.item}
              onPress={() => { onArchive(folder.id, !folder.archived); setMenu(false); }}
            >
              <Text style={styles.itemText}>{folder.archived ? 'Restore class' : 'Archive class'}</Text>
            </Pressable>
            <Pressable style={styles.item} onPress={() => { setMenu(false); onDelete(folder); }}>
              <Text style={[styles.itemText, styles.danger]}>Delete class</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  card: {
    aspectRatio: 5 / 6, borderRadius: 22, borderWidth: 1,
    padding: 14, justifyContent: 'space-between', overflow: 'hidden',
  },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  copy: { gap: 2 },
  name: { ...type.heading, fontSize: 15.5, fontWeight: '700', color: '#fff' },
  meta: { fontSize: 12.5, color: 'rgba(210,218,248,.66)' },
  dial: {
    position: 'absolute', right: 12, bottom: 12,
    width: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,.22)',
    backgroundColor: 'rgba(255,255,255,.12)', opacity: 0.74,
  },
  dialDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: 'rgba(255,255,255,.85)' },

  backdrop: { flex: 1, backgroundColor: 'rgba(8,17,40,.42)', justifyContent: 'flex-end' },
  sheet: {
    padding: 20, paddingBottom: 34,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    backgroundColor: '#f9fcff', borderWidth: 1, borderColor: colors.edge,
  },
  sheetTitle: { ...type.h2, color: colors.ink, marginBottom: 14 },
  sheetLabel: { ...type.label, color: colors.soft, marginBottom: 8 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 3, borderColor: 'transparent' },
  swatchCurrent: { borderColor: colors.ink },
  item: { minHeight: 50, justifyContent: 'center', borderTopWidth: 1, borderTopColor: colors.line },
  itemText: { ...type.button, color: colors.ink },
  danger: { color: colors.danger },
});
