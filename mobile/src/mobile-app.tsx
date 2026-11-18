import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, AppState, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, YStack } from 'tamagui';
import { linkedSessionId } from '../../src/shared/session-link';
import { ConnectionForm } from './features/connection/form';
import { SessionShell } from './features/sessions/shell';
import { createRelay, nativeStorage } from './lib/native';
import { MobileWorkspace } from './lib/workspace';
import { colors } from './theme/colors';

export function MobileApp({
  sessionLink,
  onSessionLinkConsumed,
}: {
  sessionLink?: string | string[];
  onSessionLinkConsumed: () => void;
}) {
  const [workspace] = useState(() => new MobileWorkspace(nativeStorage, createRelay));
  const { devices, focused } = useSyncExternalStore(workspace.subscribe, workspace.getState);
  const [booting, setBooting] = useState(true);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void workspace.load().then(
      () => {
        if (current) {
          setBooting(false);
        }
      },
      () => {
        if (current) {
          setError('Could not load saved relays. Check the addresses in Settings.');
          setBooting(false);
        }
      },
    );
    const update = (state = AppState.currentState) => workspace.setActive(state === 'active');
    const subscription = AppState.addEventListener('change', update);
    update();
    return () => {
      current = false;
      subscription.remove();
      workspace.setActive(false);
    };
  }, [workspace]);

  const count = devices.length;
  useEffect(() => {
    if (booting || sessionLink === undefined) {
      return;
    }
    const id = linkedSessionId(sessionLink);
    if (id && count === 0) {
      return;
    }
    if (!id) {
      setError('Invalid session notification link.');
    } else if (workspace.openLink(id)) {
      setSettings(false);
      setError(null);
    } else {
      setError(
        'This notification does not identify a device. Open the session from the project list.',
      );
    }
    onSessionLinkConsumed();
  }, [booting, count, onSessionLinkConsumed, sessionLink, workspace]);

  if (booting) {
    return (
      <YStack flex={1} backgroundColor={colors.background} justifyContent="center">
        <ActivityIndicator color={colors.accent} />
      </YStack>
    );
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {error && (
        <Text
          accessibilityRole="alert"
          color={colors.error}
          padding={16}
          onPress={() => setError(null)}
        >
          {error}
        </Text>
      )}
      {focused ? (
        <SessionShell
          device={focused}
          devices={devices}
          workspace={workspace}
          visible={!settings}
          sessionLink={sessionLink}
          onSettings={() => setSettings(true)}
        />
      ) : (
        !settings && (
          <ConnectionForm devices={devices} save={workspace.save} onSaved={() => setError(null)} />
        )
      )}
      <Modal visible={settings} animationType="slide" onRequestClose={() => setSettings(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <Button margin={16} alignSelf="flex-start" onPress={() => setSettings(false)}>
            Close settings
          </Button>
          {settings && (
            <ConnectionForm
              devices={devices}
              save={workspace.save}
              onSaved={() => {
                setSettings(false);
                setError(null);
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
