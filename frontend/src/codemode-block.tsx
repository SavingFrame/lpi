import type { ReactNode } from 'react';
import type { Message } from '../../src/shared/client-state';
import { codemodeCallInput, codemodeState } from './codemode-state';
import type { TranscriptTool } from './transcript-state';

const statuses = { running: 'Running', ok: 'Completed', error: 'Failed', cancelled: 'Cancelled' };

export function CodemodeBlock({
  tool,
  renderOutput,
}: {
  tool: TranscriptTool;
  renderOutput: (item: Message) => ReactNode;
}) {
  const state = codemodeState(tool);
  return (
    <section className="tool-block codemode-block" aria-label="codemode">
      <div className="codemode-heading">
        <span className="tool-name">codemode</span>
        <span className="muted">
          {state.calls.length} {state.calls.length === 1 ? 'call' : 'calls'}
        </span>
        <span className={tool.status === 'Failed' ? 'error' : 'muted'}>{tool.status}</span>
        {state.wallTime && <span className="muted">{state.wallTime}</span>}
        {state.errors > 0 && (
          <span className="error">
            {state.errors} nested {state.errors === 1 ? 'error' : 'errors'}
          </span>
        )}
        {state.cancelled > 0 && <span className="muted">{state.cancelled} cancelled</span>}
      </div>
      <div className="codemode-calls">
        {state.calls.map((call) => (
          <details className="codemode-call" key={call.key}>
            <summary>
              <span className="tool-name">{call.name}</span>
              <span className="tool-input" title={codemodeCallInput(call)}>
                {codemodeCallInput(call)}
              </span>
              <span className={`tool-status ${call.status === 'error' ? 'error' : ''}`}>
                {statuses[call.status]}
              </span>
              {call.durationMs !== undefined && (
                <span className="muted codemode-duration">
                  {call.durationMs < 1000
                    ? `${Math.round(call.durationMs)}ms`
                    : `${(call.durationMs / 1000).toFixed(1)}s`}
                </span>
              )}
            </summary>
            <div className="tool-body">
              <div className="muted">Saved argument preview (may be truncated)</div>
              <pre>{call.args || 'Unavailable'}</pre>
              {call.error && <pre className="error">{call.error}</pre>}
              {call.cost !== undefined && <p className="muted">Model cost: ${call.cost}</p>}
            </div>
          </details>
        ))}
      </div>
      {state.calls.length === 0 && (
        <p className="codemode-notice muted">
          {tool.status === 'Running' || tool.status === 'Pending'
            ? 'Waiting for nested calls.'
            : 'No nested call metadata available.'}
        </p>
      )}
      <details className="codemode-disclosure">
        <summary>Script</summary>
        <div className="tool-body">
          <pre>{state.script ?? 'Script unavailable.'}</pre>
        </div>
      </details>
      <details className="codemode-disclosure">
        <summary>Combined output</summary>
        <div className="tool-body">
          <p className="muted">Script output is not associated with individual nested calls.</p>
          {state.fullOutputPath && (
            <p className="muted">
              Full output was saved to <code>{state.fullOutputPath}</code>. This temporary file may
              no longer exist.
            </p>
          )}
          {state.output ? (
            renderOutput(state.output)
          ) : (
            <p className="muted">
              {tool.status === 'No result' ? 'No result available.' : 'Waiting for output.'}
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
