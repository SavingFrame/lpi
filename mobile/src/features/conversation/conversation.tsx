import { type ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, Text } from 'react-native';
import type { LiveState } from '../../../../src/client/live';
import type { InventorySession } from '../../../../src/shared/sessions';
import { MobileExtensionPanels } from '../../extensions';
import type { MobileRelay } from '../../lib/relay';
import { colors } from '../../theme/colors';
import { ResumeSession } from '../sessions/resume';
import { StopSession } from '../sessions/stop';
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
  const [answering, setAnswering] = useState(false);
  const [confirmingRuntime, setConfirmingRuntime] = useState(false);
  const [choosingSettings, setChoosingSettings] = useState(false);
  const read = useSyncExternalStore(client.reads.subscribe, client.reads.getState);
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
        !answering &&
        !confirmingRuntime &&
        !choosingSettings &&
        connection.status === 'ready',
    );
    return () => client.setReading(id, false, false);
  }, [
    client,
    id,
    following,
    visible,
    picking,
    answering,
    confirmingRuntime,
    choosingSettings,
    connection,
  ]);
  return (
    <>
      {session &&
      connection.snapshot?.session.id === session.id &&
      connection.snapshot.session.connection === 'disconnected' ? (
        <ResumeSession
          client={client}
          id={session.id}
          enabled={visible && !picking && !answering && connection.status === 'ready'}
          onOpen={setConfirmingRuntime}
          renderHeader={renderHeader}
        />
      ) : (
        renderHeader(
          session &&
            connection.snapshot?.session.id === session.id &&
            connection.snapshot.session.connection === 'connected' &&
            connection.snapshot.state.managedRuntime === true ? (
            <StopSession
              messages={client.messages(session.id, session.projectId)}
              generation={connection.snapshot.session.generation}
              enabled={visible && !picking && !answering && connection.status === 'ready'}
              onOpen={setConfirmingRuntime}
            />
          ) : null,
        )
      )}
      <ConversationPreview connection={connection} onFollowing={onFollowing} />
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
      {session && connection.snapshot?.session.id === session.id && (
        <MobileExtensionPanels
          key={`${session.id}:${connection.snapshot.session.generation}`}
          extensions={connection.snapshot.view.extensions}
          messages={client.messages(session.id, session.projectId)}
          enabled={visible && !picking && connection.status === 'ready'}
          onOpen={setAnswering}
        />
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
                  !answering &&
                  !confirmingRuntime &&
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
}
