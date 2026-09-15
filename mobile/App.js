import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import DetailScreen from './src/DetailScreen';
import LibraryScreen from './src/LibraryScreen';
import RecordScreen from './src/RecordScreen';
import { getRecording, listRecordings, openStore, recoverInterrupted } from './src/store';
import { colors, type } from './src/theme';

/**
 * Class Notes — everything on the phone.
 *
 * Three screens, no router: the flows are linear and a router would be more
 * machinery than the app has states.
 */
export default function App() {
  const [screen, setScreen] = useState({ name: 'loading' });
  const [recordings, setRecordings] = useState([]);
  const [recovered, setRecovered] = useState(0);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setRecordings(await listRecordings());
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await openStore();
        // A lecture interrupted by the OS should come back, not vanish.
        const adopted = await recoverInterrupted();
        setRecovered(adopted.length);
        await refresh();
        setScreen({ name: 'library' });
      } catch (caught) {
        setError(String(caught?.message ?? caught));
      }
    })();
  }, [refresh]);

  const open = useCallback(async (id) => {
    const recording = await getRecording(id);
    if (recording) setScreen({ name: 'detail', recording });
  }, []);

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
          recordings={recordings}
          recovered={recovered}
          onOpen={open}
          onRecord={() => { setRecovered(0); setScreen({ name: 'record' }); }}
        />
      )}
      {screen.name === 'detail' && (
        <DetailScreen
          recording={screen.recording}
          onBack={async () => { await refresh(); setScreen({ name: 'library' }); }}
          onChanged={refresh}
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
