import { useState, useSyncExternalStore } from 'react';
import { useWindowDimensions } from 'react-native';
import { Drawer } from 'react-native-drawer-layout';
import { Button, Text, XStack, YStack } from 'tamagui';
import type { MobileRelay } from '../../lib/relay';
import { colors } from '../../theme/colors';
import { ConversationPreview } from '../conversation/preview';
import { ProjectDrawer } from './drawer';

export function SessionShell({
  client,
  onSettings,
}: {
  client: MobileRelay;
  onSettings: () => void;
}) {
  const inventory = useSyncExternalStore(client.subscribe, client.getState);
  const connection = useSyncExternalStore(client.live.subscribe, client.live.getState);
  const [open, setOpen] = useState(false);
  const { width } = useWindowDimensions();
  const selected = inventory.sessions.find((session) => session.id === inventory.selectedId);
  const online = connection.status === 'ready';
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
          online={online}
          onClose={() => setOpen(false)}
          onSettings={() => {
            setOpen(false);
            onSettings();
          }}
          onSelect={(id) => {
            void client.select(id);
            setOpen(false);
          }}
        />
      )}
    >
      <YStack flex={1} backgroundColor={colors.background}>
        <XStack
          padding={12}
          gap={12}
          alignItems="center"
          borderBottomWidth={1}
          borderColor={colors.border}
        >
          <Button
            height={44}
            onPress={() => setOpen(true)}
            accessibilityLabel="Open projects and sessions"
          >
            Projects
          </Button>
          <YStack flex={1}>
            <Text color={colors.text} fontWeight="700" numberOfLines={1}>
              {selected?.title || 'Pim'}
            </Text>
            <Text color={colors.muted} fontSize={12} numberOfLines={1}>
              {client.origin}
            </Text>
          </YStack>
          <Button
            height={44}
            disabled={!online}
            onPress={() => {
              void client.refresh();
              client.live.refresh();
            }}
            accessibilityLabel="Refresh sessions"
          >
            Refresh
          </Button>
        </XStack>
        <Text color={online ? colors.muted : colors.blocked} padding={12} fontSize={12}>
          {connection.status === 'offline'
            ? 'Disconnected. History is last-known; Pi may still be running.'
            : connection.status !== 'ready'
              ? 'Synchronizing…'
              : connection.snapshot?.session.connection === 'disconnected'
                ? 'Saved session. Read-only.'
                : 'Connected. Read-only preview.'}
        </Text>
        {(inventory.error || connection.error) && (
          <Text accessibilityRole="alert" padding={12} color={colors.error}>
            {inventory.error || connection.error}
          </Text>
        )}
        <ConversationPreview key={inventory.selectedId ?? 'none'} connection={connection} />
      </YStack>
    </Drawer>
  );
}
