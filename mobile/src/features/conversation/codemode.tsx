import { type ReactNode, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  type CodemodeCall,
  codemodeCallInput,
  type codemodeState,
} from '../../../../src/shared/codemode.ts';
import { colors } from '../../theme/colors';
import { messageBlocks } from './content';
import { CodeBlock } from './markdown';
import type { ToolEntry } from './timeline';

type CodemodeState = ReturnType<typeof codemodeState>;
const statuses = { running: 'Running', ok: 'Completed', error: 'Failed', cancelled: 'Cancelled' };

function Disclosure({
  title,
  onInspect,
  children,
}: {
  title: string;
  onInspect: () => void;
  children: () => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          onInspect();
          setOpen(!open);
        }}
        style={styles.button}
      >
        <Text style={styles.text} numberOfLines={2}>
          {open ? '▾' : '▸'} {title}
        </Text>
      </Pressable>
      {open && <View style={styles.body}>{children()}</View>}
    </View>
  );
}

export function CodemodeHeader({
  tool,
  state,
  expanded,
  onToggle,
}: {
  tool: ToolEntry;
  state: CodemodeState;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`codemode, ${state.calls.length} calls, ${tool.status}`}
      accessibilityState={{ expanded }}
      style={styles.header}
      onPress={onToggle}
    >
      <Text style={styles.text}>{expanded ? '▾' : '▸'} codemode</Text>
      <Text style={styles.muted}>{state.calls.length} calls</Text>
      {tool.status === 'running' ? (
        <ActivityIndicator size="small" color={colors.running} />
      ) : (
        <Text style={tool.status === 'error' ? styles.error : styles.muted}>
          {tool.status === 'complete'
            ? 'Completed'
            : tool.status === 'error'
              ? 'Failed'
              : 'Pending'}
        </Text>
      )}
      {state.wallTime && <Text style={styles.muted}>{state.wallTime}</Text>}
      {state.errors > 0 && <Text style={styles.error}>{state.errors} failed</Text>}
      {state.cancelled > 0 && <Text style={styles.muted}>{state.cancelled} cancelled</Text>}
    </Pressable>
  );
}

export function CodemodeCallRow({
  call,
  onInspect,
}: {
  call: CodemodeCall;
  onInspect: () => void;
}) {
  return (
    <View style={styles.nested}>
      <Disclosure title={`${call.name} · ${codemodeCallInput(call)}`} onInspect={onInspect}>
        {() => (
          <>
            <Text style={styles.muted}>Saved argument preview (may be truncated)</Text>
            <CodeBlock text={call.args || 'Unavailable'} />
            {call.error && (
              <Text selectable style={styles.error}>
                {call.error}
              </Text>
            )}
            {call.cost !== undefined && <Text style={styles.muted}>Model cost: ${call.cost}</Text>}
            {call.editTool && (
              <CodeBlock text={call.editTool.result.details.patch} language="diff" />
            )}
          </>
        )}
      </Disclosure>
      <View style={styles.callStatus}>
        <Text style={call.status === 'error' ? styles.error : styles.muted}>
          {statuses[call.status]}
        </Text>
        {call.durationMs !== undefined && (
          <Text style={styles.muted}>
            {call.durationMs < 1000
              ? `${Math.round(call.durationMs)}ms`
              : `${(call.durationMs / 1000).toFixed(1)}s`}
          </Text>
        )}
      </View>
    </View>
  );
}

export function CodemodeDetails({
  tool,
  state,
  onInspect,
}: {
  tool: ToolEntry;
  state: CodemodeState;
  onInspect: () => void;
}) {
  return (
    <View style={styles.nested}>
      {state.calls.length === 0 && (
        <Text style={styles.muted}>
          {tool.status === 'running' || tool.status === 'unknown'
            ? 'Waiting for nested calls.'
            : 'No nested call metadata available.'}
        </Text>
      )}
      {state.patchesOmitted && <Text style={styles.muted}>Some edit patches were not saved.</Text>}
      <Disclosure title="Script" onInspect={onInspect}>
        {() => <CodeBlock text={state.script ?? 'Script unavailable.'} language="javascript" />}
      </Disclosure>
      <Disclosure title="Combined output" onInspect={onInspect}>
        {() => (
          <>
            <Text style={styles.muted}>
              Script output is not associated with individual nested calls.
            </Text>
            {state.fullOutputPath && (
              <Text selectable style={styles.muted}>
                Full output: {state.fullOutputPath} (temporary file)
              </Text>
            )}
            {state.output ? (
              messageBlocks(state.output).map((block, index) =>
                block.kind === 'image' ? (
                  <Image
                    key={String(index)}
                    accessibilityLabel="Codemode output image"
                    source={{ uri: block.uri }}
                    style={styles.image}
                    resizeMode="contain"
                  />
                ) : (
                  <CodeBlock key={String(index)} text={block.text} />
                ),
              )
            ) : (
              <Text style={styles.muted}>
                {tool.status === 'unknown' ? 'No result available.' : 'Waiting for output.'}
              </Text>
            )}
          </>
        )}
      </Disclosure>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    padding: 10,
    backgroundColor: colors.panel,
    borderRadius: 8,
  },
  nested: { marginLeft: 12, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: colors.border },
  button: { minHeight: 40, justifyContent: 'center' },
  body: { gap: 8, paddingBottom: 8 },
  text: { color: colors.text, fontSize: 13 },
  muted: { color: colors.muted, fontSize: 12 },
  error: { color: colors.error, fontSize: 12 },
  callStatus: { flexDirection: 'row', gap: 10, paddingBottom: 8 },
  image: { width: '100%', height: 240 },
});
