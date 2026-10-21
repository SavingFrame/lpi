import { type ExtensionCommand, extensionCommand } from '../extension-support/registry.js';
import { AttachmentError, type ImageAttachment, imageAttachments } from './attachments.js';
import { AppError, object, text } from './errors.js';
import { isThinkingLevel, type ThinkingLevel } from './session-controls.js';

export const BRIDGE_LIMIT = 8 * 1024 * 1024;

export interface NativeIdentity {
  file: string;
  id: string;
  cwd: string;
  createdAt: string;
}

export type BridgeCommand =
  | ExtensionCommand
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
  if (type === 'extension') {
    return extensionCommand(raw);
  }
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
