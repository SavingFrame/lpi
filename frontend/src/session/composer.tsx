import { ArrowDown, ArrowUp, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ImageAttachment } from '../../../src/attachments';
import type { BridgeCommand } from '../../../src/bridge/protocol';
import type { Snapshot } from '../api';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { ImageAttachments } from '../image-attachments';
import { SessionSettings } from '../session-controls';

export function Composer({
  id,
  snapshot,
  active,
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
  pending: boolean;
  uncertain: boolean;
  outcome: string | null;
  following: boolean;
  onFollow: () => void;
  onCommand: (command: BridgeCommand) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => sessionStorage.getItem(`draft:${id}`) ?? '');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [readingImages, setReadingImages] = useState(false);
  const [mode, setMode] = useState<'prompt' | 'steer' | 'follow_up'>('prompt');
  useEffect(() => sessionStorage.setItem(`draft:${id}`, draft), [draft, id]);
  const canSend =
    active &&
    !readingImages &&
    Boolean(draft.trim() || attachments.length) &&
    !(mode === 'prompt' && snapshot?.view.running);
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
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!canSend) {
            return;
          }
          const submitted = draft;
          const submittedImages = attachments;
          onFollow();
          const accepted = await onCommand({
            type: mode,
            message: draft.trim() ? draft : '',
            images: attachments,
          });
          if (accepted) {
            setDraft((current) => (current === submitted ? '' : current));
            setAttachments((current) => (current === submittedImages ? [] : current));
          }
        }}
      >
        <ImageAttachments
          images={attachments}
          onChange={setAttachments}
          disabled={pending || uncertain}
          onBusy={setReadingImages}
        >
          <Textarea
            aria-label="Message"
            placeholder={
              snapshot?.session.connection === 'connected'
                ? 'What should Pi work on?'
                : 'Connect native Pi to send a message'
            }
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
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
          <label>
            Send as{' '}
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:ring-1 focus-visible:ring-ring"
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <option value="prompt">Prompt</option>
              <option value="steer">Steer</option>
              <option value="follow_up">Follow-up</option>
            </select>
          </label>
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
