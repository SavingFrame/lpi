import { emptyView, message, record, type View } from '../client-state.js';
import { AppError, object, text } from '../errors.js';
import { type SessionControls, sessionControls } from '../session-controls.js';

export const BRIDGE_LIMIT = 8 * 1024 * 1024;

export interface BridgeSnapshot {
  state: Record<string, unknown>;
  controls: SessionControls;
  view: View;
}

export function bridgeSnapshot(value: unknown): BridgeSnapshot {
  const raw = record(value);
  const state = record(raw.state);
  const view = record(raw.view);
  if (
    typeof state.isStreaming !== 'boolean' ||
    typeof state.hasPendingMessages !== 'boolean' ||
    typeof view.running !== 'boolean' ||
    typeof view.compacting !== 'boolean' ||
    !Array.isArray(view.messages) ||
    !Array.isArray(view.tools) ||
    view.tools.length > 512 ||
    (view.notice !== null && typeof view.notice !== 'string')
  ) {
    throw new Error('Invalid bridge snapshot');
  }
  return {
    state: { ...state, readOnly: false, nativeTui: true },
    controls: sessionControls(raw.controls),
    view: {
      ...emptyView(),
      messages: view.messages.map(message),
      partial: view.partial === null ? null : message(view.partial),
      tools: view.tools.map((value) => {
        const tool = record(value);
        return {
          id: text(tool.id, 'tool ID', 256),
          name: text(tool.name, 'tool name', 256),
          args: tool.args,
          result: tool.result,
        };
      }),
      running: view.running,
      compacting: view.compacting,
      notice: view.notice,
    },
  };
}

export type BridgeCommand =
  | { type: 'abort' }
  | {
      type: 'prompt' | 'steer' | 'follow_up';
      message: string;
      streamingBehavior?: 'steer' | 'followUp';
    };

export function bridgeCommand(value: unknown): BridgeCommand {
  const raw = object(value);
  const type = text(raw.type, 'command type', 64);
  if (type === 'abort') {
    return { type };
  }
  if (type !== 'prompt' && type !== 'steer' && type !== 'follow_up') {
    throw new AppError('Native bridge supports prompt, steer, follow-up, and abort only', 422);
  }
  const message = text(raw.message, 'message');
  if (message.trimStart().startsWith('/')) {
    throw new AppError('Remote native slash commands are not supported', 422);
  }
  if (
    raw.streamingBehavior !== undefined &&
    raw.streamingBehavior !== 'steer' &&
    raw.streamingBehavior !== 'followUp'
  ) {
    throw new AppError('Invalid streaming behavior', 400);
  }
  return {
    type,
    message,
    streamingBehavior: type === 'prompt' ? raw.streamingBehavior : undefined,
  };
}
