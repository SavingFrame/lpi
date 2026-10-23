import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { InventorySession } from '../../../../src/shared/sessions';
import type { MobileMessages } from '../../lib/messages';
import { colors } from '../../theme/colors';
import { RuntimeButton } from './runtime-button';
import { StopSession } from './stop';

export function InventoryAction({
  session,
  messages,
  online,
  onArchive,
}: {
  session: InventorySession;
  messages: MobileMessages;
  online: boolean;
  onArchive: (id: string, archived: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const command = useSyncExternalStore(messages.commands.subscribe, messages.commands.getState);
  useEffect(() => {
    void messages.commands.initialize();
  }, [messages]);
  const connected = session.connection === 'connected' && !session.archived;
  return (
    <View style={styles.action}>
      {connected ? (
        <StopSession
          messages={messages}
          generation={session.generation}
          enabled={
            online && session.managedRuntime && command.shutdownGeneration !== session.generation
          }
        />
      ) : (
        <RuntimeButton
          label={`${session.archived ? 'Restore' : 'Archive'} session: ${session.title || 'Untitled session'}`}
          hint={
            session.archived
              ? 'Return this session to the session list.'
              : 'Hide this session. History is preserved.'
          }
          icon={session.archived ? 'restore' : 'archive'}
          color={colors.muted}
          pending={pending}
          disabled={!online || pending}
          onPress={async () => {
            setPending(true);
            try {
              await onArchive(session.id, !session.archived);
            } catch (error) {
              Alert.alert('Session visibility was not confirmed', String(error));
            } finally {
              setPending(false);
            }
          }}
        />
      )}
      {connected && !session.managedRuntime && <Text style={styles.label}>Terminal</Text>}
      {command.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {command.error.message}
        </Text>
      )}
      {command.uncertain && (
        <Pressable
          accessibilityRole="button"
          disabled={!online}
          onPress={() => void messages.commands.review()}
        >
          <Text style={styles.label}>I inspected the runtime</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  action: { width: 44, alignItems: 'center', paddingTop: 5 },
  label: { color: colors.muted, fontSize: 10 },
  error: { color: colors.error, fontSize: 10 },
});
