import { memo, type ReactNode, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LiveState } from '../../../../src/client/live';
import { MobileQuestion } from '../../extensions';
import type { MobileMessages } from '../../lib/messages';
import { colors } from '../../theme/colors';
import { CodemodeCallRow, CodemodeDetails, CodemodeHeader } from './codemode';
import { MobileDisplay } from './display';
import { CodeBlock, Markdown } from './markdown';
import { conversationScroll } from './scroll';
import { StatusBarScrollTarget } from './status-bar-scroll';
import { type ConversationRow, createConversationRows } from './timeline';
import { ToolDetail } from './tool-row';

function Detail({
  label,
  children,
  onInspect,
}: {
  label: string;
  children: ReactNode;
  onInspect: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.detail}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          onInspect();
          setOpen(!open);
        }}
        style={styles.detailButton}
      >
        <Text style={styles.detailLabel}>
          {open ? '▾' : '▸'} {label}
        </Text>
      </Pressable>
      {open && <View style={styles.detailBody}>{children}</View>}
    </View>
  );
}

const MessageRow = memo(function MessageRow({
  row,
  onInspect,
}: {
  row: Exclude<ConversationRow, { kind: 'question' | 'codemode' }>;
  onInspect: () => void;
}) {
  if (row.kind === 'display') {
    return <MobileDisplay artifact={row.artifact} onInspect={onInspect} />;
  }
  if (row.kind === 'tools') {
    const running = row.tools.filter((tool) => tool.status === 'running').length;
    const errors = row.tools.filter((tool) => tool.status === 'error').length;
    return (
      <View style={styles.toolGroup}>
        <Text style={styles.toolHeading}>
          {row.tools.length} {row.tools.length === 1 ? 'tool' : 'tools'}
          {running ? ` · ${running} running` : ''}
          {errors ? <Text style={styles.error}>{` · ${errors} failed`}</Text> : null}
        </Text>
        <View style={styles.toolRows}>
          {row.tools.map((tool) => (
            <ToolDetail key={tool.key} tool={tool} onInspect={onInspect} />
          ))}
        </View>
      </View>
    );
  }
  if (row.kind === 'codemode-call') {
    return <CodemodeCallRow call={row.call} onInspect={onInspect} />;
  }
  if (row.kind === 'codemode-details') {
    return <CodemodeDetails tool={row.tool} state={row.state} onInspect={onInspect} />;
  }
  const { role, blocks } = row;
  if (role !== 'user' && role !== 'assistant') {
    return (
      <Detail label={role} onInspect={onInspect}>
        <CodeBlock text={blocks.map((block) => block.text).join('\n\n') || 'No text content.'} />
      </Detail>
    );
  }
  return (
    <View style={[styles.message, role === 'user' && styles.user]}>
      {blocks.some((block) => block.kind === 'text' && block.text.trim()) && (
        <Text style={[styles.role, role === 'user' && styles.userRole]}>
          {role === 'user' ? 'You' : 'Pi'}
        </Text>
      )}
      {blocks.map((block, index) =>
        block.kind === 'image' && block.uri ? (
          <Image
            key={String(index)}
            accessibilityLabel="Image attachment"
            source={{ uri: block.uri }}
            style={styles.attachment}
            resizeMode="contain"
          />
        ) : block.kind !== 'text' ? (
          <Detail key={String(index)} label={block.label} onInspect={onInspect}>
            <CodeBlock text={block.text} />
          </Detail>
        ) : role === 'user' ? (
          <Text key={String(index)} selectable style={styles.userText}>
            {block.text}
          </Text>
        ) : (
          <Markdown key={String(index)} text={block.text} />
        ),
      )}
    </View>
  );
});

function ConversationSeparator({ leadingItem }: { leadingItem?: ConversationRow }) {
  // Data is newest-first. A child is followed by its sibling or parent, without a gap.
  return <View style={{ height: leadingItem && 'parentKey' in leadingItem ? 0 : 20 }} />;
}

