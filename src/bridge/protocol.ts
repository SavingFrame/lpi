import { AttachmentError, type ImageAttachment, imageAttachments } from '../attachments.js';
import { emptyView, message, record, type View } from '../client-state.js';
import { AppError, object, text } from '../errors.js';
import {
  isThinkingLevel,
  type SessionControls,
  sessionControls,
  type ThinkingLevel,
} from '../session-controls.js';

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
  | { type: 'set_model'; provider: string; modelId: string }
  | { type: 'set_thinking_level'; level: ThinkingLevel }
  | { type: 'abort' }
  | { type: 'stop_runtime' }
  | {
      type: 'prompt' | 'steer' | 'follow_up';
      message: string;
      images?: ImageAttachment[];
      streamingBehavior?: 'steer' | 'followUp';
    };

export function bridgeCommand(value: unknown): BridgeCommand {
  const raw = object(value);
  const type = text(raw.type, 'command type', 64);
  if (type === 'abort' || type === 'stop_runtime') {
    return { type };
  }
  if (type === 'set_model') {
    return {
      type,
      provider: text(raw.provider, 'provider', 256),
      modelId: text(raw.modelId, 'model ID', 256),
    };
  }
  if (type === 'set_thinking_level') {
    if (!isThinkingLevel(raw.level)) {
      throw new AppError('Invalid thinking level', 400);
    }
    return { type, level: raw.level };
  }
  if (type !== 'prompt' && type !== 'steer' && type !== 'follow_up') {
    throw new AppError('Unsupported native bridge command', 422);
  }
  let images: ImageAttachment[];
  try {
    images = imageAttachments(raw.images);
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : 'Invalid images',
      error instanceof AttachmentError ? error.status : 400,
    );
  }
  const message = images.length && raw.message === '' ? '' : text(raw.message, 'message');
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
    images: images.length ? images : undefined,
    streamingBehavior: type === 'prompt' ? raw.streamingBehavior : undefined,
  };
}
