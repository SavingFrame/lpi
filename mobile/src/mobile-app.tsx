import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, YStack } from 'tamagui';
import { ConnectionForm } from './features/connection/form';
import { SessionShell } from './features/sessions/shell';
import { createRelay, nativeStorage, serverPreferenceKey } from './lib/native';
import type { MobileRelay } from './lib/relay';
import { relayOrigin } from './lib/server';
import { colors } from './theme/colors';

export function MobileApp() {
  const clients = useRef(new Map<string, MobileRelay>());
  const [client, setClient] = useState<MobileRelay | null>(null);
  const [booting, setBooting] = useState(true);
  const [settings, setSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getClient = useCallback((origin: string) => {
    let client = clients.current.get(origin);
    if (!client) {
      client = createRelay(origin);
      clients.current.set(origin, client);
    }
    return client;
  }, []);

  useEffect(() => {
    let current = true;
    void nativeStorage
      .getItem(serverPreferenceKey)
      .then(
        (saved) => {
          if (current && saved) {
            try {
              setClient(getClient(relayOrigin(saved)));
            } catch {
              setError('Saved server is invalid. Enter its address again.');
            }
          }
        },
        () => {
          if (current) {
            setError('Server settings could not be loaded.');
          }
        },
      )
      .finally(() => {
        if (current) {
          setBooting(false);
        }
      });
    return () => {
      current = false;
    };
  }, [getClient]);

  useEffect(() => {
    if (!client) {
      return;
    }
    const update = () => {
      if (AppState.currentState === 'active') {
        void client.start();
      } else {
        client.stop();
      }
    };
    update();
    const subscription = AppState.addEventListener('change', update);
    return () => {
      subscription.remove();
      client.stop();
    };
  }, [client]);

  async function connect(value: string) {
    const origin = relayOrigin(value);
    await nativeStorage.setItem(serverPreferenceKey, origin);
    setClient(getClient(origin));
    setSettings(false);
    setError(null);
  }

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
        <Text accessibilityRole="alert" color={colors.error} padding={16}>
          {error}
        </Text>
      )}
      {client ? (
        <SessionShell key={client.origin} client={client} onSettings={() => setSettings(true)} />
      ) : (
        <ConnectionForm initialValue="" onConnect={connect} />
      )}
      <Modal visible={settings} animationType="slide" onRequestClose={() => setSettings(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <Button margin={16} alignSelf="flex-start" onPress={() => setSettings(false)}>
            Close settings
          </Button>
          <ConnectionForm initialValue={client?.origin ?? ''} onConnect={connect} />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
