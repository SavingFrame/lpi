import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { copyText } from '../client/clipboard';
import { Button } from '../components/ui/button';

export function CopySessionValue({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={`h-7 w-7 shrink-0 ${status === 'failed' ? 'error' : ''}`}
        aria-label={`Copy ${label}`}
        title={
          status === 'failed' ? 'Copy failed. Select and copy the text manually.' : `Copy ${label}`
        }
        onClick={async () => {
          try {
            await copyText(value);
            setStatus('copied');
          } catch {
            setStatus('failed');
          }
        }}
      >
        {status === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      <span role="status" className="sr-only">
        {status === 'failed'
          ? 'Copy failed. Select and copy the text manually.'
          : status === 'copied'
            ? `${label} copied.`
            : ''}
      </span>
    </>
  );
}
