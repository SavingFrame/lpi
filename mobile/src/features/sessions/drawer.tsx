import { useState } from 'react';
import { ScrollView } from 'react-native';
import { Button, Text, XStack, YStack } from 'tamagui';
import { activityCounts, groupSessions, visibleSessions } from '../../../../src/client/inventory';
import { hasUnreadCompletion } from '../../../../src/shared/session-read-state';
import type { InventoryState } from '../../lib/relay';
import { colors } from '../../theme/colors';

export function ProjectDrawer({
  inventory,
  online,
  onSelect,
  onClose,
  onSettings,
}: {
  inventory: InventoryState;
  online: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  onSettings: () => void;
}) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [expanded, setExpanded] = useState(new Set<string>());
  const groups = groupSessions(inventory.projects, inventory.sessions, online);
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
    <YStack flex={1} backgroundColor={colors.panel} paddingTop={12}>
      <XStack padding={16} justifyContent="space-between" alignItems="center">
        <Text fontSize={20} fontWeight="700" color={colors.text}>
          Projects
        </Text>
        <Button height={44} onPress={onClose} accessibilityLabel="Close projects">
          Close
        </Button>
      </XStack>
      <ScrollView>
        {groups.length === 0 && (
          <Text color={colors.muted} padding={16}>
            {inventory.loading ? 'Loading projects…' : 'No configured projects.'}
          </Text>
        )}
        {groups.map(({ project, sessions }) => {
          const closed = collapsed.has(project.id);
          const all = expanded.has(project.id);
          const visible = visibleSessions(sessions, inventory.selectedId ?? undefined, all);
          const counts = activityCounts(sessions);
          const unread = sessions.filter((session) =>
            hasUnreadCompletion(session.readState),
          ).length;
          return (
            <YStack key={project.id} padding={12} gap={8}>
              <Button
                justifyContent="flex-start"
                height={48}
                onPress={() => setCollapsed((current) => toggle(project.id, current))}
                accessibilityState={{ expanded: !closed }}
              >
                {closed ? '▸' : '▾'} {project.name} ({sessions.length})
              </Button>
              <Text color={colors.muted} fontSize={12}>
                {counts.running} running · {counts.blocked} need input · {unread} unread
              </Text>
              {!closed &&
                visible.map((session) => (
                  <Button
                    key={session.id}
                    height="auto"
                    minHeight={64}
                    padding={12}
                    backgroundColor={
                      inventory.selectedId === session.id ? colors.selected : colors.background
                    }
                    onPress={() => onSelect(session.id)}
                    accessibilityState={{ selected: inventory.selectedId === session.id }}
                  >
                    <YStack flex={1} gap={6}>
                      <Text color={colors.text} numberOfLines={2}>
                        {session.title || 'Untitled session'}
                      </Text>
                      <Text
                        color={
                          hasUnreadCompletion(session.readState) ? colors.unread : colors.muted
                        }
                        fontSize={12}
                      >
                        {session.activity === 'unknown'
                          ? 'Saved / activity unavailable'
                          : session.activity}
                        {hasUnreadCompletion(session.readState) ? ' · Unviewed turn' : ''}
                      </Text>
                    </YStack>
                  </Button>
                ))}
              {!closed && sessions.length === 0 && (
                <Text color={colors.muted}>No sessions yet.</Text>
              )}
              {!closed && (all || visible.length < sessions.length) && (
                <Button
                  height={44}
                  onPress={() => setExpanded((current) => toggle(project.id, current))}
                >
                  {all ? 'Show less' : 'Show older sessions'}
                </Button>
              )}
            </YStack>
          );
        })}
      </ScrollView>
      <Button margin={16} height={48} onPress={onSettings}>
        Server settings
      </Button>
    </YStack>
  );
}
