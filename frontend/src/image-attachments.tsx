import { ImagePlus, X } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import {
  IMAGE_TYPES,
  type ImageAttachment,
  imageAttachments,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
} from '../../src/attachments';

import { Button } from './components/ui/button';

export async function readImages(
  files: File[],
  existing: ImageAttachment[],
): Promise<ImageAttachment[]> {
  if (files.length + existing.length > MAX_IMAGES) {
    throw new Error(`Attach at most ${MAX_IMAGES} images`);
  }
  if (files.some((file) => !IMAGE_TYPES.some((type) => type === file.type))) {
    throw new Error('Use PNG, JPEG, GIF, or WebP images');
  }
  if (files.reduce((size, file) => size + file.size, 0) > MAX_IMAGE_BYTES) {
    throw new Error('Images must total at most 4 MiB');
  }
  const images = await Promise.all(
    files.map(
      (file) =>
        new Promise<ImageAttachment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
          reader.onabort = () => reject(new Error('Image reading cancelled'));
          reader.onload = () => {
            if (typeof reader.result !== 'string') {
              reject(new Error(`Could not read ${file.name}`));
              return;
            }
            resolve({
              type: 'image',
              mimeType: file.type as ImageAttachment['mimeType'],
              data: reader.result.slice(reader.result.indexOf(',') + 1),
            });
          };
          reader.readAsDataURL(file);
        }),
    ),
  );
  return imageAttachments([...existing, ...images]);
}

export function ImageAttachments({
  images,
  onChange,
  disabled,
  onBusy,
  children,
}: {
  images: ImageAttachment[];
  onChange: (images: ImageAttachment[]) => void;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const reading = useRef(false);
  const keys = useRef(new WeakMap<ImageAttachment, number>());
  const nextKey = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add(files: File[]) {
    if (disabled || reading.current || !files.length) {
      return;
    }
    reading.current = true;
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      onChange(await readImages(files, images));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not attach images');
    } finally {
      reading.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <fieldset
      className="image-attachments"
      aria-label="Message and attachments"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          void add(Array.from(event.dataTransfer.files));
        }
      }}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.files);
        if (files.length) {
          event.preventDefault();
          void add(files);
        }
      }}
    >
      {children}
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        multiple
        hidden
        disabled={disabled || busy}
        onChange={(event) => {
          void add(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <div className="attachment-toolbar">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || busy}
          onClick={() => input.current?.click()}
        >
          <ImagePlus aria-hidden="true" />
          {busy ? 'Reading images…' : 'Attach images'}
        </Button>
        <small className="muted">Paste or drop screenshots. Up to 4 images, 4 MiB total.</small>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {images.length > 0 && (
        <>
          <ul className="attachment-previews" aria-label="Attached images">
            {images.map((image, index) => {
              if (!keys.current.has(image)) {
                keys.current.set(image, nextKey.current++);
              }
              return (
                <li key={keys.current.get(image)}>
                  <img
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt={`Attachment ${index + 1}`}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={disabled || busy}
                    aria-label={`Remove attachment ${index + 1}`}
                    onClick={() => onChange(images.filter((_, i) => i !== index))}
                  >
                    <X aria-hidden="true" />
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
          <small className="muted">
            Unsent images are cleared when you leave or reload this session.
          </small>
        </>
      )}
    </fieldset>
  );
}
