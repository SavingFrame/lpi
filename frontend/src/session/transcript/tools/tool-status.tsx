import { Check, LoaderCircle, X } from 'lucide-react';
import type { TranscriptTool } from '../transcript-state';

export function ToolStatus({
  status,
  className = '',
}: {
  status: TranscriptTool['status'] | 'Cancelled';
  className?: string;
}) {
  const Icon = status === 'Completed' ? Check : status === 'Failed' ? X : LoaderCircle;
  const running = status === 'Running';
  const iconStatus = running || status === 'Completed' || status === 'Failed';
  return (
    <span
      className={`tool-status-indicator ${className} ${
        status === 'Completed' ? 'text-green-400' : status === 'Failed' ? 'text-red-400' : 'muted'
      }`}
      title={status}
    >
      {iconStatus ? (
        <>
          <Icon
            size={14}
            aria-hidden="true"
            className={running ? 'animate-spin motion-reduce:animate-none' : undefined}
          />
          <span className="sr-only">{status}</span>
        </>
      ) : (
        status
      )}
    </span>
  );
}
