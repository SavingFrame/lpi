import { useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import type { MobileMessages } from '../../lib/messages';
import { colors } from '../../theme/colors';
import { RuntimeButton } from './runtime-button';

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
  const available = enabled && messages.commands.canStop(generation);
  return (
    <RuntimeButton
      label={command.pending ? 'Stopping runtime' : 'Stop runtime'}
      hint="Stops the Pi process after confirmation. Saved history is kept."
      pending={command.pending}
      color={colors.error}
      disabled={!available}
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
    />
  );
}
