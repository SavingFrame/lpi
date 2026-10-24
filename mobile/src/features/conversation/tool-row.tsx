import { memo, type ReactNode, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/colors';
import { CodeBlock } from './markdown';
import { type ToolEntry, toolDetails } from './timeline';

type ToolStatus = ToolEntry['status'] | 'cancelled';
const statusLabels: Record<ToolStatus, string> = {
  running: 'Running',
  complete: 'Completed',
  error: 'Error',
  unknown: 'No result',
  cancelled: 'Cancelled',
};
interface ToolRowProps {
  name: string;
  preview?: string;
  metadata?: string;
  status?: ToolStatus;
  open: boolean;
  framed?: boolean;
  onPress: () => void;
  children?: ReactNode;
}

function StatusIcon({ status }: { status: ToolStatus }) {
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

/** The same compact row is used for ordinary calls, codemode parents and tree children. */
export function ToolRow({
  name,
  preview,
  metadata,
  status,
  open,
  framed,
  onPress,
  children,
}: ToolRowProps) {
  return (
    <View style={framed ? styles.frame : styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}${preview ? `, ${preview}` : ''}${metadata ? `, ${metadata}` : ''}${status ? `, ${statusLabels[status]}` : ''}`}
        accessibilityState={{ expanded: open }}
        onPress={onPress}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <View style={[styles.chevron, open && styles.chevronOpen]} />
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.preview} numberOfLines={1} ellipsizeMode="tail">
          {preview ?? ''}
        </Text>
        {metadata && <Text style={styles.muted}>{metadata}</Text>}
        {status && <StatusIcon status={status} />}
      </Pressable>
      {open && children && <View style={styles.body}>{children}</View>}
    </View>
  );
}

export function ToolDisclosure({
  children,
  onInspect,
  ...props
}: Omit<ToolRowProps, 'open' | 'onPress' | 'children'> & {
  onInspect: () => void;
  children: () => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <ToolRow
      {...props}
      open={open}
      onPress={() => {
        onInspect();
        setOpen(!open);
      }}
    >
      {open ? children() : null}
    </ToolRow>
  );
}

function ToolBody({ tool }: { tool: ToolEntry }) {
  const details = toolDetails(tool);
  return (
    <>
      {details.arguments !== undefined && (
        <>
          <Text style={styles.sectionLabel}>Arguments</Text>
          <CodeBlock text={details.arguments} />
        </>
      )}
      {details.output !== undefined ? (
        <>
          <Text style={styles.sectionLabel}>
            {tool.status === 'running' ? 'Output so far' : 'Output'}
          </Text>
          <CodeBlock text={details.output || 'No text output.'} />
        </>
      ) : (
        <Text style={styles.muted}>
          {tool.status === 'running'
            ? 'Waiting for output…'
            : 'No result available in this history.'}
        </Text>
      )}
    </>
  );
}

export const ToolDetail = memo(function ToolDetail({
  tool,
  onInspect,
}: {
  tool: ToolEntry;
  onInspect: () => void;
}) {
  return (
    <ToolDisclosure
      name={tool.name}
      preview={tool.preview}
      status={tool.status}
      onInspect={onInspect}
    >
      {() => <ToolBody tool={tool} />}
    </ToolDisclosure>
  );
});

const styles = StyleSheet.create({
  frame: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 6,
    overflow: 'hidden',
  },
  row: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  button: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  pressed: { backgroundColor: colors.panel },
  name: { color: colors.text, fontSize: 12, fontWeight: '600', maxWidth: '40%' },
  preview: {
    flex: 1,
    minWidth: 0,
    color: colors.muted,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  body: { gap: 10, paddingHorizontal: 10, paddingBottom: 12 },
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
  sectionLabel: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 11 },
});
