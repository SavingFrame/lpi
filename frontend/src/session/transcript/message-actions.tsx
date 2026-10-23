import { Check, Copy, GitBranch } from 'lucide-react';
import { useState } from 'react';
import type { Message } from '../../../../src/shared/client-state';
import { Button } from '../../components/ui/button';
import { messageActionText } from './transcript-state';

export function MessageActions({
  item,
  onPreview,
}: {
  item: Message;
  onPreview?: (entryId: string) => void;
}) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const text = messageActionText(item);
  const entryId = typeof item.entryId === 'string' ? item.entryId : undefined;
  if (text === null || (!text.trim() && !(onPreview && entryId))) {
    return null;
  }
  const branchLabel = item.role === 'user' ? 'Edit and branch' : 'Branch from here';
  const copyLabel = copyStatus === 'copied' ? 'Copied' : 'Copy message';
  return (
    <div className="message-actions">
      <span role="status" className={copyStatus === 'failed' ? 'error' : 'sr-only'}>
        {copyStatus === 'failed'
          ? 'Copy failed. Select and copy the text manually.'
          : copyStatus === 'copied'
            ? 'Message copied.'
            : ''}
      </span>
      {text.trim() && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={copyLabel}
          title={copyLabel}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopyStatus('copied');
            } catch {
              setCopyStatus('failed');
            }
          }}
        >
          {copyStatus === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        </Button>
      )}
      {onPreview && entryId && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={branchLabel}
          title={branchLabel}
          onClick={() => onPreview(entryId)}
        >
          <GitBranch aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
