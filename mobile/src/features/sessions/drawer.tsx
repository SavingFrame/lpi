import { Circle, LockKeyhole, MessageCircleQuestion } from 'lucide-react-native';
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
import type { UsageController } from '../../../../src/client/provider-usage';
import { relativeTime } from '../../../../src/client/relative-time';
import { hasUnreadCompletion } from '../../../../src/shared/session-read-state';
import { BrandIcon } from '../../components/brand-icon';
import type { InventoryState } from '../../lib/relay';
import { colors, projectColor } from '../../theme/colors';
import { ProviderUsagePanel } from './provider-usage';

export function ProjectDrawer({
  inventory,
  usage,
  online,
  visible,
  onSelect,
  onClose,
  onSettings,
  onRefresh,
  launches,
  onCreate,
}: {
  inventory: InventoryState;
  usage: UsageController;
  online: boolean;
  visible: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  onSettings: () => void;
  onRefresh: () => void;
  launches: LaunchController;
  onCreate: (projectId: string) => void;
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
        <View style={styles.brand}>
          <BrandIcon size={28} />
          <Text style={styles.heading}>lpi</Text>
        </View>
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
            Launch outcome unknown. Inspect recent sessions and tmux -L lpi list-sessions on the
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
      <ScrollView contentContainerStyle={styles.list} scrollsToTop={visible}>
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
          return (
            <View key={project.id} style={styles.group}>
              <View style={styles.projectHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !closed }}
                  onPress={() => setCollapsed((current) => toggle(project.id, current))}
                  style={[styles.project, configured && styles.projectWithCreate]}
                >
                  <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <View
                      style={[styles.folderTab, { backgroundColor: projectColor(project.id) }]}
                    />
                    <View style={[styles.folder, { borderColor: projectColor(project.id) }]} />
                  </View>
                  <Text style={styles.projectName} numberOfLines={1}>
                    {project.name}
                  </Text>
                  {counts.blocked > 0 && (
                    <Text style={styles.blocked}>{counts.blocked} need input</Text>
                  )}
                  <Text style={styles.chevron}>{closed ? '▸' : '▾'}</Text>
                </Pressable>
                {configured && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`New session in ${project.name}`}
                    accessibilityState={{ disabled: !online || launch.status !== 'ready' }}
                    disabled={!online || launch.status !== 'ready'}
                    style={[styles.close, styles.projectCreate]}
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
                          : 'Read-only, live activity unavailable';
                  const dateLabel = relativeTime(session.updatedAt ?? session.createdAt, now);
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
                            <MessageCircleQuestion size={18} color={colors.blocked} />
                          ) : session.activity === 'idle' ? (
                            <Circle size={18} color={colors.muted} />
                          ) : (
                            <LockKeyhole size={18} color={colors.muted} />
                          )}
                        </View>
                        <View style={styles.sessionBody}>
                          <View style={styles.titleRow}>
                            <Text
                              style={[styles.sessionTitle, unread && styles.unreadTitle]}
                              numberOfLines={1}
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
                        </View>
                        <Text style={styles.timestamp}>{dateLabel}</Text>
                      </Pressable>
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
      <ProviderUsagePanel controller={usage} />
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
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
    paddingLeft: 10,
    paddingRight: 28,
  },
  projectCreate: { position: 'absolute', right: 24 },
  projectWithCreate: { paddingRight: 76 },
  chevron: { position: 'absolute', right: 10, color: colors.muted, fontSize: 14 },
  folderTab: { width: 9, height: 3, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  folder: { width: 18, height: 13, borderWidth: 1.5, borderRadius: 3 },
  projectName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700' },
  blocked: { color: colors.blocked, fontSize: 12 },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    marginBottom: 4,
  },
  session: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 8,
  },
  selected: { backgroundColor: colors.selected },
  pressed: { backgroundColor: colors.border },
  statusIcon: { width: 20, height: 22, alignItems: 'center', justifyContent: 'center' },
  sessionBody: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sessionTitle: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 22 },
  unreadTitle: { fontWeight: '700' },
  unreadDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.unread },
  timestamp: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'], flexShrink: 0 },
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
