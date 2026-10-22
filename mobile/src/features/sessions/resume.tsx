import { useEffect, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MobileRelay } from '../../lib/relay';
import { colors } from '../../theme/colors';

export function ResumeSession({
  client,
  id,
  enabled,
}: {
  client: MobileRelay;
  id: string;
  enabled: boolean;
}) {
  const state = useSyncExternalStore(client.launches.subscribe, () => client.launches.getState(id));
  useEffect(() => {
    void client.launches.initialize(id);
  }, [client, id]);
  return (
    <View style={styles.container}>
      <Text style={styles.hint}>Saved session. Disconnection does not prove Pi has stopped.</Text>
      {state.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {state.error.message}
        </Text>
      )}
      {state.status === 'uncertain' ? (
        <>
          <Text style={styles.hint}>
            Resume outcome unknown. Inspect this session and tmux -L pim list-sessions on the relay
            host before trying again.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={!enabled}
            onPress={() =>
              Alert.alert('Clear resume warning?', 'This does not stop Pi or retry resume.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'I inspected the runtimes',
                  onPress: () => void client.launches.review(id),
                },
              ])
            }
          >
            <Text style={[styles.action, !enabled && styles.disabled]}>Review unknown outcome</Text>
          </Pressable>
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resume saved session"
          disabled={!enabled || state.status !== 'ready'}
          style={[styles.button, (!enabled || state.status !== 'ready') && styles.disabled]}
          onPress={() =>
            Alert.alert(
              'Resume saved session?',
              'Confirm no Pi process is still using this session, including terminals outside Pim. Pim checks managed tmux reservations but cannot detect every external writer. Resuming starts Pi on the existing session file.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Confirm offline and resume',
                  onPress: () => void client.resumeSession(id),
                },
              ],
            )
          }
        >
          {state.status === 'pending' ? <ActivityIndicator color={colors.accent} /> : null}
          <Text style={styles.action}>
            {state.status === 'pending' ? 'Waiting for Pi…' : 'Resume session'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.error, fontSize: 13 },
  action: { color: colors.accent, fontSize: 14, paddingVertical: 12 },
  button: { flexDirection: 'row', gap: 8, alignItems: 'center', minHeight: 44 },
  disabled: { opacity: 0.4 },
});
