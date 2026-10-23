import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { activityCounts, groupSessions, visibleSessions } from '../../../../src/client/inventory';
import type { LaunchController } from '../../../../src/client/launches';
import { relativeTime } from '../../../../src/client/relative-time';
import { hasUnreadCompletion } from '../../../../src/shared/session-read-state';
import type { MobileMessages } from '../../lib/messages';
import type { InventoryState } from '../../lib/relay';
import { colors, projectColor } from '../../theme/colors';
import { InventoryAction } from './inventory-action';

export function ProjectDrawer({
  inventory,
  online,
  onSelect,
  onClose,
  onSettings,
  onRefresh,
  launches,
  onCreate,
  onArchive,
  messages,
}: {
  inventory: InventoryState;
  online: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  onSettings: () => void;
  onRefresh: () => void;
  launches: LaunchController;
  onCreate: (projectId: string) => void;
  onArchive: (id: string, archived: boolean) => Promise<void>;
  messages: (id: string, projectId: string) => MobileMessages;
}) {
  const launch = useSyncExternalStore(launches.subscribe, launches.getState);
  useEffect(() => {
    void launches.initialize();
  }, [launches]);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [expanded, setExpanded] = useState(new Set<string>());
  const [archived, setArchived] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const groups = groupSessions(inventory.projects, inventory.sessions, online, archived);
  function toggle(id: string, current: Set<string>) {
    const next = new Set(current);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  }
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Projects</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close projects"
          onPress={onClose}
          style={styles.close}
        >
          <Text style={styles.closeText}>×</Text>
        </Pressable>
      </View>
      <View accessibilityRole="tablist" style={styles.tabs}>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: !archived }}
          style={[styles.tab, !archived && styles.activeTab]}
          onPress={() => setArchived(false)}
        >
          <Text style={[styles.tabText, !archived && styles.activeTabText]}>Sessions</Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: archived }}
          style={[styles.tab, archived && styles.activeTab]}
          onPress={() => setArchived(true)}
        >
          <Text style={[styles.tabText, archived && styles.activeTabText]}>Archived</Text>
        </Pressable>
      </View>
      {archived && (
        <Text style={styles.notice}>
          Archived sessions. History is preserved; Pi may still be running.
        </Text>
      )}
      {launch.status === 'pending' && <Text style={styles.notice}>Waiting for Pi…</Text>}
      {launch.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {launch.error.message}
        </Text>
      )}
      {launch.status === 'uncertain' && (
        <View style={styles.launchNotice}>
          <Text style={styles.notice}>
            Launch outcome unknown. Inspect recent sessions and tmux -L pim list-sessions on the
            relay host before creating another session.
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={!online}
            style={styles.footerButton}
            onPress={() =>
              Alert.alert('Clear launch warning?', 'This does not stop Pi or retry the launch.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'I inspected the runtimes', onPress: () => void launches.review() },
              ])
            }
          >
            <Text style={[styles.footerText, !online && styles.disabled]}>
              I inspected the runtimes
            </Text>
          </Pressable>
        </View>
      )}
      <ScrollView contentContainerStyle={styles.list}>
        {groups.length === 0 && (
          <Text style={styles.empty}>
            {inventory.loading ? 'Loading projects…' : 'No configured projects.'}
          </Text>
        )}
        {groups.map(({ project, configured, sessions }) => {
          const closed = collapsed.has(project.id);
          const all = expanded.has(project.id);
          const visible = visibleSessions(sessions, inventory.selectedId ?? undefined, all);
          const counts = activityCounts(sessions);
          const unreadCount = sessions.filter((session) =>
            hasUnreadCompletion(session.readState),
          ).length;
          return (
            <View key={project.id} style={styles.group}>
              <View style={styles.projectHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !closed }}
                  onPress={() => setCollapsed((current) => toggle(project.id, current))}
                  style={styles.project}
                >
                  <Text style={styles.chevron}>{closed ? '▸' : '▾'}</Text>
                  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <View
                      style={[styles.folderTab, { backgroundColor: projectColor(project.id) }]}
                    />
                    <View style={[styles.folder, { borderColor: projectColor(project.id) }]} />
                  </View>
                  <Text style={styles.projectName} numberOfLines={1}>
                    {project.name}
                  </Text>
                  <Text style={styles.count}>{sessions.length}</Text>
                </Pressable>
                {configured && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`New session in ${project.name}`}
                    accessibilityState={{ disabled: !online || launch.status !== 'ready' }}
                    disabled={!online || launch.status !== 'ready'}
                    style={styles.close}
                    onPress={() => onCreate(project.id)}
                  >
                    {launch.status === 'pending' ? (
                      <ActivityIndicator size="small" color={colors.muted} />
                    ) : (
                      <Text
                        style={[
                          styles.closeText,
                          (!online || launch.status !== 'ready') && styles.disabled,
                        ]}
                      >
                        +
                      </Text>
                    )}
                  </Pressable>
                )}
              </View>
              {(counts.running > 0 || counts.blocked > 0 || unreadCount > 0) && (
                <View style={styles.counts}>
                  {counts.running > 0 && (
                    <Text style={styles.running}>{counts.running} running</Text>
                  )}
                  {counts.blocked > 0 && (
                    <Text style={styles.blocked}>{counts.blocked} need input</Text>
                  )}
                  {unreadCount > 0 && <Text style={styles.unread}>{unreadCount} unread</Text>}
                </View>
              )}
              {!closed &&
                visible.map((session) => {
                  const selected = inventory.selectedId === session.id;
                  const unread = hasUnreadCompletion(session.readState);
                  const status =
                    session.activity === 'running'
                      ? 'Running'
                      : session.activity === 'blocked'
                        ? 'Needs input'
                        : session.activity === 'idle'
                          ? 'Idle'
                          : 'Saved';
                  const dateLabel = relativeTime(session.updatedAt ?? session.createdAt, now);
                  const statusColor =
                    session.activity === 'running'
                      ? colors.running
                      : session.activity === 'blocked'
                        ? colors.blocked
                        : colors.muted;
                  return (
                    <View key={session.id} style={[styles.sessionRow, selected && styles.selected]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${session.title || 'Untitled session'}, ${status}${unread ? ', unread' : ''}`}
                        onPress={() => onSelect(session.id)}
                        style={({ pressed }) => [styles.session, pressed && styles.pressed]}
                      >
                        <View
                          accessibilityElementsHidden
                          importantForAccessibility="no-hide-descendants"
                          style={styles.statusIcon}
                        >
                          {session.activity === 'running' ? (
                            <ActivityIndicator size="small" color={colors.running} />
                          ) : session.activity === 'blocked' ? (
                            <Text style={styles.inputIcon}>?</Text>
                          ) : session.activity === 'idle' ? (
                            <View style={styles.idleIcon} />
                          ) : (
                            <View style={styles.savedIcon}>
                              <View style={styles.savedLine} />
                              <View style={styles.savedLine} />
                            </View>
                          )}
                        </View>
                        <View style={styles.sessionBody}>
                          <View style={styles.titleRow}>
                            <Text
                              style={[styles.sessionTitle, unread && styles.unreadTitle]}
                              numberOfLines={2}
                            >
                              {session.title || 'Untitled session'}
                            </Text>
                            {unread && (
                              <View
                                accessibilityElementsHidden
                                importantForAccessibility="no-hide-descendants"
                                style={styles.unreadDot}
                              />
                            )}
                          </View>
                          <View style={styles.meta}>
                            <Text
                              style={[styles.metadata, styles.statusLabel, { color: statusColor }]}
                            >
                              {status}
                            </Text>
                            <Text style={styles.metadata}>{dateLabel}</Text>
                          </View>
                          {unread && <Text style={styles.unread}>Unviewed turn</Text>}
                        </View>
                      </Pressable>
                      <InventoryAction
                        session={session}
                        messages={messages(session.id, session.projectId)}
                        online={online}
                        onArchive={onArchive}
                      />
                    </View>
                  );
                })}
              {!closed && sessions.length === 0 && (
                <Text style={styles.empty}>
                  {archived ? 'No archived sessions.' : 'No sessions yet.'}
                </Text>
              )}
              {!closed && (all || visible.length < sessions.length) && (
                <Pressable
                  accessibilityRole="button"
                  style={styles.older}
                  onPress={() => setExpanded((current) => toggle(project.id, current))}
                >
                  <Text style={styles.metadata}>{all ? 'Show less' : 'Show older sessions'}</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" style={styles.footerButton} onPress={onSettings}>
          <Text style={styles.footerText}>Server settings</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh sessions"
          disabled={!online}
          style={styles.footerButton}
          onPress={onRefresh}
        >
          <Text style={[styles.footerText, !online && styles.disabled]}>Refresh</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.panel },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 20,
    paddingRight: 8,
    paddingVertical: 8,
  },
  heading: { color: colors.text, fontSize: 22, fontWeight: '700' },
  close: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  closeText: { color: colors.muted, fontSize: 28 },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 4,
    gap: 4,
    borderRadius: 12,
    backgroundColor: colors.background,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  activeTab: { backgroundColor: colors.selected, borderColor: colors.border },
  tabText: { color: colors.muted, fontSize: 14, fontWeight: '500' },
  activeTabText: { color: colors.text, fontWeight: '700' },
  list: { paddingHorizontal: 12, paddingBottom: 20 },
  group: { marginBottom: 24 },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: 8,
  },
  launchNotice: { paddingHorizontal: 12 },
  notice: { color: colors.muted, fontSize: 12, lineHeight: 18, padding: 12 },
  error: { color: colors.error, fontSize: 12, padding: 12 },
  project: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  chevron: { color: colors.muted, fontSize: 14 },
  folderTab: { width: 9, height: 3, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  folder: { width: 18, height: 13, borderWidth: 1.5, borderRadius: 3 },
  projectName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  count: {
    color: colors.muted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    backgroundColor: colors.background,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingLeft: 10, paddingBottom: 8 },
  running: { color: colors.running, fontSize: 12 },
  blocked: { color: colors.blocked, fontSize: 12 },
  unread: { color: colors.unread, fontSize: 12, fontWeight: '500' },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    borderRadius: 10,
    marginBottom: 4,
  },
  session: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 8,
  },
  selected: { backgroundColor: colors.selected, borderLeftColor: colors.accent },
  pressed: { backgroundColor: colors.border },
  statusIcon: { width: 20, height: 22, alignItems: 'center', justifyContent: 'center' },
  inputIcon: {
    color: colors.blocked,
    borderColor: colors.blocked,
    borderWidth: 1.5,
    borderRadius: 9,
    width: 18,
    height: 18,
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 15,
    fontWeight: '700',
  },
  idleIcon: { width: 13, height: 13, borderRadius: 7, borderWidth: 1.5, borderColor: colors.muted },
  savedIcon: {
    width: 14,
    height: 17,
    borderWidth: 1.5,
    borderColor: colors.muted,
    borderRadius: 3,
    justifyContent: 'center',
    paddingHorizontal: 2,
    gap: 3,
  },
  savedLine: { height: 1, backgroundColor: colors.muted },
  sessionBody: { flex: 1, gap: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  sessionTitle: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 22 },
  unreadTitle: { fontWeight: '700' },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.unread, marginTop: 7 },
  meta: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 },
  statusLabel: { fontWeight: '500' },
  metadata: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  older: { minHeight: 44, justifyContent: 'center', paddingLeft: 26 },
  empty: { color: colors.muted, fontSize: 13, padding: 16 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerButton: { minHeight: 52, paddingHorizontal: 8, justifyContent: 'center' },
  footerText: { color: colors.muted, fontSize: 13 },
  disabled: { opacity: 0.4 },
});
