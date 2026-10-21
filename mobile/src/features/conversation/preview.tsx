import { FlatList } from 'react-native';
import { Text, YStack } from 'tamagui';
import type { LiveState } from '../../../../src/client/live';
import type { Message } from '../../../../src/shared/client-state';
import { colors } from '../../theme/colors';

function messageText(message: Message): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return (message.content ?? [])
    .map((part) =>
      part.type === 'text' && typeof part.text === 'string'
        ? part.text
        : part.type === 'thinking'
          ? '[Thinking]'
          : part.type === 'toolCall'
            ? `[Tool: ${String(part.name ?? 'unknown')}]`
            : part.type === 'image'
              ? '[Image]'
              : '[Structured content]',
    )
    .join('\n');
}

/** Plain-text read-only preview. Rich Markdown/tools and read acknowledgments come later. */
export function ConversationPreview({ connection }: { connection: LiveState }) {
  const snapshot = connection.snapshot;
  const messages = snapshot
    ? [...snapshot.view.messages, ...(snapshot.view.partial ? [snapshot.view.partial] : [])]
    : [];
  return (
    <FlatList
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 20, gap: 20 }}
      data={messages}
      keyExtractor={(_message, index) => String(index)}
      renderItem={({ item }) => (
        <YStack gap={8}>
          <Text color={item.role === 'user' ? colors.running : colors.accent} fontWeight="700">
            {item.role}
          </Text>
          <Text userSelect="text" color={colors.text} fontSize={16} lineHeight={24}>
            {messageText(item)}
          </Text>
        </YStack>
      )}
      ListEmptyComponent={
        <Text color={colors.muted}>
          {snapshot ? 'This conversation is empty.' : 'Select a session from Projects.'}
        </Text>
      }
      ListFooterComponent={
        <YStack gap={12} paddingTop={12}>
          {snapshot?.view.tools.map((tool) => (
            <Text key={tool.id} color={colors.blocked}>
              Tool running: {tool.name}
            </Text>
          ))}
          {snapshot?.view.notice && <Text color={colors.blocked}>{snapshot.view.notice}</Text>}
          <Text color={colors.muted} fontSize={12}>
            Read-only scaffold. Rich Markdown, tool inspection, read acknowledgments, and controls
            are not enabled yet.
          </Text>
        </YStack>
      }
    />
  );
}
