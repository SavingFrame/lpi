import { Check, Copy, GitBranch, LoaderCircle } from 'lucide-react';
import { Fragment, type ReactNode, useState } from 'react';
import { imageAttachments } from '../../src/shared/attachments';
import type { Message, View } from '../../src/shared/client-state';
import { AskHistory } from './ask-history-card';
import { SafeMarkdown } from './components/safe-markdown';
import { Button } from './components/ui/button';
import {
  messageActionTargets,
  messageActionText,
  type TranscriptTool,
  transcriptState,
} from './transcript-state';

function ToolBlock({ tool }: { tool: TranscriptTool }) {
  return (
    <AskHistory tool={tool}>
      <RawToolBlock tool={tool} />
    </AskHistory>
  );
}

function RawToolBlock({ tool }: { tool: TranscriptTool }) {
  const args = tool.args;
  const input =
    typeof args === 'object' && args !== null
      ? Object.entries(args).find(
          ([key, value]) =>
            ['command', 'path', 'query', 'url'].includes(key) && typeof value === 'string',
        )?.[1]
      : undefined;
  return (
    <details className="tool-block">
      <summary>
        <span className="tool-name">{tool.name}</span>
        {typeof input === 'string' && <span className="tool-input">{input}</span>}
        <span className={`tool-status ${tool.status === 'Failed' ? 'error' : ''}`}>
          {tool.status}
        </span>
      </summary>
      <div className="tool-body">
        <div className="muted">Arguments</div>
        <pre>{JSON.stringify(args, null, 2) ?? 'Unavailable'}</pre>
        {tool.result ? (
          <>
            <div className="muted">Output</div>
            <MessageBody item={tool.result} />
          </>
        ) : tool.progress !== undefined ? (
          <>
            <div className="muted">Progress</div>
            <pre>{JSON.stringify(tool.progress, null, 2)}</pre>
          </>
        ) : (
          <p className="muted">
            {tool.status === 'No result' ? 'No result available.' : 'Waiting for output.'}
          </p>
        )}
      </div>
    </details>
  );
}

function MessageBody({
  item,
  tools,
  actions,
}: {
  item: Message;
  tools?: Map<string, TranscriptTool>;
  actions?: ReactNode;
}) {
  const content = item.content;
  const actionIndex =
    item.role === 'assistant' && Array.isArray(content)
      ? content.findLastIndex(
          (block) => block.type === 'text' && typeof block.text === 'string' && block.text.trim(),
        )
      : -1;
  return (
    <>
      {typeof content === 'string' ? (
        <SafeMarkdown>{content}</SafeMarkdown>
      ) : (
        content?.map((block, index) => {
          const key = `${index}:${String(block.type)}`;
          if (block.type === 'text') {
            return (
              <Fragment key={key}>
                <SafeMarkdown>{String(block.text ?? '')}</SafeMarkdown>
                {index === actionIndex && actions}
              </Fragment>
            );
          }
          if (block.type === 'image') {
            try {
              const image = imageAttachments([block])[0];
              if (image) {
                return (
                  <img
                    key={key}
                    className="message-image"
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt="Attachment"
                    loading="lazy"
                  />
                );
              }
            } catch {
              return (
                <p key={key} className="muted">
                  [Image preview unavailable]
                </p>
              );
            }
          }
          if (block.type === 'thinking') {
            if (typeof block.thinking !== 'string' || !block.thinking.trim()) {
              return null;
            }
            return (
              <details key={key}>
                <summary>Thinking</summary>
                <pre>{block.thinking}</pre>
              </details>
            );
          }
          if (block.type === 'toolCall') {
            const tool = typeof block.id === 'string' ? tools?.get(block.id) : undefined;
            if (tool) {
              return <ToolBlock key={key} tool={tool} />;
            }
            return (
              <details key={key}>
                <summary>Tool: {String(block.name)}</summary>
                <pre>{JSON.stringify(block.arguments, null, 2)}</pre>
              </details>
            );
          }
          return (
            <p key={key} className="muted">
              [{String(block.type ?? 'content')}]
            </p>
          );
        })
      )}
      {typeof item.summary === 'string' && <SafeMarkdown>{item.summary}</SafeMarkdown>}
      {typeof item.output === 'string' && <pre>{item.output}</pre>}
      {typeof item.errorMessage === 'string' && <p className="error">{item.errorMessage}</p>}
      {actionIndex === -1 && actions}
    </>
  );
}

function MessageActions({
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

export function Transcript({
  view,
  onPreview,
}: {
  view: View;
  onPreview?: (entryId: string) => void;
}) {
  const { groups, tools, unpaired } = transcriptState(view);
  const actionTargets = messageActionTargets(view);
  return (
    <section className="transcript" aria-label="Conversation">
      {groups.length === 0 && unpaired.length === 0 && !view.running && !view.compacting && (
        <div className="empty">
          <h2>Start a conversation</h2>
          <p>Prompts run on your PC. Closing this browser does not stop the agent.</p>
        </div>
      )}
      {groups.map((group) => (
        <article
          className={`message ${group.role}${group.streaming ? ' partial' : ''}`}
          key={group.key}
        >
          <header>
            {group.author}
            {group.streaming && <span className="muted">streaming</span>}
          </header>
          <div className="flex flex-col gap-3">
            {group.messages.map((item, messageIndex) => (
              <div key={group.messageKeys[messageIndex]}>
                {item.isError === true && <p className="error">Error</p>}
                {item.role === 'toolResult' ? (
                  <AskHistory
                    tool={{
                      name: String(item.toolName),
                      args: undefined,
                      result: item,
                      status: item.isError === true ? 'Failed' : 'Completed',
                    }}
                  >
                    <details>
                      <summary>Tool output</summary>
                      <MessageBody item={item} />
                    </details>
                  </AskHistory>
                ) : (
                  <MessageBody
                    item={item}
                    tools={tools}
                    actions={
                      actionTargets.has(item) && (
                        <MessageActions item={item} onPreview={onPreview} />
                      )
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </article>
      ))}
      {unpaired.map((tool) => {
        const activity = tools.get(tool.id);
        return activity ? (
          <article className="message toolResult" key={tool.id}>
            <ToolBlock tool={activity} />
          </article>
        ) : null;
      })}
      {(view.running || view.compacting) && (
        <div
          className="flex items-center gap-2 py-4 text-xs text-sky-300"
          role="status"
          aria-live="polite"
        >
          <LoaderCircle
            size={14}
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          {view.compacting ? 'Pi is compacting context…' : 'Pi is running…'}
        </div>
      )}
    </section>
  );
}
