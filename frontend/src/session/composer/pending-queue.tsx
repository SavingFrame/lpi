import type { BridgeCommand } from '../../../../src/shared/commands';
import { type PendingQueue, pendingQueue } from '../../../../src/shared/queue';
import type { Snapshot } from '../../../../src/shared/snapshots';
import { Button } from '../../components/ui/button';

export function PendingMessages({
  snapshot,
  active,
  canCopy,
  onCopy,
  onCommand,
}: {
  snapshot: Snapshot;
  active: boolean;
  canCopy: boolean;
  onCopy: (text: string) => void;
  onCommand: (command: BridgeCommand) => Promise<boolean>;
}) {
  const queue = pendingQueue(snapshot.state.queue);
  if (snapshot.session.connection !== 'connected') {
    return null;
  }
  if (!queue) {
    return snapshot.state.hasPendingMessages === true ? (
      <p className="banner" role="status">
        Native Pi has queued messages, but queue access is unavailable. Check that Pi loads the
        extensions/pim source folder. Sending more messages may not fix this. No messages can be
        cleared here yet.
      </p>
    ) : null;
  }
  if (!queue.steering.length && !queue.followUp.length) {
    return null;
  }
  return (
    <section className="mb-3 rounded-md border border-input p-3" aria-label="Queued messages">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Queued messages</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!active || snapshot.view.compacting}
          onClick={() => void onCommand({ type: 'clear_queue', expectedRevision: queue.revision })}
        >
          Clear queued messages
        </Button>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        Copy text to your draft before clearing to revise and send again. Images are not copied.
        Sending does not remove the original queue. Updates may take a second.
      </p>
      <div className="max-h-48 space-y-2 overflow-y-auto">
        <QueueItems kind="steering" queue={queue} canCopy={canCopy} onCopy={onCopy} />
        <QueueItems kind="followUp" queue={queue} canCopy={canCopy} onCopy={onCopy} />
      </div>
    </section>
  );
}

function QueueItems({
  kind,
  queue,
  canCopy,
  onCopy,
}: {
  kind: 'steering' | 'followUp';
  queue: PendingQueue;
  canCopy: boolean;
  onCopy: (text: string) => void;
}) {
  return queue[kind].map((text, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: A new revision invalidates all native queue positions.
    <div key={`${queue.revision}:${kind}:${index}`} className="rounded border border-input p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {kind === 'steering' ? 'Steering' : 'Follow-up'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canCopy}
          onClick={() => onCopy(text)}
        >
          Copy text to draft
        </Button>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{text || '(Image-only message)'}</p>
    </div>
  ));
}
