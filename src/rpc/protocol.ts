import type { RpcCommand } from '@earendil-works/pi-coding-agent';
import { AppError, object, text } from '../errors.js';

// Keep the managed command surface narrow while deriving wire shapes from Pi.
export type Command = Extract<
  RpcCommand,
  {
    type:
      | 'prompt'
      | 'steer'
      | 'follow_up'
      | 'abort'
      | 'clear_queue'
      | 'get_state'
      | 'set_model'
      | 'get_available_models'
      | 'set_thinking_level'
      | 'get_available_thinking_levels'
      | 'get_messages'
      | 'get_entries'
      | 'get_tree'
      | 'get_session_stats'
      | 'get_commands';
  }
>;

export function parseCommand(value: unknown): Command {
  const raw = object(value);
  const type = text(raw.type, 'command type', 64);
  if (type === 'prompt' || type === 'steer' || type === 'follow_up') {
    const message = text(raw.message, 'message');
    if (type === 'prompt') {
      if (
        raw.streamingBehavior !== undefined &&
        raw.streamingBehavior !== 'steer' &&
        raw.streamingBehavior !== 'followUp'
      ) {
        throw new AppError('Invalid streaming behavior', 400);
      }
      return { type, message, streamingBehavior: raw.streamingBehavior };
    }
    return { type, message };
  }
  if (type === 'set_model') {
    return {
      type,
      provider: text(raw.provider, 'provider', 256),
      modelId: text(raw.modelId, 'model ID', 256),
    };
  }
  if (type === 'set_thinking_level') {
    const level = raw.level;
    if (
      level !== 'off' &&
      level !== 'minimal' &&
      level !== 'low' &&
      level !== 'medium' &&
      level !== 'high' &&
      level !== 'xhigh' &&
      level !== 'max'
    ) {
      throw new AppError('Invalid thinking level', 400);
    }
    return { type, level };
  }
  if (
    type === 'get_available_models' ||
    type === 'get_available_thinking_levels' ||
    type === 'abort' ||
    type === 'clear_queue' ||
    type === 'get_state' ||
    type === 'get_messages' ||
    type === 'get_entries' ||
    type === 'get_tree' ||
    type === 'get_session_stats'
  ) {
    return { type };
  }
  throw new AppError('Command not supported', 400);
}