export function ConversationPreview({
  connection,
  onFollowing,
  messages,
  questionsEnabled = false,
  visible = true,
}: {
  connection: LiveState;
  onFollowing: (following: boolean) => void;
  messages?: MobileMessages;
  questionsEnabled?: boolean;
  visible?: boolean;
}) {
  const snapshot = connection.snapshot;
  const list = useRef<FlatList<ConversationRow>>(null);
  const [showBottom, setShowBottom] = useState(false);
  const [collapsedCodemode, setCollapsedCodemode] = useState(new Set<string>());
  const scroll = useMemo(
    () =>
      conversationScroll({
        scrollToLatest: (animated) => list.current?.scrollToOffset({ offset: 0, animated }),
        scrollToOldest: () => list.current?.scrollToEnd({ animated: true }),
        onChange: (following, reading) => {
          setShowBottom(!following);
          onFollowing(reading);
        },
      }),
    [onFollowing],
  );
  const projectRows = useMemo(createConversationRows, []);
  const transcript = snapshot?.view.messages;
  const partial = snapshot?.view.partial;
  const tools = snapshot?.view.tools;
  const extensions = snapshot?.view.extensions;
  const running = snapshot?.view.running;
  const rows = useMemo(() => {
    if (!transcript || !tools) {
      return [];
    }
    const timeline = projectRows([...transcript, ...(partial ? [partial] : [])], tools, running);
    // A public prompt can arrive before its tool call is present in the transcript.
    for (const prompt of extensions?.['ask-user-question'] ?? []) {
      if (!timeline.some((row) => row.kind === 'question' && row.tool.id === prompt.toolCallId)) {
        timeline.push({
          kind: 'question',
          key: `question:${prompt.toolCallId}`,
          tool: {
            key: prompt.toolCallId,
            id: prompt.toolCallId,
            name: 'ask_user_question',
            status: 'running',
          },
        });
      }
    }
    return timeline.reverse();
  }, [projectRows, transcript, partial, tools, extensions, running]);
  const visibleRows = useMemo(
    () => rows.filter((row) => !('parentKey' in row) || !collapsedCodemode.has(row.parentKey)),
    [rows, collapsedCodemode],
  );
  return (
    <View style={styles.container}>
      <StatusBarScrollTarget
        visible={visible}
        onTop={() => {
          scroll.oldest();
        }}
      />
      <FlatList
        // Do not preserve the empty placeholder's position when history first arrives.
        key={rows.length ? 'messages' : 'empty'}
        ref={list}
        style={styles.container}
        contentContainerStyle={styles.content}
        data={visibleRows}
        keyExtractor={(row) => row.key}
        inverted
        scrollsToTop={false}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        removeClippedSubviews={false}
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        windowSize={5}
        // KeyboardAvoidingView cannot follow iOS interactive dismissal frame by frame.
        // Dismiss on drag so the composer and keyboard use the same hide animation.
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustKeyboardInsets={false}
        renderItem={({ item }) =>
          item.kind === 'codemode' ? (
            <CodemodeHeader
              tool={item.tool}
              state={item.state}
              expanded={!collapsedCodemode.has(item.key)}
              onToggle={() => {
                scroll.pause();
                setCollapsedCodemode((current) => {
                  const next = new Set(current);
                  if (next.has(item.key)) {
                    next.delete(item.key);
                  } else {
                    next.add(item.key);
                  }
                  return next;
                });
              }}
            />
          ) : item.kind === 'question' ? (
            <MobileQuestion
              key={item.tool.id ?? item.key}
              tool={item.tool}
              prompt={snapshot?.view.extensions?.['ask-user-question']?.find(
                (prompt) => prompt.toolCallId === item.tool.id,
              )}
              messages={messages}
              enabled={questionsEnabled}
            >
              <ToolDetail tool={item.tool} onInspect={scroll.pause} />
            </MobileQuestion>
          ) : (
            <MessageRow row={item} onInspect={scroll.pause} />
          )
        }
        ItemSeparatorComponent={ConversationSeparator}
        onScroll={({ nativeEvent }) => scroll.scroll(nativeEvent.contentOffset.y)}
        onScrollBeginDrag={scroll.beginInteraction}
        onScrollEndDrag={({ nativeEvent }) => {
          scroll.scroll(nativeEvent.contentOffset.y);
          scroll.endInteraction();
        }}
        onMomentumScrollBegin={scroll.beginMomentum}
        onMomentumScrollEnd={({ nativeEvent }) => {
          scroll.scroll(nativeEvent.contentOffset.y);
          scroll.endMomentum();
        }}
        scrollEventThrottle={16}
        onLayout={({ nativeEvent }) => scroll.layout(nativeEvent.layout.height)}
        onContentSizeChange={(_width, height) => scroll.contentSize(height)}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {snapshot ? 'No messages yet' : 'Your conversations'}
            </Text>
            <Text style={styles.muted}>
              {snapshot ? 'Messages will appear here.' : 'Open Projects to choose a session.'}
            </Text>
          </View>
        }
        ListHeaderComponent={
          snapshot?.view.notice ? <Text style={styles.notice}>{snapshot.view.notice}</Text> : null
        }
      />
      {showBottom && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scroll to latest message"
          style={styles.bottom}
          onPress={scroll.latest}
        >
          <Text style={styles.detailLabel}>↓ Latest</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    // Inversion already anchors short histories at the bottom. Stretching this
    // container makes native position maintenance anchor viewport-sized blank space.
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
  },
  message: { gap: 10 },
  attachment: { width: '100%', height: 240, borderRadius: 8 },
  user: { backgroundColor: colors.panel, borderRadius: 12, padding: 14 },
  role: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  userRole: { color: colors.muted },
  userText: { color: colors.text, fontSize: 16, lineHeight: 25 },
  toolGroup: { gap: 6 },
  toolHeading: { color: colors.muted, fontSize: 11, fontWeight: '500', paddingHorizontal: 4 },
  toolRows: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 6,
    overflow: 'hidden',
  },
  detail: { gap: 8 },
  detailBody: { gap: 10, paddingHorizontal: 4, paddingBottom: 8 },
  error: { color: colors.error },
  detailButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  detailLabel: { color: colors.muted, fontSize: 13, fontWeight: '500' },
  notice: { color: colors.blocked, fontSize: 13, lineHeight: 20 },
  empty: { paddingVertical: 60, gap: 10, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 14 },
  bottom: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    backgroundColor: colors.panel,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
});
