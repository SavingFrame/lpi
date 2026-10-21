import type { ImageAttachment } from '../../../src/shared/attachments.ts';

export interface ComposerDraft {
  text: string;
  images: ImageAttachment[];
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
