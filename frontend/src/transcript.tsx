import Markdown from 'react-markdown';
import type { Message, View } from '../../src/client-state';

function MessageBody({ item }: { item: Message }) {
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
          if (block.type === 'thinking') {
            return (
              <details key={key}>
                <summary>Thinking</summary>
                <pre>{String(block.thinking ?? '')}</pre>
              </details>
            );
          }
          if (block.type === 'toolCall') {
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
  const messages = view.messages.filter((item) => item.role !== 'system' && item.display !== false);
  return (
    <section className="transcript" aria-label="Conversation">
      {messages.length === 0 && !view.partial && (
        <div className="empty">
          <h2>Start a conversation</h2>
          <p>Prompts run on your PC. Closing this browser does not stop the agent.</p>
        </div>
      )}
      {messages.map((item, index) => (
        <article
          className={`message ${item.role}`}
          key={`${item.role}:${item.timestamp}:${String(item.toolCallId ?? index)}`}
        >
          <header>
            {item.role === 'user'
              ? 'You'
              : item.role === 'assistant'
                ? 'Pi'
                : String(item.toolName ?? item.role)}
            {item.isError === true && ' (error)'}
          </header>
          {item.role === 'toolResult' ? (
            <details>
              <summary>Tool output</summary>
              <MessageBody item={item} />
            </details>
          ) : (
            <MessageBody item={item} />
          )}
        </article>
      ))}
      {view.partial && (
        <article className="message assistant partial">
          <header>
            Pi <span className="muted">streaming</span>
          </header>
          <MessageBody item={view.partial} />
        </article>
      )}
      {view.tools.map((tool) => (
        <article className="message toolResult" key={tool.id}>
          <header>
            {tool.name} <span className="muted">running</span>
          </header>
          <details>
            <summary>Arguments and progress</summary>
            <pre>{JSON.stringify(tool.args, null, 2)}</pre>
            {tool.result !== undefined && <pre>{JSON.stringify(tool.result, null, 2)}</pre>}
          </details>
        </article>
      ))}
    </section>
  );
}
