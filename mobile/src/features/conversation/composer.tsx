import { useEffect, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MobileMessages } from '../../lib/messages';
import { colors } from '../../theme/colors';
import { AttachmentPicker } from './attachments';

export function MessageComposer({
  messages,
  running,
  picking,
  onPicking,
}: {
  messages: MobileMessages;
  running: boolean;
  picking: boolean;
  onPicking: (busy: boolean) => void;
}) {
  const command = useSyncExternalStore(messages.commands.subscribe, messages.commands.getState);
  const draft = useSyncExternalStore(messages.draft.subscribe, messages.draft.getState);
  useEffect(() => {
    void messages.initialize();
  }, [messages]);
  const available = messages.commands.available();
  const hasContent = Boolean(draft.draft.text.trim() || draft.draft.images.length);
  const stopping = running && !hasContent;
  const enabled =
    !picking && available && (stopping || (!draft.loading && !draft.error && hasContent));
  return (
    <View style={styles.container}>
      {command.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {command.error.message}
        </Text>
      )}
      {command.outcome && <Text style={styles.warning}>{command.outcome}</Text>}
      {command.uncertain && (
        <>
          <Text style={styles.warning}>
            The previous command may have executed. Inspect the conversation before sending again.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={command.pending}
            onPress={() =>
              Alert.alert(
                'Allow new commands?',
                'Confirm you inspected the conversation. This clears the safety block but does not resend anything.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'I inspected the conversation',
                    onPress: () => void messages.commands.review(),
                  },
                ],
              )
            }
          >
            <Text style={styles.action}>Review unknown outcome</Text>
          </Pressable>
        </>
      )}
      <AttachmentPicker
        draft={messages.draft}
        disabled={draft.loading || command.pending || command.uncertain}
        onBusy={onPicking}
      >
        <TextInput
          accessibilityLabel="Message"
          multiline
          editable={!draft.loading}
          placeholder="What should Pi work on?"
          placeholderTextColor={colors.muted}
          value={draft.draft.text}
          onChangeText={(text) => messages.draft.update((current) => ({ ...current, text }))}
          style={styles.input}
        />
        {draft.error && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Draft storage failed. Retry saving draft"
            style={styles.retry}
            onPress={() =>
              Alert.alert('Draft not saved', 'Keep the app open to preserve your edits.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Retry', onPress: () => void messages.draft.retry() },
              ])
            }
          >
            <Text style={styles.error}>!</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            command.pending ? 'Submitting' : stopping ? 'Stop Pi' : 'Send message'
          }
          accessibilityState={{ disabled: !enabled, busy: command.pending }}
          disabled={!enabled}
          style={[styles.button, !enabled && styles.disabled]}
          onPress={() => {
            if (stopping) {
              void messages.commands.submit({ type: 'abort' });
            } else {
              void messages.send();
            }
          }}
        >
          {command.pending ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : stopping ? (
            <View style={styles.stopIcon} />
          ) : (
            <Text style={styles.sendIcon}>↑</Text>
          )}
        </Pressable>
      </AttachmentPicker>
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
  input: {
    flex: 1,
    color: colors.text,
    padding: 12,
    minHeight: 48,
    maxHeight: 160,
    fontSize: 16,
  },
  button: {
    height: 44,
    width: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retry: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  sendIcon: { color: colors.background, fontSize: 28, lineHeight: 32, fontWeight: '600' },
  stopIcon: { width: 14, height: 14, borderRadius: 2, backgroundColor: colors.background },
  action: { color: colors.accent, fontSize: 14, paddingVertical: 8 },
  disabled: { opacity: 0.35 },
  error: { color: colors.error, fontSize: 13 },
  warning: { color: colors.blocked, fontSize: 13 },
});
