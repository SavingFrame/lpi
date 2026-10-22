import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  type AskPrompt,
  askAnswer,
} from '../../../src/extension-support/ask-user-question/contract';
import {
  type AskQuestionDraft,
  askDraftAnswer,
  emptyAskDraft,
  selectAskCustom,
  selectAskOption,
} from '../../../src/extension-support/ask-user-question/draft';
import { Markdown } from '../features/conversation/markdown';
import type { MobileMessages } from '../lib/messages';
import { colors } from '../theme/colors';

export function AskQuestionnaire({
  prompt,
  messages,
  enabled,
  onOpen,
}: {
  prompt: AskPrompt;
  messages: MobileMessages;
  enabled: boolean;
  onOpen: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => emptyAskDraft(prompt));
  const [focused, setFocused] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const command = useSyncExternalStore(messages.commands.subscribe, messages.commands.getState);
  useEffect(() => {
    void messages.commands.initialize();
  }, [messages]);
  useEffect(() => {
    if (open) {
      onOpen(true);
      return () => onOpen(false);
    }
  }, [open, onOpen]);
  const disabled = !enabled || !messages.commands.available() || accepted;

  function update(index: number, patch: Partial<AskQuestionDraft>) {
    setError(null);
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, i) =>
        i === index ? { ...question, ...patch } : question,
      ),
    }));
  }

  async function submit(cancel: boolean) {
    if (disabled) {
      return;
    }
    try {
      const answer = cancel
        ? askAnswer({ toolCallId: prompt.toolCallId, cancel: true, globalNote: draft.globalNote })
        : askDraftAnswer(prompt, draft);
      if (await messages.answer(answer)) {
        setAccepted(true);
        setOpen(false);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Invalid answer');
    }
  }

  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.banner}>
        <Text style={styles.action}>
          {accepted ? 'Answer accepted' : 'Pi has questions'} ·{' '}
          {prompt.questions.map((q) => q.header).join(', ')}
        </Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={styles.screen}>
          <KeyboardAvoidingView
            style={styles.screen}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.header}>
              <Text style={styles.title}>Pi has questions</Text>
              <Pressable accessibilityRole="button" onPress={() => setOpen(false)}>
                <Text style={styles.action}>Close</Text>
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
              <Text style={styles.hint}>
                Answer here or in the terminal. The first submitted answer wins. Close keeps this
                draft; it does not cancel.
              </Text>
              {prompt.questions.map((question, index) => {
                const answer = draft.questions[index];
                if (!answer) {
                  return null;
                }
                const preview = question.options[focused[index] ?? 0];
                const showPreview =
                  !question.multiSelect &&
                  !answer.custom &&
                  question.options.some((option) => option.hasPreview);
                return (
                  <View key={question.question} style={styles.question}>
                    <Text style={styles.hint}>{question.header}</Text>
                    <Text style={styles.title}>{question.question}</Text>
                    <Text style={styles.hint}>
                      {question.multiSelect
                        ? 'Choose options, custom text, or both.'
                        : 'Choose one option or type an answer.'}
                    </Text>
                    {question.options.map((option, optionIndex) => {
                      const selected = answer.optionIndexes.includes(optionIndex);
                      return (
                        <Pressable
                          key={option.label}
                          accessibilityRole={question.multiSelect ? 'checkbox' : 'radio'}
                          accessibilityState={{ checked: selected, disabled }}
                          disabled={disabled}
                          style={[
                            styles.option,
                            selected && styles.selected,
                            disabled && styles.disabled,
                          ]}
                          onPress={() => {
                            update(index, selectAskOption(question, answer, optionIndex));
                            setFocused((current) => ({ ...current, [index]: optionIndex }));
                          }}
                        >
                          <Text style={styles.label}>
                            {selected ? '☑ ' : '☐ '}
                            {option.label}
                          </Text>
                          <Text style={styles.hint}>{option.description}</Text>
                        </Pressable>
                      );
                    })}
                    <Pressable
                      accessibilityRole={question.multiSelect ? 'checkbox' : 'radio'}
                      accessibilityState={{ checked: answer.custom, disabled }}
                      disabled={disabled}
                      style={[styles.option, answer.custom && styles.selected]}
                      onPress={() => update(index, selectAskCustom(question, answer))}
                    >
                      <Text style={styles.label}>{answer.custom ? '☑ ' : '☐ '}Type something.</Text>
                    </Pressable>
                    {showPreview && (
                      <View style={styles.preview}>
                        {preview?.preview ? (
                          <Markdown text={preview.preview} />
                        ) : (
                          <Text style={styles.hint}>
                            {preview?.hasPreview
                              ? 'Preview unavailable. Inspect it in the terminal before choosing.'
                              : 'No preview for this option.'}
                          </Text>
                        )}
                      </View>
                    )}
                    {answer.custom && (
                      <TextInput
                        accessibilityLabel={`Custom answer for ${question.header}`}
                        placeholder="Your answer"
                        placeholderTextColor={colors.muted}
                        editable={!disabled}
                        multiline
                        maxLength={100_000}
                        style={styles.input}
                        value={answer.text}
                        onChangeText={(text) => update(index, { text })}
                      />
                    )}
                    <TextInput
                      accessibilityLabel={`Note for ${question.header}`}
                      placeholder="Optional note"
                      placeholderTextColor={colors.muted}
                      editable={!disabled}
                      multiline
                      maxLength={100_000}
                      style={styles.input}
                      value={answer.notes}
                      onChangeText={(notes) => update(index, { notes })}
                    />
                  </View>
                );
              })}
              <TextInput
                accessibilityLabel="Note for all answers"
                placeholder="Optional note for all answers"
                placeholderTextColor={colors.muted}
                editable={!disabled}
                multiline
                maxLength={100_000}
                style={styles.input}
                value={draft.globalNote}
                onChangeText={(globalNote) => setDraft((current) => ({ ...current, globalNote }))}
              />
              <Text style={styles.hint}>
                Answer every question before submitting. Cancel declines the whole questionnaire.
              </Text>
              {(error || command.error) && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error || command.error?.message}
                </Text>
              )}
              {command.uncertain && (
                <Text style={styles.error}>
                  Outcome unknown. Close and inspect the conversation, then use its explicit review
                  control. Nothing is retried automatically.
                </Text>
              )}
              {accepted && (
                <Text style={styles.hint}>
                  Answer accepted by the native extension. Waiting for refreshed state.
                </Text>
              )}
              <Pressable
                accessibilityRole="button"
                disabled={disabled}
                style={[styles.option, disabled && styles.disabled]}
                onPress={() => void submit(false)}
              >
                <Text style={styles.action}>
                  {command.pending ? 'Submitting…' : 'Submit answers'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={disabled}
                style={[styles.option, disabled && styles.disabled]}
                onPress={() =>
                  Alert.alert(
                    'Cancel questionnaire?',
                    'This declines all questions in this questionnaire.',
                    [
                      { text: 'Keep answering', style: 'cancel' },
                      {
                        text: 'Cancel questionnaire',
                        style: 'destructive',
                        onPress: () => void submit(true),
                      },
                    ],
                  )
                }
              >
                <Text style={styles.error}>Cancel questionnaire</Text>
              </Pressable>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  content: { padding: 16, gap: 16 },
  banner: {
    paddingHorizontal: 12,
    minHeight: 44,
    justifyContent: 'center',
    backgroundColor: colors.panel,
  },
  title: { color: colors.text, fontSize: 18, fontWeight: '600' },
  label: { color: colors.text, fontSize: 16 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  question: { gap: 10 },
  option: {
    padding: 12,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    gap: 6,
  },
  selected: { backgroundColor: colors.selected, borderColor: colors.accent },
  input: {
    color: colors.text,
    fontSize: 16,
    padding: 12,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  preview: { padding: 12, backgroundColor: colors.panel, borderRadius: 8 },
  action: { color: colors.accent, fontSize: 14, paddingVertical: 8 },
  error: { color: colors.error, fontSize: 13, lineHeight: 20 },
  disabled: { opacity: 0.4 },
});
