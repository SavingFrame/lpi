import { LoaderCircle } from 'lucide-react';
import { memo } from 'react';
import type { View } from '../../../../src/shared/client-state';
import { MessageActions } from './message-actions';
import { MessageBody, ToolBlock, ToolGroup, ToolResult } from './message-content';
import { messageActionTargets, transcriptEntries, transcriptState } from './transcript-state';

export const Transcript = memo(
  function Transcript({ view, onPreview }: { view: View; onPreview?: (entryId: string) => void }) {
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
              {transcriptEntries(group.messages, group.messageKeys, tools).map((entry) => {
                if (entry.kind === 'tool') {
                  return <ToolBlock key={entry.key} tool={entry.tool} />;
                }
                if (entry.kind === 'tools') {
                  return <ToolGroup key={entry.key} tools={entry.tools} />;
                }
                const { item, source } = entry;
                return (
                  <div key={entry.key}>
                    {item.isError === true && <p className="error">Error</p>}
                    {item.role === 'toolResult' ? (
                      <ToolResult item={item} />
                    ) : (
                      <MessageBody
                        item={item}
                        tools={tools}
                        actions={
                          entry.actions &&
                          actionTargets.has(source) && (
                            <MessageActions item={source} onPreview={onPreview} />
                          )
                        }
                      />
                    )}
                  </div>
                );
              })}
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
  },
  (previous, next) =>
    previous.onPreview === next.onPreview &&
    previous.view.messages === next.view.messages &&
    previous.view.partial === next.view.partial &&
    previous.view.tools === next.view.tools &&
    previous.view.running === next.view.running &&
    previous.view.compacting === next.view.compacting,
);
