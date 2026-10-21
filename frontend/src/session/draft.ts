import type { ImageAttachment } from '../../../src/shared/attachments.ts';
import type { BridgeCommand } from '../../../src/shared/commands.ts';

export interface ComposerDraft {
  text: string;
  images: ImageAttachment[];
}

export function composerCommand(draft: ComposerDraft, running: boolean): BridgeCommand {
  return {
    type: running ? 'steer' : 'prompt',
    message: draft.text.trim() ? draft.text : '',
    images: draft.images,
  };
}

/** Navigation may fill an empty composer, but never replaces an unsent draft. */
export function restoreComposerDraft(
  current: ComposerDraft,
  restored: ComposerDraft,
): ComposerDraft {
  return current.text.length > 0 || current.images.length > 0 ? current : restored;
}

/** Clear only accepted content, preserving edits made while acceptance was pending. */
export function settleComposerDraft(
  current: ComposerDraft,
  submitted: ComposerDraft,
  accepted: boolean,
): ComposerDraft {
  if (!accepted) {
    return current;
  }
  return {
    text: current.text === submitted.text ? '' : current.text,
    images: current.images === submitted.images ? [] : current.images,
  };
}
