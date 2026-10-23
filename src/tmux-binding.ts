import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { piInventoryId } from './storage/session-id.js';

/** Keep conservative file reservations in tmux, surviving relay restarts and TUI switches. */
export function reserveManagedFile(file: string): void {
  const name = process.env.LPI_TMUX_SESSION;
  if (!name) {
    return;
  }
  if (!/^lpi-[a-f0-9-]{36}$/.test(name)) {
    throw new Error('Invalid managed tmux session');
  }
  const canonical = existsSync(file)
    ? realpathSync(file)
    : join(realpathSync(dirname(file)), basename(file));
  execFileSync(
    'tmux',
    ['-L', 'lpi', 'set-option', '-t', `=${name}:`, `@lpi_file_${piInventoryId(canonical)}`, '1'],
    { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] },
  );
}
