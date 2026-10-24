import { Fragment, memo, type ReactNode } from 'react';
import { imageAttachments } from '../../../../src/shared/attachments';
import type { Message } from '../../../../src/shared/client-state';
import { displayArtifact } from '../../../../src/shared/display';
import { DeferredContent } from '../../components/deferred-content';
import { Disclosure } from '../../components/disclosure';
import { SafeMarkdown } from '../../components/safe-markdown';
import { DisplayCard } from './display/display-card';
import { AskHistory } from './tools/ask-history-card';
import { CodemodeBlock } from './tools/codemode-block';
import { ToolFileBody } from './tools/tool-file-body';
import { ToolStatus } from './tools/tool-status';
import { sameTranscriptTool, type TranscriptTool } from './transcript-state';

export const ToolBlock = memo(
  function ToolBlock({ tool }: { tool: TranscriptTool }) {
    const artifact = displayArtifact(tool.result);
    if (artifact) {
      return (
        <DeferredContent label={artifact.title}>
          {() => <DisplayCard artifact={artifact} />}
        </DeferredContent>
      );
    }
    if (tool.name === 'codemode') {
      return <CodemodeBlock tool={tool} renderOutput={(item) => <MessageBody item={item} />} />;
    }
    return (
      <AskHistory tool={tool}>
        <RawToolBlock tool={tool} />
      </AskHistory>
    );
  },
  (previous, next) => sameTranscriptTool(previous.tool, next.tool),
);

export function ToolGroup({ tools }: { tools: { key: string; tool: TranscriptTool }[] }) {
  const first = tools[0];
  if (tools.length === 1 && first) {
    return <ToolBlock tool={first.tool} />;
  }
  const failures = tools.filter(({ tool }) => tool.status === 'Failed').length;
  const status = tools.some(({ tool }) => tool.status === 'Running')
    ? 'Running'
    : tools.some(({ tool }) => tool.status === 'Pending')
      ? 'Pending'
      : tools.some(({ tool }) => tool.status === 'No result')
        ? 'No result'
        : failures > 0
          ? 'Failed'
          : 'Completed';
  return (
    <details className="tool-block tool-group" open>
      <summary>
        <span className="tool-name">Tools</span>
        <span className="muted">{tools.length} calls</span>
        <ToolStatus status={status} />
        {failures > 0 && <span className="error">{failures} failed</span>}
      </summary>
      <div className="tool-group-calls">
        {tools.map(({ key, tool }) => (
          <ToolBlock key={key} tool={tool} />
        ))}
      </div>
    </details>
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
    <Disclosure
      className="tool-block"
      defaultOpen={tool.name === 'edit' || tool.name === 'write'}
      summary={
        <>
          <span className="tool-name">{tool.name}</span>
          {typeof input === 'string' && <span className="tool-input">{input}</span>}
          <ToolStatus status={tool.status} className="tool-status" />
        </>
      }
    >
      {() => (
        <div className="tool-body">
          <ToolFileBody tool={tool}>
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
          </ToolFileBody>
        </div>
      )}
    </Disclosure>
  );
}

export function MessageBody({
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
        <div
          data-chat-search-text={item.role === 'user' || item.role === 'assistant' ? '' : undefined}
        >
          <SafeMarkdown>{content}</SafeMarkdown>
        </div>
      ) : (
        content?.map((block, index) => {
          const key = `${index}:${String(block.type)}`;
          if (block.type === 'text') {
            return (
              <Fragment key={key}>
                <div
                  data-chat-search-text={
                    item.role === 'user' || item.role === 'assistant' ? '' : undefined
                  }
                >
                  <SafeMarkdown>{String(block.text ?? '')}</SafeMarkdown>
                </div>
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

export function ToolResult({ item }: { item: Message }) {
  const tool: TranscriptTool = {
    name: String(item.toolName),
    args: undefined,
    result: item,
    status: item.isError === true ? 'Failed' : 'Completed',
  };
  if (item.toolName === 'codemode' || item.toolName === 'edit' || item.toolName === 'show') {
    return <ToolBlock tool={tool} />;
  }
  return (
    <AskHistory tool={tool}>
      <Disclosure summary="Tool output">
        {() => (
          <ToolFileBody tool={tool}>
            <MessageBody item={item} />
          </ToolFileBody>
        )}
      </Disclosure>
    </AskHistory>
  );
}
