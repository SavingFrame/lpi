import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { record } from '../../shared/client-state.js';

export function registerImageEntry(pi: ExtensionAPI): void {
  pi.registerEntryRenderer('pim-image-attachments', (entry, _options, theme) => {
    if (!entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data)) {
      return undefined;
    }
    const data = record(entry.data);
    if (
      typeof data.count !== 'number' ||
      !Number.isSafeInteger(data.count) ||
      data.count < 1 ||
      (data.mode !== 'prompt' && data.mode !== 'steer' && data.mode !== 'follow_up')
    ) {
      return undefined;
    }
    const mode = data.mode === 'follow_up' ? 'follow-up' : data.mode;
    const label = `Pim: ${data.count} image${data.count === 1 ? '' : 's'} submitted (${mode})`;
    return {
      render: (width) => [theme.fg('muted', label.slice(0, Math.max(0, width)))],
      invalidate() {},
    };
  });
}
