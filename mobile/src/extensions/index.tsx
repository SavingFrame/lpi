import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AskPrompt } from '../../../src/extension-support/ask-user-question/contract';
import { askHistory } from '../../../src/extension-support/ask-user-question/history';
import { Markdown } from '../features/conversation/markdown';
import type { ToolEntry } from '../features/conversation/timeline';
import type { MobileMessages } from '../lib/messages';
import { colors } from '../theme/colors';
import { AskQuestionnaire } from './ask-user-question';

/** Only authoritative pending prompts are actionable. History is always read-only. */
export function MobileQuestion({
  tool,
  prompt,
  messages,
  enabled,
  children,
}: {
  tool: ToolEntry;
  prompt?: AskPrompt;
  messages?: MobileMessages;
  enabled: boolean;
  children: ReactNode;
}) {
  if (prompt && messages && !tool.result) {
    return <AskQuestionnaire prompt={prompt} messages={messages} enabled={enabled} />;
  }
  const history = askHistory({ name: tool.name, args: tool.args, result: tool.result });
  if (!history) {
    return children;
  }
  const failed = Boolean(history.error || tool.status === 'error');
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Questions and answers</Text>
      <Text style={styles.hint}>
        {failed ? 'Failed' : history.cancelled ? 'Cancelled' : 'Answered'} · Read-only
      </Text>
      {history.error && <Text style={styles.error}>{history.error}</Text>}
      {history.questions.map((question) => (
        <View key={question.question} style={styles.question}>
          {question.header && <Text style={styles.hint}>{question.header}</Text>}
          <Text style={styles.title}>{question.question}</Text>
          {question.options.map((option) => {
            const selected = question.selected.some((entry) => entry.label === option.label);
            return (
              <View key={option.label} style={[styles.option, selected && styles.selected]}>
                <Text style={styles.text}>
                  {selected ? '☑ ' : '☐ '}
                  {option.label}
                </Text>
                {option.description && <Text style={styles.hint}>{option.description}</Text>}
              </View>
            );
          })}
          {question.custom !== undefined && (
            <Text selectable style={styles.text}>
              {question.custom}
            </Text>
          )}
          {question.skipped && (
            <Text style={styles.hint}>
              {history.cancelled ? 'Cancelled' : 'No answer available'}
            </Text>
          )}
          {question.notes && (
            <Text selectable style={styles.text}>
              Note: {question.notes}
            </Text>
          )}
          {question.preview && <Markdown text={question.preview} />}
        </View>
      ))}
      {history.globalNote && (
        <Text selectable style={styles.text}>
          Note for all answers: {history.globalNote}
        </Text>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 16, backgroundColor: colors.panel, borderRadius: 12 },
  question: { gap: 10 },
  title: { color: colors.text, fontSize: 18, fontWeight: '600' },
  text: { color: colors.text, fontSize: 16, lineHeight: 24 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  error: { color: colors.error, fontSize: 13 },
  option: { padding: 12, gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  selected: { backgroundColor: colors.selected, borderColor: colors.accent },
});
