import { type ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { LiveState } from '../../../../src/client/live';
import type { InventorySession } from '../../../../src/shared/sessions';
import type { MobileRelay } from '../../lib/relay';
import { colors } from '../../theme/colors';
import { MobileChanges } from '../changes/changes';
import { InventoryAction } from '../sessions/inventory-action';
import { ResumeSession } from '../sessions/resume';
import { MessageComposer } from './composer';
import { ConversationPreview } from './preview';
import { MobileSessionControls } from './session-controls';

export function Conversation({
  client,
  session,
  connection,
  visible,
  renderHeader,
}: {
  client: MobileRelay;
  session: InventorySession | undefined;
  connection: LiveState;
  visible: boolean;
  renderHeader: (runtimeControl: ReactNode) => ReactNode;
}) {
  const [following, setFollowing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [confirmingRuntime, setConfirmingRuntime] = useState(false);
  const [choosingSettings, setChoosingSettings] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const read = useSyncExternalStore(client.reads.subscribe, client.reads.getState);
  const inventory = useSyncExternalStore(client.subscribe, client.getState);
  const id = session?.id;
  const onFollowing = useCallback((value: boolean) => setFollowing(value), []);
  useEffect(() => {
    if (!id) {
      return;
    }
    client.setReading(
      id,
      following,
      visible &&
        !picking &&
        !confirmingRuntime &&
        !choosingSettings &&
        !changesOpen &&
        connection.status === 'ready',
    );
    return () => client.setReading(id, false, false);
  }, [
    client,
    id,
    following,
    visible,
    picking,
    confirmingRuntime,
    choosingSettings,
    changesOpen,
    connection,
  ]);
  const snapshot = connection.snapshot?.session.id === id ? connection.snapshot : undefined;
  const sessionAction = session ? (
    <InventoryAction
      session={
        snapshot
          ? {
              ...session,
              connection: snapshot.session.connection,
              generation: snapshot.session.generation,
              managedRuntime: snapshot.state.managedRuntime === true,
            }
          : session
      }
      messages={client.messages(session.id, session.projectId)}
      online={
        visible &&
        !picking &&
        !confirmingRuntime &&
        !choosingSettings &&
        !changesOpen &&
        connection.status === 'ready'
      }
      onArchive={client.setArchived}
    />
  ) : null;
  const project = inventory.projects.find((item) => item.id === session?.projectId);
  const renderContent = (changesButton: ReactNode) => {
    const headerActions = (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {changesButton}
        {sessionAction}
      </View>
    );
    return (
      <>
        {session &&
        inventory.projects.some((project) => project.id === session.projectId) &&
        connection.snapshot?.session.id === session.id &&
        connection.snapshot.session.connection === 'disconnected' ? (
          <ResumeSession
            client={client}
            id={session.id}
            enabled={visible && !picking && connection.status === 'ready'}
            onOpen={setConfirmingRuntime}
            renderHeader={(runtimeControl) =>
              renderHeader(
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  {runtimeControl}
                  {headerActions}
                </View>,
              )
            }
          />
        ) : (
          renderHeader(headerActions)
        )}
        <ConversationPreview
          key={`${session?.id}:${connection.snapshot?.session.generation}`}
          connection={connection}
          onFollowing={onFollowing}
          visible={visible && !picking && !confirmingRuntime && !choosingSettings && !changesOpen}
          messages={session ? client.messages(session.id, session.projectId) : undefined}
          questionsEnabled={
            visible &&
            !picking &&
            !confirmingRuntime &&
            !choosingSettings &&
            !changesOpen &&
            connection.status === 'ready' &&
            connection.snapshot?.session.id === session?.id &&
            connection.snapshot?.session.connection === 'connected'
          }
        />
        {read.error && read.target?.id === id && (
          <Pressable
            accessibilityRole="button"
            disabled={read.pending}
            onPress={() => void client.reads.retry()}
          >
            <Text style={{ color: colors.error, padding: 12 }}>
              Read status could not be saved. Tap to retry.
            </Text>
          </Pressable>
        )}
        {session && (
          <MessageComposer
            settings={
              connection.snapshot?.session.id === session.id ? (
                <MobileSessionControls
                  key={`settings:${session.id}:${connection.snapshot.session.generation}`}
                  controls={connection.snapshot.controls}
                  messages={client.messages(session.id, session.projectId)}
                  enabled={
                    visible &&
                    !picking &&
                    !confirmingRuntime &&
                    !changesOpen &&
                    connection.status === 'ready' &&
                    connection.snapshot.session.connection === 'connected' &&
                    !connection.snapshot.view.running &&
                    !connection.snapshot.view.compacting &&
                    connection.snapshot.state.isStreaming !== true &&
                    connection.snapshot.state.hasPendingMessages !== true &&
                    connection.snapshot.state.pendingDialog == null
                  }
                  onOpen={setChoosingSettings}
                />
              ) : null
            }
            messages={client.messages(session.id, session.projectId)}
            running={connection.snapshot?.view.running === true}
            picking={picking}
            onPicking={setPicking}
          />
        )}
      </>
    );
  };
  return project ? (
    <MobileChanges
      client={client}
      projectId={project.id}
      projectName={project.name}
      visible={visible}
      open={changesOpen}
      onOpenChange={setChangesOpen}
      renderContent={renderContent}
    />
  ) : (
    renderContent(null)
  );
}
