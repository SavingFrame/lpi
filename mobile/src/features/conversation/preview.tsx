import { type ReactNode, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { LiveState } from '../../../../src/client/live';
import { MobileQuestion } from '../../extensions';
import type { MobileMessages } from '../../lib/messages';
import { colors } from '../../theme/colors';
import { MobileDisplay } from './display';
import { CodeBlock, Markdown } from './markdown';
import { conversationScroll } from './scroll';
import { type ConversationRow, conversationRows, type ToolEntry } from './timeline';

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

function ToolStatus({ status }: { status: ToolEntry['status'] }) {
  return (
    <View
      style={styles.statusIcon}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {status === 'running' ? (
        <ActivityIndicator size="small" color={colors.running} style={styles.spinner} />
      ) : status === 'complete' ? (
        <View style={styles.checkIcon} />
      ) : status === 'error' ? (
        <>
          <View style={[styles.errorStroke, styles.errorStrokeLeft]} />
          <View style={[styles.errorStroke, styles.errorStrokeRight]} />
        </>
      ) : (
        <View style={styles.unknownIcon}>
          <View style={styles.unknownStroke} />
        </View>
      )}
    </View>
  );
}

function ToolDetail({ tool, onInspect }: { tool: ToolEntry; onInspect: () => void }) {
  const [open, setOpen] = useState(false);
  const status =
    tool.status === 'running'
      ? 'Running'
      : tool.status === 'error'
        ? 'Error'
        : tool.status === 'complete'
          ? 'Completed'
          : 'No result';
  return (
    <View style={styles.toolRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${tool.name}${tool.preview ? `, ${tool.preview}` : ''}, ${status}`}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          onInspect();
          setOpen(!open);
        }}
        style={({ pressed }) => [styles.toolButton, pressed && styles.toolPressed]}
      >
        <View style={[styles.chevron, open && styles.chevronOpen]} />
        <Text style={styles.toolName} numberOfLines={1}>
          {tool.name}
        </Text>
        <Text style={styles.toolPreview} numberOfLines={1} ellipsizeMode="tail">
          {tool.preview ?? ''}
        </Text>
        <ToolStatus status={tool.status} />
      </Pressable>
      {open && (
        <View style={styles.toolBody}>
          {tool.arguments !== undefined && (
            <>
              <Text style={styles.sectionLabel}>Arguments</Text>
              <CodeBlock text={tool.arguments} />
            </>
          )}
          {tool.output !== undefined && (
            <>
              <Text style={styles.sectionLabel}>
                {tool.status === 'running' ? 'Output so far' : 'Output'}
              </Text>
              <CodeBlock text={tool.output || 'No text output.'} />
            </>
          )}
          {tool.output === undefined && (
            <Text style={styles.muted}>
              {tool.status === 'running'
                ? 'Waiting for output…'
                : 'No result available in this history.'}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function MessageRow({
  row,
  onInspect,
}: {
  row: Exclude<ConversationRow, { kind: 'question' }>;
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
}

export function ConversationPreview({
  connection,
  onFollowing,
  messages,
  questionsEnabled = false,
}: {
  connection: LiveState;
  onFollowing: (following: boolean) => void;
  messages?: MobileMessages;
  questionsEnabled?: boolean;
}) {
  const snapshot = connection.snapshot;
  const list = useRef<FlatList<ConversationRow>>(null);
  const [showBottom, setShowBottom] = useState(false);
  const scroll = useMemo(
    () =>
      conversationScroll({
        scrollToLatest: (animated) => list.current?.scrollToOffset({ offset: 0, animated }),
        onChange: (following, reading) => {
          setShowBottom(!following);
          onFollowing(reading);
        },
      }),
    [onFollowing],
  );
  const rows = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    const timeline = conversationRows(
      [...snapshot.view.messages, ...(snapshot.view.partial ? [snapshot.view.partial] : [])],
      snapshot.view.tools,
    );
    // A public prompt can arrive before its tool call is present in the transcript.
    for (const prompt of snapshot.view.extensions?.['ask-user-question'] ?? []) {
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
  }, [snapshot]);
  return (
    <View style={styles.container}>
      <FlatList
        // Do not preserve the empty placeholder's position when history first arrives.
        key={rows.length ? 'messages' : 'empty'}
        ref={list}
        style={styles.container}
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(row) => row.key}
        inverted
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        removeClippedSubviews={false}
        // KeyboardAvoidingView cannot follow iOS interactive dismissal frame by frame.
        // Dismiss on drag so the composer and keyboard use the same hide animation.
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustKeyboardInsets={false}
        renderItem={({ item }) =>
          item.kind === 'question' ? (
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
        ItemSeparatorComponent={() => <View style={styles.separator} />}
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
  separator: { height: 20 },
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
  toolRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  toolButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  toolPressed: { backgroundColor: colors.panel },
  toolName: { color: colors.text, fontSize: 12, fontWeight: '600', maxWidth: '40%' },
  toolPreview: {
    flex: 1,
    minWidth: 0,
    color: colors.muted,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  toolBody: { gap: 10, paddingHorizontal: 10, paddingBottom: 12 },
  chevron: {
    width: 5,
    height: 5,
    borderRightWidth: 1,
    borderTopWidth: 1,
    borderColor: colors.muted,
    transform: [{ rotate: '45deg' }],
    marginRight: 2,
  },
  chevronOpen: { transform: [{ rotate: '135deg' }] },
  statusIcon: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  spinner: { transform: [{ scale: 0.7 }] },
  checkIcon: {
    width: 5,
    height: 9,
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: colors.success,
    transform: [{ rotate: '45deg' }],
    marginTop: -3,
  },
  errorStroke: {
    position: 'absolute',
    height: 1.5,
    width: 12,
    borderRadius: 1,
    backgroundColor: colors.error,
  },
  errorStrokeLeft: { transform: [{ rotate: '45deg' }] },
  errorStrokeRight: { transform: [{ rotate: '-45deg' }] },
  unknownIcon: {
    width: 12,
    height: 12,
    borderWidth: 1,
    borderColor: colors.muted,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unknownStroke: { width: 5, height: 1, backgroundColor: colors.muted },
  detail: { gap: 8 },
  detailBody: { gap: 10, paddingHorizontal: 4, paddingBottom: 8 },
  sectionLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' },
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
