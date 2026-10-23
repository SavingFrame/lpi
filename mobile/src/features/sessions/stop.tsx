import { useSyncExternalStore } from 'react';
import type { MobileMessages } from '../../lib/messages';
import { colors } from '../../theme/colors';
import { RuntimeButton } from './runtime-button';

export function StopSession({
  messages,
  generation,
  enabled,
}: {
  messages: MobileMessages;
  generation: number;
  enabled: boolean;
}) {
  const command = useSyncExternalStore(messages.commands.subscribe, messages.commands.getState);
  const available = enabled && messages.commands.canStop(generation);
  return (
    <RuntimeButton
      label={command.pending ? 'Stopping runtime' : 'Stop runtime'}
      hint="Interrupts active work and stops the Pi process immediately. Saved history is kept."
      pending={command.pending}
      color={colors.error}
      disabled={!available}
      onPress={() => void messages.stopRuntime(generation)}
    />
  );
}
