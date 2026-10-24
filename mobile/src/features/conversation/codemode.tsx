import { Image, StyleSheet, Text, View } from 'react-native';
import {
  type CodemodeCall,
  codemodeCallInput,
  type codemodeState,
} from '../../../../src/shared/codemode.ts';
import { colors } from '../../theme/colors';
import { messageBlocks } from './content';
import { CodeBlock } from './markdown';
import { type ToolEntry, toolPreview } from './timeline';
import { ToolDisclosure, ToolRow } from './tool-row';

type CodemodeState = ReturnType<typeof codemodeState>;
const statuses = {
  running: 'running',
  ok: 'complete',
  error: 'error',
  cancelled: 'cancelled',
} as const;

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
  const summary = [
    `${state.calls.length} calls`,
    ...(state.errors ? [`${state.errors} failed`] : []),
    ...(state.cancelled ? [`${state.cancelled} cancelled`] : []),
  ].join(' · ');
  return (
    <ToolRow
      name="codemode"
      preview={summary}
      metadata={state.wallTime}
      status={tool.status}
      open={expanded}
      onPress={onToggle}
      framed
    />
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
      <ToolDisclosure
        name={call.name}
        preview={toolPreview(codemodeCallInput(call))}
        status={statuses[call.status]}
        metadata={
          call.durationMs === undefined
            ? undefined
            : call.durationMs < 1000
              ? `${Math.round(call.durationMs)}ms`
              : `${(call.durationMs / 1000).toFixed(1)}s`
        }
        onInspect={onInspect}
        framed
      >
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
      </ToolDisclosure>
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
      <View style={styles.frame}>
        <ToolDisclosure name="Script" preview="JavaScript" onInspect={onInspect}>
          {() => <CodeBlock text={state.script ?? 'Script unavailable.'} language="javascript" />}
        </ToolDisclosure>
        <ToolDisclosure name="Combined output" onInspect={onInspect}>
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
        </ToolDisclosure>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nested: { marginLeft: 12, paddingLeft: 10, borderLeftWidth: 1, borderLeftColor: colors.border },
  frame: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 6,
    overflow: 'hidden',
  },
  muted: { color: colors.muted, fontSize: 11 },
  error: { color: colors.error, fontSize: 11 },
  image: { width: '100%', height: 240 },
});
