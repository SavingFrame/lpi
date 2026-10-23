import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Power } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import type { InventorySession } from '../../src/shared/sessions';
import { setArchived } from './api';
import { live } from './client';
import { ConfirmButton } from './components/confirm-button';
import { Button } from './components/ui/button';
import { useSessionCommands } from './session/use-session-commands';

export function ArchiveSession({
  session,
  online,
}: {
  session: InventorySession;
  online: boolean;
}) {
  const client = useQueryClient();
  const commands = useSessionCommands(session.id, session.projectId);
  const mutation = useMutation({
    mutationFn: () => setArchived(session.id, !session.archived),
    retry: false,
    onSettled: () => client.invalidateQueries({ queryKey: ['sessions'] }),
  });
  const connected = session.connection === 'connected';
  const stopping = !session.archived && connected;
  const external = stopping && !session.managedRuntime;
  const shutdown = commands.shutdownGeneration === session.generation;
  const label = session.archived
    ? 'Restore session'
    : stopping
      ? 'Stop runtime'
      : 'Archive session';
  const description = external
    ? 'Stop Pi in its terminal before archiving. This runtime is not managed by Pim.'
    : stopping
      ? 'Interrupt active work and stop the Pi runtime. History stays. Archive is a separate action after exit.'
      : session.archived
        ? 'Restore this session to the normal list.'
        : 'Hide this session from the normal list. History and drafts stay unchanged.';
  const canStop = useSyncExternalStore(
    live.subscribe,
    () => stopping && commands.canStop(session.generation),
  );
  const disabled =
    !online || mutation.isPending || external || (stopping && (!canStop || shutdown));
  const Icon = session.archived ? ArchiveRestore : stopping ? Power : Archive;
  return (
    <div className="archive-control">
      {!stopping ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={`${label}: ${session.title || 'Untitled session'}`}
          title={description}
          onClick={() => mutation.mutate()}
        >
          <Icon size={15} aria-hidden="true" />
        </Button>
      ) : (
        <ConfirmButton
          key={`${session.generation}:${session.connection}`}
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={`${label}: ${session.title || 'Untitled session'}`}
          title={description}
          message={description}
          confirmLabel={stopping ? 'Stop runtime' : 'Archive'}
          destructive={stopping}
          onConfirm={() => {
            if (stopping) {
              void commands.stopRuntime(session.generation);
            } else {
              mutation.mutate();
            }
          }}
        >
          <Icon size={15} aria-hidden="true" />
        </ConfirmButton>
      )}
      {(mutation.error || commands.error || (shutdown && commands.outcome)) && (
        <div className="session-action-notice" role="status">
          <p>{mutation.error?.message || commands.error?.message || commands.outcome}</p>
          {commands.uncertain && (
            <Button type="button" size="sm" disabled={!online} onClick={commands.review}>
              I inspected the runtime
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
