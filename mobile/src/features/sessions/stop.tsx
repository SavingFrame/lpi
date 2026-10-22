import { useSyncExternalStore } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MobileMessages } from '../../lib/messages';
import { colors } from '../../theme/colors';

export function StopSession({
  messages,
  generation,
  enabled,
  onOpen,
}: {
  messages: MobileMessages;
  generation: number;
  enabled: boolean;
  onOpen: (open: boolean) => void;
}) {
  const command = useSyncExternalStore(messages.commands.subscribe, messages.commands.getState);
  const available = enabled && messages.commands.available();
  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop runtime"
        accessibilityState={{ disabled: !available }}
        disabled={!available}
        style={[styles.button, !available && styles.disabled]}
        onPress={() => {
          onOpen(true);
          Alert.alert(
            'Stop runtime?',
            'Active work will be interrupted. Saved history stays and can be resumed later.',
            [
              { text: 'Cancel', style: 'cancel', onPress: () => onOpen(false) },
              {
                text: 'Stop runtime',
                style: 'destructive',
                onPress: () => {
                  onOpen(false);
                  void messages.stopRuntime(generation);
                },
              },
            ],
            { cancelable: true, onDismiss: () => onOpen(false) },
          );
        }}
      >
        <Text style={styles.label}>{command.pending ? 'Submitting…' : 'Stop runtime'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'flex-end', paddingHorizontal: 12 },
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  label: { color: colors.error, fontSize: 14 },
  disabled: { opacity: 0.4 },
});
