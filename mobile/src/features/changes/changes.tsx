import { ArrowLeft, ChevronRight, FileDiff, RefreshCw, X } from 'lucide-react-native';
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { type DiffFile, type DiffLine, diffFiles } from '../../../../src/shared/diff-files';
import type { MobileRelay } from '../../lib/relay';
import { colors } from '../../theme/colors';

export function MobileChanges({
  client,
  projectId,
  projectName,
  visible,
  open,
  onOpenChange,
  renderContent,
}: {
  client: MobileRelay;
  projectId: string;
  projectName: string;
  visible: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  renderContent: (button: ReactNode) => ReactNode;
}) {
  const controller = useMemo(() => client.createDiff(projectId), [client, projectId]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const files = useMemo(() => diffFiles(state.data?.patch ?? ''), [state.data]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (open && visible) {
      controller.start();
    } else {
      controller.stop();
    }
    return controller.stop;
  }, [controller, open, visible]);
  const file = files.find((entry) => entry.path === selected);
  const additions = files.reduce((sum, entry) => sum + entry.additions, 0);
  const deletions = files.reduce((sum, entry) => sum + entry.deletions, 0);
  const back = () => {
    if (selected !== null) {
      setSelected(null);
    } else {
      onOpenChange(false);
    }
  };
  const button = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Changes${state.data ? `, ${files.length} files` : ''}`}
      style={styles.iconButton}
      disabled={!visible}
      onPress={() => {
        Keyboard.dismiss();
        onOpenChange(true);
      }}
    >
      <FileDiff size={21} color={colors.muted} />
      {state.data && files.length > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{files.length}</Text>
        </View>
      )}
    </Pressable>
  );
  return (
    <>
      {renderContent(button)}
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={back}
      >
        <SafeAreaProvider style={styles.screen}>
          <SafeAreaView style={styles.screen}>
            <View style={styles.header}>
              <Pressable
                style={styles.iconButton}
                accessibilityRole="button"
                accessibilityLabel={selected ? 'Back to changed files' : 'Back to conversation'}
                onPress={back}
              >
                <ArrowLeft size={22} color={colors.text} />
              </Pressable>
              <View style={styles.heading}>
                <Text style={styles.title} numberOfLines={1}>
                  {selected?.split('/').at(-1) ?? 'Changes'}
                </Text>
                <Text style={styles.subtitle} numberOfLines={1}>
                  {selected ?? projectName}
                </Text>
              </View>
              <Pressable
                style={styles.iconButton}
                accessibilityRole="button"
                accessibilityLabel="Refresh changes"
                disabled={state.loading || !visible}
                onPress={() => void controller.refresh()}
              >
                {state.loading ? (
                  <ActivityIndicator size="small" color={colors.muted} />
                ) : (
                  <RefreshCw size={19} color={colors.muted} />
                )}
              </Pressable>
              <Pressable
                style={styles.iconButton}
                accessibilityRole="button"
                accessibilityLabel="Close changes"
                onPress={() => onOpenChange(false)}
              >
                <X size={22} color={colors.muted} />
              </Pressable>
            </View>
            <View style={styles.summary}>
              <Text style={styles.summaryText}>
                {files.length} changed {files.length === 1 ? 'file' : 'files'}
              </Text>
              <Text style={styles.additions}>+{additions}</Text>
              <Text style={styles.deletions}>−{deletions}</Text>
              <Text style={styles.live}>
                {state.status === 'live'
                  ? 'Live'
                  : state.status === 'paused'
                    ? 'Paused'
                    : 'Connecting…'}
              </Text>
            </View>
            {state.error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {state.error.message}
              </Text>
            )}
            {state.data?.truncated && (
              <Text style={styles.notice}>
                Some untracked files were omitted because the diff limit was reached.
              </Text>
            )}
            {selected !== null ? (
              file ? (
                <FileChanges file={file} />
              ) : (
                <View style={styles.empty}>
                  <Text style={styles.muted}>This file is no longer in the current diff.</Text>
                </View>
              )
            ) : (
              <FlatList
                data={files}
                keyExtractor={(entry) => entry.path}
                contentContainerStyle={files.length ? undefined : styles.empty}
                ListEmptyComponent={
                  <Text style={styles.muted}>
                    {state.loading && !state.data
                      ? 'Loading changes…'
                      : state.error
                        ? 'Changes are unavailable. Try refreshing.'
                        : 'No working-tree changes.'}
                  </Text>
                }
                renderItem={({ item }) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`View diff for ${item.path}`}
                    style={styles.file}
                    onPress={() => setSelected(item.path)}
                  >
                    <FileDiff size={19} color={colors.muted} />
                    <View style={styles.fileName}>
                      <Text style={styles.fileTitle} numberOfLines={1}>
                        {item.path.split('/').at(-1)}
                      </Text>
                      {item.path.includes('/') && (
                        <Text style={styles.subtitle} numberOfLines={1}>
                          {item.path.slice(0, item.path.lastIndexOf('/'))}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.additions}>+{item.additions}</Text>
                    <Text style={styles.deletions}>−{item.deletions}</Text>
                    <ChevronRight size={16} color={colors.muted} />
                  </Pressable>
                )}
              />
            )}
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </>
  );
}

function displayLine(text: string): string {
  const expanded = text.replace(/\t/g, '    ');
  return expanded.length > 2000 ? `${expanded.slice(0, 2000)}… [line shortened]` : expanded;
}

function FileChanges({ file }: { file: DiffFile }) {
  const { width } = useWindowDimensions();
  const longest = file.lines.reduce(
    (length, line) => Math.max(length, displayLine(line.text).length),
    0,
  );
  const contentWidth = Math.max(width, longest * 7.8 + 108);
  return (
    <>
      {file.previousPath && file.previousPath !== file.path && (
        <Text style={styles.notice}>Renamed from {file.previousPath}</Text>
      )}
      {file.lines.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.muted}>Empty file, rename, or metadata-only change.</Text>
        </View>
      ) : (
        <ScrollView horizontal style={styles.diff} contentContainerStyle={{ width: contentWidth }}>
          <FlatList
            style={{ width: contentWidth }}
            data={file.lines}
            keyExtractor={(_line, index) => String(index)}
            initialNumToRender={30}
            maxToRenderPerBatch={30}
            windowSize={7}
            getItemLayout={(_data, index) => ({ length: 24, offset: index * 24, index })}
            renderItem={({ item }) => <CodeLine line={item} />}
          />
        </ScrollView>
      )}
    </>
  );
}

function CodeLine({ line }: { line: DiffLine }) {
  return (
    <View
      style={[
        styles.codeRow,
        line.kind === 'addition' && styles.addedRow,
        line.kind === 'deletion' && styles.deletedRow,
      ]}
    >
      <Text style={styles.lineNumber}>{line.oldLine ?? ''}</Text>
      <Text style={styles.lineNumber}>{line.newLine ?? ''}</Text>
      <Text selectable numberOfLines={1} style={[styles.code, line.kind === 'hunk' && styles.hunk]}>
        {line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ' '}{' '}
        {displayLine(line.text) || ' '}
      </Text>
    </View>
  );
}

const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  heading: { flex: 1, gap: 4, paddingHorizontal: 4 },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' },
  subtitle: { color: colors.muted, fontSize: 11 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: colors.panel,
  },
  badgeText: { color: colors.accent, fontSize: 10, textAlign: 'center' },
  summary: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  summaryText: { color: colors.muted, fontSize: 12 },
  live: { marginLeft: 'auto', color: colors.muted, fontSize: 11 },
  additions: { color: colors.success, fontSize: 12 },
  deletions: { color: colors.error, fontSize: 12 },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  fileName: { flex: 1, gap: 5 },
  fileTitle: { color: colors.text, fontSize: 14 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { color: colors.muted, fontSize: 13 },
  error: { color: colors.error, fontSize: 12, padding: 12 },
  notice: { color: colors.muted, fontSize: 12, padding: 12 },
  diff: { flex: 1 },
  codeRow: { height: 24, flexDirection: 'row', alignItems: 'center' },
  addedRow: { backgroundColor: '#122a20' },
  deletedRow: { backgroundColor: '#321d24' },
  lineNumber: {
    fontFamily: mono,
    color: colors.muted,
    width: 40,
    fontSize: 10,
    textAlign: 'right',
    paddingRight: 8,
  },
  code: { fontFamily: mono, color: colors.text, fontSize: 12, lineHeight: 24, flex: 1 },
  hunk: { color: colors.accent },
});
