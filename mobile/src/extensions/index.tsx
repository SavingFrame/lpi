import { ScrollView, StyleSheet } from 'react-native';
import type { ExtensionSnapshots } from '../../../src/extension-support/registry';
import type { MobileMessages } from '../lib/messages';
import { AskQuestionnaire } from './ask-user-question';

/** Explicit mobile registrations. Never import browser components or native Pi here. */
export function MobileExtensionPanels({
  extensions,
  messages,
  enabled,
  onOpen,
}: {
  extensions: ExtensionSnapshots;
  messages: MobileMessages;
  enabled: boolean;
  onOpen: (open: boolean) => void;
}) {
  const prompts = extensions['ask-user-question'] ?? [];
  if (!prompts.length) {
    return null;
  }
  return (
    <ScrollView style={styles.panels} keyboardShouldPersistTaps="handled">
      {prompts.map((prompt) => (
        <AskQuestionnaire
          key={prompt.toolCallId}
          prompt={prompt}
          messages={messages}
          enabled={enabled}
          onOpen={onOpen}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ panels: { maxHeight: 120, flexGrow: 0 } });
