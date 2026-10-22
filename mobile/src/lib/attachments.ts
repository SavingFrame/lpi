import { toByteArray } from 'base64-js';
import {
  type ImageAttachment,
  imageAttachments,
  MAX_IMAGES,
} from '../../../src/shared/attachments.ts';

/** Detect the returned bytes, not the original asset's filename/MIME (HEIC may become JPEG). */
export function pickedImages(
  assets: { base64?: string | null }[],
  existing: ImageAttachment[],
): ImageAttachment[] {
  if (assets.length + existing.length > MAX_IMAGES) {
    throw new Error(`Attach at most ${MAX_IMAGES} images`);
  }
  const added = assets.map((asset): ImageAttachment => {
    if (!asset.base64) {
      throw new Error('Could not read the selected image. Try selecting it again.');
    }
    const header = String.fromCharCode(...toByteArray(asset.base64.slice(0, 16)));
    let mimeType: ImageAttachment['mimeType'];
    if (header.startsWith('\x89PNG\r\n\x1a\n')) {
      mimeType = 'image/png';
    } else if (header.startsWith('\xff\xd8\xff')) {
      mimeType = 'image/jpeg';
    } else if (/^(GIF87a|GIF89a)/.test(header)) {
      mimeType = 'image/gif';
    } else if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
      mimeType = 'image/webp';
    } else {
      throw new Error('Use PNG, JPEG, GIF, or WebP images.');
    }
    return { type: 'image', mimeType, data: asset.base64 };
  });
  return imageAttachments([...existing, ...added]);
}
