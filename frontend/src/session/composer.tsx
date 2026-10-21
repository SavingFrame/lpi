import { ArrowDown, ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type ComposerDraft, composerCommand } from '../../../src/client/drafts';
import type { BridgeCommand } from '../../../src/shared/commands';
import type { Snapshot } from '../../../src/shared/snapshots';
import { drafts } from '../client';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { ImageAttachments } from '../image-attachments';
import { SessionSettings } from '../session-controls';

export function Composer({
  id,
  snapshot,
  active,
  previewing,
  restoredDraft,
  pending,
  uncertain,
  outcome,
  following,
  onFollow,
  onCommand,
}: {
  id: string;
  snapshot: Snapshot | null;
  active: boolean;
  previewing: boolean;
  restoredDraft: ComposerDraft | null;
  pending: boolean;
  uncertain: boolean;
  outcome: string | null;
  following: boolean;
  onFollow: () => void;
  onCommand: (command: BridgeCommand) => Promise<boolean>;
}) {
  const [controller] = useState(() => drafts.get(id));
  const draftState = useSyncExternalStore(controller.subscribe, controller.getState);
  const { draft } = draftState;
  const [readingImages, setReadingImages] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    void controller.initialize();
  }, [controller]);
  useEffect(() => {
    if (restoredDraft) {
      controller.restore(restoredDraft);
    }
  }, [controller, restoredDraft]);
  const canSend =
    active &&
    !draftState.loading &&
    !readingImages &&
    Boolean(draft.text.trim() || draft.images.length);
  return (
    <div className="composer">
      {!following && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute -top-12 left-1/2 -translate-x-1/2 rounded-full shadow-lg"
          aria-label="Go to bottom"
          title="Go to bottom"
          onClick={onFollow}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
      )}
      {snapshot && (
        <SessionSettings
          controls={snapshot.controls}
          disabled={
            !active ||
            snapshot.view.running ||
            snapshot.view.compacting ||
            snapshot.state.isStreaming === true ||
            snapshot.state.hasPendingMessages === true ||
            snapshot.state.pendingDialog != null
          }
          onCommand={onCommand}
        />
      )}
      {draftState.error && (
        <div className="banner error" role="alert">
          Draft could not be loaded or saved. Keep this tab open to preserve your edits.
          <Button type="button" variant="ghost" size="sm" onClick={() => void controller.retry()}>
            Retry draft storage
          </Button>
        </div>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!canSend) {
            return;
          }
          const submitted = draft;
          onFollow();
          const accepted = await onCommand(
            composerCommand(submitted, snapshot?.view.running === true),
          );
          controller.settle(submitted, accepted);
        }}
      >
        <ImageAttachments
          images={draft.images}
          onChange={(images) => controller.update((current) => ({ ...current, images }))}
          disabled={previewing || pending || uncertain}
          onBusy={setReadingImages}
        >
          <Textarea
            ref={input}
            aria-label="Message"
            disabled={previewing}
            placeholder={
              snapshot?.session.connection === 'connected'
                ? 'What should Pi work on?'
                : 'Connect native Pi to send a message'
            }
            value={draft.text}
            onChange={(event) => {
              const text = event.target.value;
              controller.update((current) => ({ ...current, text }));
            }}
            onKeyDown={(event) => {
              if (
                event.nativeEvent.isComposing ||
                event.repeat ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey
              ) {
                return;
              }
              if (event.key === 'Enter' && event.altKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              } else if (event.key === 'Escape' && !event.altKey && active) {
                event.preventDefault();
                void onCommand({ type: 'abort' });
              }
            }}
            rows={4}
          />
        </ImageAttachments>
        <div className="composer-footer">
          <span className="muted" role="status">
            {pending ? 'Submitting…' : outcome ? outcome : 'Draft stays in this tab.'}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-300 hover:text-red-200"
            disabled={!active}
            onClick={() => void onCommand({ type: 'abort' })}
            aria-keyshortcuts="Escape"
            title="Abort (Esc in message box). Does not clear queued messages"
          >
            <Square aria-hidden="true" />
            Abort
          </Button>
          <Button
            type="submit"
            size="sm"
            aria-keyshortcuts="Alt+Enter"
            title="Send (Alt+Enter in message box)"
            disabled={!canSend}
          >
            <ArrowUp aria-hidden="true" />
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
