import { desktop } from './platform';

export async function copyText(text: string): Promise<void> {
  if (desktop) {
    await desktop.copyText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}
