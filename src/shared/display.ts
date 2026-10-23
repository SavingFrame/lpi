import { type ImageAttachment, imageAttachments } from './attachments.ts';

export const MAX_HTML_BYTES = 1024 * 1024;
export const MIN_DISPLAY_HEIGHT = 80;
export const MAX_DISPLAY_HEIGHT = 20_000;

export interface DisplayTheme {
  appearance: 'light' | 'dark';
  background: string;
  foreground: string;
  muted: string;
  card: string;
  border: string;
  accent: string;
  fontFamily: string;
  fontSize: string;
  monoFontFamily: string;
}

export const DEFAULT_DISPLAY_THEME: DisplayTheme = {
  appearance: 'dark',
  background: '#18181b',
  foreground: '#f4f4f5',
  muted: '#a1a1aa',
  card: '#27272a',
  border: '#2e2e32',
  accent: '#a5b4fc',
  fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
  fontSize: '14px',
  monoFontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

/** Size is untrusted presentation data, never an action or an unbounded layout request. */
export function displayContentHeight(value: unknown, id: string): number | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.type === 'pim-display-size' &&
    raw.id === id &&
    typeof raw.height === 'number' &&
    Number.isFinite(raw.height) &&
    raw.height > 0
  ) {
    return Math.min(MAX_DISPLAY_HEIGHT, Math.max(MIN_DISPLAY_HEIGHT, Math.ceil(raw.height)));
  }
}

interface DisplayMetadata {
  version: 1;
  title: string;
  filename: string;
  summary: string;
}

export type DisplayArtifact = DisplayMetadata &
  ({ kind: 'html'; html: string } | { kind: 'image'; image: ImageAttachment });

/** Only explicit, successful show results can opt into executable presentation. */
export function displayArtifact(value: unknown): DisplayArtifact | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }
  const message = value as Record<string, unknown>;
  if (message.role !== 'toolResult' || message.toolName !== 'show' || message.isError === true) {
    return;
  }
  const details = message.details as { pimDisplay?: unknown } | undefined;
  const valueArtifact = details?.pimDisplay;
  if (!valueArtifact || typeof valueArtifact !== 'object' || Array.isArray(valueArtifact)) {
    return;
  }
  const raw = valueArtifact as Record<string, unknown>;
  if (
    raw.version !== 1 ||
    typeof raw.title !== 'string' ||
    !raw.title.trim() ||
    raw.title.length > 160 ||
    typeof raw.filename !== 'string' ||
    !raw.filename.trim() ||
    raw.filename.length > 255 ||
    /[\\/]/.test(raw.filename) ||
    Array.from(raw.filename).some((character) => character.charCodeAt(0) < 32) ||
    typeof raw.summary !== 'string' ||
    raw.summary.length > 2000
  ) {
    return;
  }
  const metadata: DisplayMetadata = {
    version: 1,
    title: raw.title,
    filename: raw.filename,
    summary: raw.summary,
  };
  if (raw.kind === 'html' && typeof raw.html === 'string' && raw.html.length <= MAX_HTML_BYTES) {
    return { ...metadata, kind: 'html', html: raw.html };
  }
  if (raw.kind === 'image') {
    try {
      const image = imageAttachments([raw.image])[0];
      if (image) {
        return { ...metadata, kind: 'image', image };
      }
    } catch {
      // Unsupported or malformed persisted data retains the ordinary tool fallback.
    }
  }
}

export const DISPLAY_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' http: https:",
  "style-src 'unsafe-inline' http: https:",
  'img-src data: blob:',
  'font-src data: http: https:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** Native navigation delegates never forward a rejected URL to the system browser. */
export function displayNavigationAllowed(url: string): boolean {
  return url === 'about:blank' || url === 'about:srcdoc';
}
