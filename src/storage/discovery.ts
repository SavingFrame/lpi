import {
  closeSync,
  constants,
  type Dirent,
  fstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { buildSessionContext, parseSessionEntries } from '@earendil-works/pi-coding-agent';
import type { Project } from '../config.js';
import { AppError, object, text } from '../errors.js';
import { promptTitle, type Session } from '../sessions.js';
import { piInventoryId } from './session-id.js';

function header(content: string): { id: string; cwd: string; timestamp: string } {
  const raw = object(JSON.parse(content));
  if (
    raw.type !== 'session' ||
    (raw.version !== undefined &&
      (typeof raw.version !== 'number' || ![1, 2, 3].includes(raw.version))) ||
    typeof raw.timestamp !== 'string' ||
    !Number.isFinite(Date.parse(raw.timestamp)) ||
    typeof raw.cwd !== 'string' ||
    !isAbsolute(raw.cwd)
  ) {
    throw new Error('Invalid Pi session header');
  }
  return {
    id: text(raw.id, 'Pi session ID', 128),
    cwd: raw.cwd,
    timestamp: raw.timestamp,
  };
}

/** Read-only inventory of saved Pi sessions. Never opens an agent runtime. */
export class SessionDiscovery {
  private readonly sessions = new Map<string, Session>();
  readonly warnings: string[] = [];

  constructor(roots: string[], projects: Project[]) {
    const visited = new Set<string>();
    let candidates = 0;
    let directories = 0;
    for (const root of roots) {
      let entries: Dirent[];
      try {
        entries = readdirSync(root, { withFileTypes: true });
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          continue;
        }
        throw error;
      }
      const folders = [root];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (++directories > 10_000) {
            throw new Error('Pi session discovery directory limit reached');
          }
          folders.push(join(root, entry.name));
        }
      }
      for (const folder of folders) {
        for (const entry of readdirSync(folder, { withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
            continue;
          }
          if (++candidates > 10_000) {
            throw new Error('Pi session discovery file limit reached');
          }
          const path = join(folder, entry.name);
          try {
            const file = realpathSync(path);
            if (visited.has(file)) {
              continue;
            }
            visited.add(file);
            const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
            let firstLine: string;
            let title: string | undefined;
            let updatedAt: string;
            try {
              const stats = fstatSync(fd);
              updatedAt = stats.mtime.toISOString();
              const buffer = Buffer.alloc(65_536);
              const size = readSync(fd, buffer, 0, buffer.length, 0);
              const end = buffer.subarray(0, size).indexOf(10);
              if (end < 0) {
                throw new Error('Missing or oversized Pi session header');
              }
              firstLine = buffer.subarray(0, end).toString('utf8');
              // Bounded metadata reads, never load every transcript into the inventory.
              const chunks = [buffer.subarray(0, size).toString('utf8')];
              if (stats.size > buffer.length) {
                const tail = Buffer.alloc(65_536);
                const count = readSync(fd, tail, 0, tail.length, stats.size - tail.length);
                const start = tail.indexOf(10);
                chunks.push(tail.subarray(start + 1, count).toString('utf8'));
              }
              let name: string | undefined;
              for (const chunk of chunks) {
                for (const line of chunk.split('\n')) {
                  try {
                    const entry = object(JSON.parse(line));
                    if (entry.type === 'session_info' && typeof entry.name === 'string') {
                      name = promptTitle(entry.name);
                    } else if (!title && entry.type === 'message') {
                      const message = object(entry.message);
                      if (message.role === 'user') {
                        title = promptTitle(message.content);
                      }
                    }
                  } catch {
                    // Partial boundary lines do not invalidate the session header.
                  }
                }
              }
              title = name ?? title;
            } finally {
              closeSync(fd);
            }
            const metadata = header(firstLine);
            const directory = realpathSync(metadata.cwd);
            const project = projects.find((item) => item.directory === directory);
            if (!project) {
              continue;
            }
            // Paths distinguish copied/forked files even when their header IDs are duplicated.
            const id = piInventoryId(file);
            this.sessions.set(id, {
              id,
              projectId: project.id,
              directory,
              file,
              createdAt: metadata.timestamp,
              updatedAt,
              title,
              piSessionId: metadata.id,
              connection: 'disconnected',
              generation: 0,
            });
          } catch {
            this.warnings.push(`Skipped unreadable or invalid Pi session: ${path}`);
          }
        }
      }
    }
  }

  list(): Session[] {
    return structuredClone(
      [...this.sessions.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  get(id: string): Session | undefined {
    const session = this.sessions.get(id);
    return session ? structuredClone(session) : undefined;
  }

  inspect(id: string) {
    const session = this.get(id);
    if (!session) {
      throw new AppError('Session not found', 404);
    }
    let fd: number;
    try {
      fd = openSync(session.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch {
      throw new AppError('Pi transcript unavailable; refresh or restart discovery', 409);
    }
    try {
      const before = fstatSync(fd);
      if (!before.isFile() || before.size > 32 * 1024 * 1024) {
        throw new AppError('Pi transcript exceeds the 32 MiB read limit', 413);
      }
      // Read exactly the observed size, not an unbounded file growing under an external writer.
      const buffer = Buffer.alloc(before.size);
      let size = 0;
      while (size < buffer.length) {
        const count = readSync(fd, buffer, size, buffer.length - size, size);
        if (count === 0) {
          throw new AppError('Pi session changed during inspection; refresh', 409);
        }
        size += count;
      }
      const after = fstatSync(fd);
      const current = statSync(session.file);
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        after.ino !== current.ino ||
        after.dev !== current.dev ||
        after.size !== current.size ||
        after.mtimeMs !== current.mtimeMs
      ) {
        throw new AppError('Pi session changed during inspection; refresh', 409);
      }
      const content = buffer.toString('utf8');
      const lines = content.trimEnd().split('\n');
      const metadata = header(lines[0] ?? '');
      if (metadata.id !== session.piSessionId || realpathSync(metadata.cwd) !== session.directory) {
        throw new AppError('Pi session identity changed; restart discovery', 409);
      }
      // Pi's parser tolerates malformed lines. Do not silently hide a partially appended record.
      for (const line of lines) {
        JSON.parse(line);
      }
      const entries = parseSessionEntries(content).filter((entry) => entry.type !== 'session');
      const name = entries.findLast((entry) => entry.type === 'session_info')?.name;
      return { messages: buildSessionContext(entries).messages, name };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'Pi transcript unavailable or incomplete; refresh or restart discovery',
        409,
      );
    } finally {
      closeSync(fd);
    }
  }
}
