import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import DetailScreen from './src/DetailScreen';
import LibraryScreen from './src/LibraryScreen';
import RecordScreen from './src/RecordScreen';
import {
  archiveClass, createClass, deleteClass, getRecording, listClasses, listRecordings,
  openStore, recolorClass, recoverInterrupted,
} from './src/store';
import { colors, type } from './src/theme';
import { newId } from './src/util';

/**
 * Class Notes — everything on the phone.
 *
 * Three screens, no router: the flows are linear and a router would be more
 * machinery than the app has states. The library mirrors the web client's
 * shape — classes, then the lectures filed under them.
 */
export default function App() {
  const [screen, setScreen] = useState({ name: 'loading' });
  const [classes, setClasses] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [openClass, setOpenClass] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [recovered, setRecovered] = useState(0);
  const [error, setError] = useState('');

  const refresh = useCallback(async (folder = openClass, archived = showArchived) => {
    setClasses(await listClasses({ archived }));
    // Inside a class show only its lectures; at the top level show everything,
    // so a recording is never invisible just because it has not been filed.
    setRecordings(await listRecordings(folder ? { classId: folder.id } : {}));
  }, [openClass, showArchived]);

  useEffect(() => {
    (async () => {
      try {
        await openStore();
        // A lecture interrupted by the OS should come back, not vanish.
        const adopted = await recoverInterrupted();
        setRecovered(adopted.length);
        await refresh(null, false);
        setScreen({ name: 'library' });
      } catch (caught) {
        setError(String(caught?.message ?? caught));
      }
    })();
    // Runs once: refresh is recreated per filter change, which must not re-open the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = useCallback(async (id) => {
    const recording = await getRecording(id);
    if (recording) setScreen({ name: 'detail', recording });
  }, []);

  const chooseClass = useCallback(async (id) => {
    const folder = id ? classes.find((item) => item.id === id) ?? null : null;
    setOpenClass(folder);
    await refresh(folder, showArchived);
  }, [classes, refresh, showArchived]);

  const toggleArchived = useCallback(async (next) => {
    setShowArchived(next);
    setOpenClass(null);
    await refresh(null, next);
  }, [refresh]);

  const addClass = useCallback(async (name, color) => {
    await createClass({ id: newId(), name, color, createdAt: new Date().toISOString() });
    await refresh(openClass, showArchived);
  }, [refresh, openClass, showArchived]);

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorTitle}>Class Notes could not start</Text>
        <Text style={styles.errorBody}>{error}</Text>
      </SafeAreaView>
    );
  }

  if (screen.name === 'loading') {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (screen.name === 'record') {
    return (
      <View style={styles.dark}>
        <StatusBar barStyle="light-content" />
        <SafeAreaView style={styles.dark}>
          <RecordScreen
            classId={openClass?.id ?? null}
            onSaved={async (id) => { await refresh(); open(id); }}
            onCancel={async () => { await refresh(); setScreen({ name: 'library' }); }}
          />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.light}>
      <StatusBar barStyle="dark-content" />
      {screen.name === 'library' && (
        <LibraryScreen
          classes={classes}
          recordings={recordings}
          openClass={openClass}
          recovered={recovered}
          showArchived={showArchived}
          onOpen={open}
          onRecord={() => { setRecovered(0); setScreen({ name: 'record' }); }}
          onOpenClass={chooseClass}
          onNewClass={addClass}
          onToggleArchived={toggleArchived}
          onArchiveClass={async (id, archived) => {
            await archiveClass(id, archived);
            await refresh(openClass, showArchived);
          }}
          onRecolorClass={async (id, color) => {
            await recolorClass(id, color);
            await refresh(openClass, showArchived);
          }}
          onDeleteClass={async (id) => {
            await deleteClass(id);
            if (openClass?.id === id) setOpenClass(null);
            await refresh(openClass?.id === id ? null : openClass, showArchived);
          }}
        />
      )}
      {screen.name === 'detail' && (
        <DetailScreen
          recording={screen.recording}
          classes={classes}
          onBack={async () => { await refresh(); setScreen({ name: 'library' }); }}
          onChanged={() => refresh()}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  light: { flex: 1, backgroundColor: colors.page },
  dark: { flex: 1, backgroundColor: colors.deep },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.page },
  errorTitle: { ...type.heading, color: colors.ink },
  errorBody: { ...type.body, color: colors.soft, marginTop: 6, textAlign: 'center' },
});
