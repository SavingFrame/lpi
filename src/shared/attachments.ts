import type { ImageContent } from '@earendil-works/pi-ai';
import { toByteArray } from 'base64-js';

export class AttachmentError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const COMMAND_BODY_LIMIT = 6 * 1024 * 1024;
export const EVENT_BUFFER_LIMIT = 8 * 1024 * 1024;

export interface ImageAttachment extends ImageContent {
  mimeType: (typeof IMAGE_TYPES)[number];
}

export function imageAttachments(value: unknown): ImageAttachment[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > MAX_IMAGES) {
    throw new AttachmentError(`Attach at most ${MAX_IMAGES} images`);
  }
  let total = 0;
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AttachmentError('Invalid image attachment');
    }
    const raw = item as Record<string, unknown>;
    if (
      raw.type !== 'image' ||
      !IMAGE_TYPES.some((type) => type === raw.mimeType) ||
      typeof raw.data !== 'string' ||
      !raw.data.length ||
      raw.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
      raw.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(raw.data)
    ) {
      throw new AttachmentError('Invalid image. Use PNG, JPEG, GIF, or WebP');
    }
    const bytes = toByteArray(raw.data);
    const header = String.fromCharCode(...bytes.subarray(0, 12));
    total += bytes.length;
    if (total > MAX_IMAGE_BYTES) {
      throw new AttachmentError('Images must total at most 4 MiB', 413);
    }
    const valid =
      (raw.mimeType === 'image/png' && header.startsWith('\x89PNG\r\n\x1a\n')) ||
      (raw.mimeType === 'image/jpeg' && header.startsWith('\xff\xd8\xff')) ||
      (raw.mimeType === 'image/gif' && /^(GIF87a|GIF89a)/.test(header)) ||
      (raw.mimeType === 'image/webp' &&
        header.startsWith('RIFF') &&
        header.slice(8, 12) === 'WEBP');
    if (!valid) {
      throw new AttachmentError('Image contents do not match the image type');
    }
    return { type: 'image', mimeType: raw.mimeType as ImageAttachment['mimeType'], data: raw.data };
  });
}
