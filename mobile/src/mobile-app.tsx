import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Text, YStack } from 'tamagui';
import { linkedSessionId } from '../../src/shared/session-link';
import { ConnectionForm } from './features/connection/form';
import { SessionShell } from './features/sessions/shell';
import { RelayConnection, serverPreferenceKey } from './lib/connection';
import { checkServer, createRelay, nativeStorage } from './lib/native';
import type { MobileRelay } from './lib/relay';
import { relayOrigin } from './lib/server';
import { colors } from './theme/colors';

export function MobileApp({
  sessionLink,
  onSessionLinkConsumed,
}: {
  sessionLink?: string | string[];
  onSessionLinkConsumed: () => void;
}) {
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
    if (booting || sessionLink === undefined) {
      return;
    }
    const id = linkedSessionId(sessionLink);
    if (!id) {
      setError('Invalid session notification link.');
      onSessionLinkConsumed();
    } else if (client) {
      setSettings(false);
      setError(null);
      client.openSession(id);
      onSessionLinkConsumed();
    }
    // Without a configured relay, keep the request until connection setup completes.
  }, [booting, client, sessionLink, onSessionLinkConsumed]);

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

  const [connection] = useState(
    () =>
      new RelayConnection({
        storage: nativeStorage,
        check: checkServer,
        accept: (origin) => {
          setClient(getClient(origin));
          setSettings(false);
          setError(null);
        },
      }),
  );
  useEffect(() => () => connection.cancel(), [connection]);

  function closeSettings() {
    connection.cancel();
    setSettings(false);
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
        <SessionShell
          key={client.origin}
          client={client}
          visible={!settings}
          sessionLink={sessionLink}
          onSettings={() => setSettings(true)}
        />
      ) : (
        <ConnectionForm initialValue="" connection={connection} />
      )}
      <Modal visible={settings} animationType="slide" onRequestClose={closeSettings}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          <Button margin={16} alignSelf="flex-start" onPress={closeSettings}>
            Close settings
          </Button>
          {settings && (
            <ConnectionForm initialValue={client?.origin ?? ''} connection={connection} />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
