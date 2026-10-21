import { AppError, object } from '../errors.ts';
import {
  type AskAnswer,
  type AskPrompt,
  askAnswer,
  askState,
} from './ask-user-question/contract.ts';

// Extension-specific state and actions, not a universal UI schema.
export interface ExtensionSnapshots {
  'ask-user-question'?: AskPrompt[];
}

export type ExtensionCommand = {
  type: 'extension';
  extension: 'ask-user-question';
  action: AskAnswer;
};

export function extensionSnapshots(value: unknown): ExtensionSnapshots {
  const raw = object(value);
  for (const id of Object.keys(raw)) {
    if (id !== 'ask-user-question') {
      throw new AppError('Unsupported extension snapshot', 400);
    }
  }
  return raw['ask-user-question'] === undefined
    ? {}
    : { 'ask-user-question': askState(raw['ask-user-question']) };
}

export function extensionCommand(value: unknown): ExtensionCommand {
  const raw = object(value);
  if (raw.type !== 'extension' || raw.extension !== 'ask-user-question') {
    throw new AppError('Unsupported extension action', 422);
  }
  return { type: 'extension', extension: 'ask-user-question', action: askAnswer(raw.action) };
}
