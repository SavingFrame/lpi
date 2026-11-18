import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
import type { MobileDevice, MobileWorkspace } from '../../lib/workspace';
import { colors } from '../../theme/colors';
import { Conversation } from '../conversation/conversation';
import { ProjectDrawer } from './drawer';

export function SessionShell({
  device,
  devices,
  workspace,
  onSettings,
  visible,
  sessionLink,
}: {
  device: MobileDevice;
  devices: MobileDevice[];
  workspace: MobileWorkspace;
  onSettings: () => void;
  visible: boolean;
  sessionLink?: string | string[];
}) {
  const { client, inventory } = device;
  const [open, setOpen] = useState(false);
  const connectionStatus = useSyncExternalStore(
    client.live.subscribe,
    () => client.live.getState().status,
  );
  const presentation = useMemo(() => {
    if (visible && !open) {
      return client.presentation;
    }
    // Keep the transcript mounted, but stop rendering tokens behind the drawer.
    // Transport and command guards still use the authoritative live state.
    const snapshot = client.live.getState();
    return { getState: () => snapshot, subscribe: () => () => {} };
  }, [client, visible, open]);
  const connection = useSyncExternalStore(presentation.subscribe, presentation.getState);
  useEffect(() => {
    if (sessionLink !== undefined) {
      setOpen(false);
    }
  }, [sessionLink]);
  const { width } = useWindowDimensions();
  // The drawer's local layout excludes the outer safe area's screen-space top inset.
  const insets = useSafeAreaInsets();
  const selected = inventory.sessions.find((session) => session.id === inventory.selectedId);
  const online = client.actionsReady();
  const running =
    online &&
    selected !== undefined &&
    connection.snapshot?.session.id === selected.id &&
    connection.snapshot.session.connection === 'connected' &&
    connection.snapshot.view.running;
  const status =
    connectionStatus === 'offline'
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
          devices={devices}
          focused={device}
          visible={visible && open}
          onCreate={(origin, projectId) => {
            void workspace.launch(origin, projectId).then((selected) => {
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
            for (const relay of devices) {
              if (relay.status === 'online') {
                void relay.client.refresh();
              }
            }
            client.live.refresh();
          }}
          onSelect={(origin, id) => {
            workspace.select(origin, id);
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
          key={JSON.stringify([device.origin, inventory.selectedId])}
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
                    {selected?.title || 'lpi'}
                  </Text>
                  <View style={styles.statusRow}>
                    {running && <ActivityIndicator size="small" color={colors.running} />}
                    <Text
                      style={[styles.status, !online && styles.warning, running && styles.running]}
                      numberOfLines={1}
                    >
                      {device.name} · {status}
                    </Text>
                  </View>
                </View>
                {runtimeControl}
              </View>
              {connectionStatus === 'offline' && (
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
