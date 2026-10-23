import { type ReactNode, useEffect, useSyncExternalStore } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MobileRelay } from '../../lib/relay';
import { colors } from '../../theme/colors';
import { RuntimeButton } from './runtime-button';

export function ResumeSession({
  client,
  id,
  enabled,
  onOpen,
  renderHeader,
}: {
  client: MobileRelay;
  id: string;
  enabled: boolean;
  onOpen: (open: boolean) => void;
  renderHeader: (runtimeControl: ReactNode) => ReactNode;
}) {
  const state = useSyncExternalStore(client.launches.subscribe, () => client.launches.getState(id));
  useEffect(() => {
    void client.launches.initialize(id);
  }, [client, id]);
  return (
    <>
      {renderHeader(
        <RuntimeButton
          label={state.status === 'pending' ? 'Resuming runtime' : 'Resume runtime'}
          hint="Starts Pi on this saved session after confirmation that no runtime still uses it."
          pending={state.status === 'pending'}
          disabled={!enabled || state.status !== 'ready'}
          color={colors.success}
          onPress={() => {
            onOpen(true);
            Alert.alert(
              'Resume runtime?',
              'Confirm no Pi process is still using this session, including terminals outside lpi. lpi checks managed tmux reservations but cannot detect every external writer. Resuming starts Pi on the existing session file.',
              [
                { text: 'Cancel', style: 'cancel', onPress: () => onOpen(false) },
                {
                  text: 'Confirm offline and resume',
                  onPress: () => {
                    onOpen(false);
                    void client.resumeSession(id);
                  },
                },
              ],
              { cancelable: true, onDismiss: () => onOpen(false) },
            );
          }}
        />,
      )}
      {(state.error || state.status === 'uncertain') && (
        <View style={styles.container}>
          {state.error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {state.error.message}
            </Text>
          )}
          {state.status === 'uncertain' && (
            <>
              <Text style={styles.hint}>
                Resume outcome unknown. Inspect this session and tmux -L lpi list-sessions on the
                relay host before trying again.
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={!enabled}
                onPress={() => {
                  onOpen(true);
                  Alert.alert(
                    'Clear resume warning?',
                    'This does not stop Pi or retry resume.',
                    [
                      { text: 'Cancel', style: 'cancel', onPress: () => onOpen(false) },
                      {
                        text: 'I inspected the runtimes',
                        onPress: () => {
                          onOpen(false);
                          void client.launches.review(id);
                        },
                      },
                    ],
                    { cancelable: true, onDismiss: () => onOpen(false) },
                  );
                }}
              >
                <Text style={[styles.action, !enabled && styles.disabled]}>
                  Review unknown outcome
                </Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.error, fontSize: 13 },
  action: { color: colors.accent, fontSize: 14, paddingVertical: 12 },
  disabled: { opacity: 0.4 },
});
