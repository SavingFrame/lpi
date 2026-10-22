import { useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Drawer } from 'react-native-drawer-layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MobileRelay } from '../../lib/relay';
import { colors } from '../../theme/colors';
import { Conversation } from '../conversation/conversation';
import { ProjectDrawer } from './drawer';

export function SessionShell({
  client,
  onSettings,
  visible,
}: {
  client: MobileRelay;
  onSettings: () => void;
  visible: boolean;
}) {
  const inventory = useSyncExternalStore(client.subscribe, client.getState);
  const connection = useSyncExternalStore(client.live.subscribe, client.live.getState);
  const [open, setOpen] = useState(false);
  const { width } = useWindowDimensions();
  // The drawer's local layout excludes the outer safe area's screen-space top inset.
  const insets = useSafeAreaInsets();
  const selected = inventory.sessions.find((session) => session.id === inventory.selectedId);
  const online = connection.status === 'ready';
  const running =
    online &&
    selected !== undefined &&
    connection.snapshot?.session.id === selected.id &&
    connection.snapshot.session.connection === 'connected' &&
    connection.snapshot.view.running;
  const status =
    connection.status === 'offline'
      ? 'Offline · Last-known history'
      : !online
        ? 'Synchronizing…'
        : !selected
          ? 'Choose a conversation'
          : connection.snapshot?.session.connection === 'disconnected'
            ? 'Saved · Read only'
            : running
              ? 'Running'
              : 'Live';
  return (
    <Drawer
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      drawerPosition="left"
      drawerType="front"
      swipeEdgeWidth={24}
      drawerStyle={{ width: Math.min(width * 0.88, 400), backgroundColor: colors.panel }}
      renderDrawerContent={() => (
        <ProjectDrawer
          inventory={inventory}
          online={online && visible}
          launches={client.launches}
          onArchive={client.setArchived}
          messages={client.messages}
          onCreate={(projectId) => {
            void client.createSession(projectId).then((selected) => {
              if (selected) {
                setOpen(false);
              }
            });
          }}
          onClose={() => setOpen(false)}
          onSettings={() => {
            setOpen(false);
            onSettings();
          }}
          onRefresh={() => {
            void client.refresh();
            client.live.refresh();
          }}
          onSelect={(id) => {
            void client.select(id);
            setOpen(false);
          }}
        />
      )}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top}
      >
        <Conversation
          key={inventory.selectedId ?? 'none'}
          client={client}
          session={selected}
          connection={connection}
          visible={visible && !open}
          renderHeader={(runtimeControl) => (
            <>
              <View style={styles.header}>
                <Pressable
                  style={styles.iconButton}
                  accessibilityRole="button"
                  accessibilityLabel="Open projects and sessions"
                  onPress={() => setOpen(true)}
                >
                  <View style={styles.menu}>
                    <View style={styles.menuLine} />
                    <View style={styles.menuLine} />
                    <View style={styles.menuLine} />
                  </View>
                </Pressable>
                <View style={styles.titleContainer}>
                  <Text style={styles.title} numberOfLines={1}>
                    {selected?.title || 'Pim'}
                  </Text>
                  <View style={styles.statusRow}>
                    {running && <ActivityIndicator size="small" color={colors.running} />}
                    <Text
                      style={[styles.status, !online && styles.warning, running && styles.running]}
                      numberOfLines={1}
                    >
                      {status}
                    </Text>
                  </View>
                </View>
                {runtimeControl}
              </View>
              {connection.status === 'offline' && (
                <Text style={styles.warningBanner}>Connection lost. Pi may still be running.</Text>
              )}
              {(inventory.error || connection.error) && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {inventory.error || connection.error}
                </Text>
              )}
            </>
          )}
        />
      </KeyboardAvoidingView>
    </Drawer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  menu: { gap: 5 },
  menuLine: { height: 2, width: 20, borderRadius: 1, backgroundColor: colors.text },
  titleContainer: { flex: 1, gap: 4, paddingRight: 16 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  status: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  running: { color: colors.running },
  warning: { color: colors.blocked },
  warningBanner: { color: colors.blocked, fontSize: 12, lineHeight: 18, padding: 12 },
  error: { color: colors.error, padding: 12, fontSize: 13 },
});
