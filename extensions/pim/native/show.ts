import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, resolve } from 'node:path';
import { Type } from '@earendil-works/pi-ai';
import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  type ImageAttachment,
  imageAttachments,
  MAX_IMAGE_BYTES,
} from '../../../src/shared/attachments.js';
import { type DisplayArtifact, MAX_HTML_BYTES } from '../../../src/shared/display.js';

const imageTypes: Record<string, ImageAttachment['mimeType']> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export function registerShow(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool({
      name: 'show',
      label: 'Show',
      exposure: 'model-only',
      promptSnippet: 'Show inline charts, diagrams, images and interactive visual replies',
      promptGuidelines: [
        'When presenting results, use show proactively when a chart, table, diagram, collage, or mockup explains them better than prose; do not wait for an explicit request for a visual. Default to a line chart for sampled values over time, such as CPU usage over 10 seconds, with labeled axes and units. Respect explicit text-only requests and keep single measurements or simple facts as text.',
        'Measure or retrieve actual data before visualizing it; never invent samples or continue monitoring beyond the requested duration. Use established browser chart libraries from HTTP(S) CDNs when useful instead of drawing charts from scratch. Prefer version-pinned HTTPS browser-ready builds, use pim.color() for Canvas theme colors rather than CSS var() strings, and use show before the final reply. Add only interpretation not already present in the visual.',
      ],
      description: [
        'Show an inline visual reply in Pim: charts, diagrams, comparisons, image collages, or interactive explanations. Call directly, not through codemode.',
        'For a new visual pass HTML directly in html, without writing a temporary file first. For an existing PNG/JPEG/GIF/WebP image (4 MiB) or HTML file (1 MiB), use path instead. Supply exactly one of html or path.',
        'The visual is part of your reply, not a separate website. Use fluid width, concise headings, and no outer card, border, banner title, page background, or outer horizontal padding. Align content with the reply text. Give individual charts sensible fixed pixel heights and let the full document grow with its content. Never use viewport-height units (vh, svh, lvh, dvh), root percentage heights, or layouts driven by window.innerHeight.',
        'Pim supplies its current theme and font through CSS variables: --background, --foreground, --muted-foreground, --card, --border, --accent, --chart-1 through --chart-6, --font-sans, --font-mono, and --radius. Use these rather than hardcoded page colors or fonts. Inner panels may use var(--card) with padding and rounded corners. Default body margin is zero.',
        'Canvas does not inherit CSS colors. Read resolved colors with pim.color("--chart-1"), never pass literal var(--...) strings to a chart library. Theme series, labels, axes, grids, legends and tooltips for both light and dark backgrounds. Apply colors initially and register pim.onThemeChange(applyTheme) to reapply them and update the existing chart without recreating it or resetting controls; registration returns an unsubscribe function.',
        'Chart.js example after creating chart: const applyTheme = () => { Chart.defaults.color = pim.color("--muted-foreground"); Chart.defaults.borderColor = pim.color("--border"); chart.data.datasets[0].borderColor = pim.color("--chart-1"); chart.update("none"); }; applyTheme(); pim.onThemeChange(applyTheme); Apply any explicit per-axis, legend, tooltip and additional series colors inside applyTheme too.',
        'Inline CSS, JavaScript, SVG, Canvas and embedded data images work. You may load external scripts, styles and fonts from any HTTP(S) CDN, without an allowlist or local bundle requirement. Use a suitable library such as Chart.js, Apache ECharts, D3 or uPlot instead of hand-writing chart primitives when helpful. Prefer version-pinned HTTPS browser builds that do not need eval or workers. External images, local file references, fetch/XHR/WebSocket API calls, nested remote pages and agent commands stay blocked. Collect data with tools and embed it in the HTML. Make controls and chart labels accessible and layouts usable at about 360px as well as desktop width.',
        'summary is an accessibility and terminal fallback, not a visible caption. Publish before your final text reply. The reader already sees the visual: do not announce it, describe where it was saved, or repeat its contents. Add only useful interpretation not already in the visual. The saved result is a snapshot; local control state is not persisted.',
      ].join('\n'),
      parameters: Type.Object({
        path: Type.Optional(
          Type.String({
            description: 'Existing image or HTML file. Prefer html directly for new visuals.',
          }),
        ),
        html: Type.Optional(
          Type.String({
            minLength: 1,
            maxLength: MAX_HTML_BYTES,
            description:
              'HTML for an inline visual reply; CDN scripts/styles are allowed. Do not also supply path.',
          }),
        ),
        title: Type.Optional(Type.String({ maxLength: 160, description: 'Short display title.' })),
        summary: Type.String({
          maxLength: 2000,
          description: 'Accessibility and terminal fallback, not a visible caption. Keep concise.',
        }),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      async execute(_id, params, signal, _onUpdate, context) {
        signal?.throwIfAborted();
        if ((params.html !== undefined) === (params.path !== undefined)) {
          throw new Error('Supply exactly one of html or path.');
        }
        const input = params.path?.startsWith('~/')
          ? resolve(homedir(), params.path.slice(2))
          : params.path;
        const path = input === undefined ? undefined : resolve(context.cwd, input);
        const extension = path === undefined ? '.html' : extname(path).toLowerCase();
        const isHtml = extension === '.html' || extension === '.htm';
        const mimeType = imageTypes[extension];
        if (!isHtml && !mimeType) {
          throw new Error('Show supports HTML, PNG, JPEG, GIF and WebP files only.');
        }
        const title = params.title?.trim() || (path === undefined ? 'Visual' : basename(path));
        const filename =
          path === undefined
            ? `${title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 100) || 'visual'}.html`
            : basename(path);
        if (
          title.length > 160 ||
          filename.length > 255 ||
          filename.includes('\\') ||
          Array.from(filename).some((character) => character.charCodeAt(0) < 32)
        ) {
          throw new Error('Use a shorter filename/title without control characters.');
        }
        const limit = isHtml ? MAX_HTML_BYTES : MAX_IMAGE_BYTES;
        let bytes: Buffer;
        if (params.html !== undefined) {
          if (!params.html.trim() || Buffer.byteLength(params.html, 'utf8') > MAX_HTML_BYTES) {
            throw new Error('HTML must be nonempty and at most 1 MiB of UTF-8.');
          }
          bytes = Buffer.from(params.html, 'utf8');
        } else {
          if (path === undefined) {
            throw new Error('A file path is required when html is not supplied.');
          }
          // Nonblocking open plus fstat rejects FIFOs/devices; reads stay bounded if a file grows.
          const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
          try {
            const stat = await file.stat();
            if (!stat.isFile() || stat.size > limit) {
              throw new Error(`Show requires a regular file of at most ${isHtml ? '1' : '4'} MiB.`);
            }
            const buffer = Buffer.alloc(limit + 1);
            let length = 0;
            while (length < buffer.length) {
              signal?.throwIfAborted();
              const chunk = await file.read(buffer, length, buffer.length - length, null);
              if (!chunk.bytesRead) {
                break;
              }
              length += chunk.bytesRead;
            }
            if (!length || length > limit) {
              throw new Error('The selected file is empty or exceeds the display size limit.');
            }
            bytes = buffer.subarray(0, length);
          } finally {
            await file.close();
          }
        }
        signal?.throwIfAborted();
        const metadata = { version: 1 as const, title, filename, summary: params.summary };
        let artifact: DisplayArtifact;
        if (isHtml) {
          const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          if (/(?:^|[^\w.+/])(?:\d+(?:\.\d+)?|\.\d+)[sld]?vh(?![\w-])/i.test(html)) {
            throw new Error(
              'Inline visuals size to their content. Replace viewport-height units with content-based or fixed pixel heights.',
            );
          }
          artifact = { ...metadata, kind: 'html', html };
        } else {
          const image = imageAttachments([
            { type: 'image', mimeType, data: bytes.toString('base64') },
          ])[0];
          if (!image) {
            throw new Error('Invalid image.');
          }
          artifact = { ...metadata, kind: 'image', image };
        }
        return {
          content: [
            {
              type: 'text',
              text: `Saved inline visual for Pim: ${title}.\n${params.summary}\nThe reader sees the visual above your reply. Do not announce or repeat it; add only new interpretation.`,
            },
          ],
          details: { pimDisplay: artifact },
        };
      },
    }),
  );
}
