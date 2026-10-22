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
import { hasUnreadCompletion } from '../../../../src/shared/session-read-state';
import type { MobileMessages } from '../../lib/messages';
import type { InventoryState } from '../../lib/relay';
import { colors } from '../../theme/colors';
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
      <View style={styles.counts}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: !archived }}
          style={styles.footerButton}
          onPress={() => setArchived(false)}
        >
          <Text style={[styles.footerText, !archived && styles.unreadTitle]}>Sessions</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: archived }}
          style={styles.footerButton}
          onPress={() => setArchived(true)}
        >
          <Text style={[styles.footerText, archived && styles.unreadTitle]}>Archived</Text>
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
        {groups.map(({ project, sessions }) => {
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
                  <Text style={styles.projectName} numberOfLines={1}>
                    {project.name}
                  </Text>
                  <Text style={styles.count}>{sessions.length}</Text>
                </Pressable>
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
                  const date = new Date(session.updatedAt ?? session.createdAt);
                  const dateLabel = Number.isNaN(date.getTime())
                    ? ''
                    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                  return (
                    <View key={session.id} style={styles.sessionRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${session.title || 'Untitled session'}, ${status}${unread ? ', unread' : ''}`}
                        onPress={() => onSelect(session.id)}
                        style={[styles.session, selected && styles.selected]}
                      >
                        <View
                          style={[
                            styles.marker,
                            {
                              backgroundColor:
                                session.activity === 'running'
                                  ? colors.running
                                  : session.activity === 'blocked'
                                    ? colors.blocked
                                    : unread
                                      ? colors.unread
                                      : 'transparent',
                            },
                          ]}
                        />
                        <View style={styles.sessionBody}>
                          <Text
                            style={[styles.sessionTitle, unread && styles.unreadTitle]}
                            numberOfLines={2}
                          >
                            {session.title || 'Untitled session'}
                          </Text>
                          <View style={styles.meta}>
                            <Text
                              style={
                                session.activity === 'running'
                                  ? styles.running
                                  : session.activity === 'blocked'
                                    ? styles.blocked
                                    : styles.metadata
                              }
                            >
                              {status}
                              {unread ? ' · Unread' : ''}
                            </Text>
                            <Text style={styles.metadata}>{dateLabel}</Text>
                          </View>
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
  list: { paddingHorizontal: 10, paddingBottom: 20 },
  group: { marginBottom: 12 },
  projectHeader: { flexDirection: 'row', alignItems: 'center' },
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
  projectName: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  count: { color: colors.muted, fontSize: 12 },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingLeft: 28, paddingBottom: 10 },
  running: { color: colors.running, fontSize: 11 },
  blocked: { color: colors.blocked, fontSize: 11 },
  unread: { color: colors.unread, fontSize: 11 },
  sessionRow: { flexDirection: 'row', alignItems: 'flex-start' },
  session: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    borderRadius: 8,
  },
  selected: { backgroundColor: colors.selected, borderBottomColor: 'transparent' },
  marker: { height: 6, width: 6, borderRadius: 3, marginTop: 7 },
  sessionBody: { flex: 1, gap: 7 },
  sessionTitle: { color: colors.text, fontSize: 14, lineHeight: 20 },
  unreadTitle: { fontWeight: '600' },
  meta: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  metadata: { color: colors.muted, fontSize: 11 },
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
