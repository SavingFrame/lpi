import { LoaderCircle } from 'lucide-react';
import Markdown from 'react-markdown';
import { imageAttachments } from '../../src/attachments';
import type { Message, View } from '../../src/client-state';
import { type TranscriptTool, transcriptState } from './transcript-state';

function ToolBlock({ tool }: { tool: TranscriptTool }) {
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

function MessageBody({ item, tools }: { item: Message; tools?: Map<string, TranscriptTool> }) {
  const content = item.content;
  return (
    <>
      {typeof content === 'string' ? (
        <Markdown skipHtml components={{ img: () => <span>[image]</span> }}>
          {content}
        </Markdown>
      ) : (
        content?.map((block, index) => {
          const key = `${index}:${String(block.type)}`;
          if (block.type === 'text') {
            return (
              <Markdown key={key} skipHtml components={{ img: () => <span>[image]</span> }}>
                {String(block.text ?? '')}
              </Markdown>
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
            return (
              <details key={key}>
                <summary>Thinking</summary>
                <pre>{String(block.thinking ?? '')}</pre>
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
      {typeof item.summary === 'string' && (
        <Markdown skipHtml components={{ img: () => <span>[image]</span> }}>
          {item.summary}
        </Markdown>
      )}
      {typeof item.output === 'string' && <pre>{item.output}</pre>}
      {typeof item.errorMessage === 'string' && <p className="error">{item.errorMessage}</p>}
    </>
  );
}

export function Transcript({ view }: { view: View }) {
  const { groups, tools, unpaired } = transcriptState(view);
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
                  <details>
                    <summary>Tool output</summary>
                    <MessageBody item={item} />
                  </details>
                ) : (
                  <MessageBody item={item} tools={tools} />
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
