import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

// Persist before publishing ownership changes. One coordinator holds the directory lock.
export function atomicJson(path: string, value: unknown): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

export function acquireCoordinatorLock(root: string): () => void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = join(root, 'coordinator.lock');
  // Never infer release from a missing PID or elapsed timeout.
  mkdirSync(lock, { mode: 0o700 });
  atomicJson(join(lock, 'owner.json'), { pid: process.pid, startedAt: new Date().toISOString() });
  return () => rmSync(lock, { recursive: true });
}
