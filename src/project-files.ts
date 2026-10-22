import { execFile } from 'node:child_process';
import { lstat, opendir, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { Config } from './config.js';
import { AppError } from './shared/errors.js';
import type { ProjectFileSearch } from './shared/project-files.js';

const execute = promisify(execFile);
const ENTRY_LIMIT = 100_000;

/** Read names only. Git supplies ignored-file filtering and tracked-file exceptions. */
export async function searchProjectFiles(
  config: Config,
  projectId: string,
  query: string,
  signal?: AbortSignal,
): Promise<ProjectFileSearch> {
  const project = config.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  if (
    query.length > 4096 ||
    query.includes('\0') ||
    query.startsWith('/') ||
    query.split('/').includes('..')
  ) {
    throw new AppError('Invalid project file query', 400);
  }
  const root = await realpath(project.directory);
  const entries = new Map<string, boolean>();
  let truncated = false;
  try {
    const { stdout } = await execute(
      'git',
      ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'],
      {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, LC_ALL: 'C' },
        signal,
      },
    );
    for (const path of stdout.split('\0')) {
      if (
        !path ||
        path.startsWith('/') ||
        path.includes('\\') ||
        path.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git')
      ) {
        continue;
      }
      entries.set(path, false);
      for (let index = path.indexOf('/'); index !== -1; index = path.indexOf('/', index + 1)) {
        entries.set(path.slice(0, index), true);
      }
      if (entries.size >= ENTRY_LIMIT) {
        truncated = true;
        break;
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    if (
      !(error instanceof Error) ||
      !('stderr' in error) ||
      typeof error.stderr !== 'string' ||
      !error.stderr.includes('not a git repository')
    ) {
      throw new AppError(
        'Could not search project files (Git is required; search output is limited to 8 MiB)',
        503,
      );
    }
    // Outside Git, walk without following symlinks. No Git ignore rules apply here.
    const pending = [''];
    let scanned = 0;
    for (let index = 0; index < pending.length && !truncated; index++) {
      signal?.throwIfAborted();
      const parent = pending[index] ?? '';
      const directory = await opendir(join(root, parent));
      for await (const entry of directory) {
        signal?.throwIfAborted();
        if (++scanned > ENTRY_LIMIT) {
          truncated = true;
          break;
        }
        if (
          entry.name === '.git' ||
          entry.isSymbolicLink() ||
          (!entry.isDirectory() && !entry.isFile())
        ) {
          continue;
        }
        const path = parent ? `${parent}/${entry.name}` : entry.name;
        entries.set(path, entry.isDirectory());
        if (entry.isDirectory()) {
          pending.push(path);
        }
      }
    }
  }
  const normalizedQuery = query.replace(/^\.\//, '');
  const slash = normalizedQuery.lastIndexOf('/');
  const prefix = normalizedQuery.slice(0, slash + 1);
  const scoped = prefix && entries.get(prefix.slice(0, -1)) === true;
  const search = (scoped ? normalizedQuery.slice(slash + 1) : normalizedQuery).toLowerCase();
  // Mirror Pi's @ ranking: exact basename, prefix, basename substring, path substring.
  const ranked = [...entries].flatMap(([path, directory]) => {
    if (scoped && !path.startsWith(prefix)) {
      return [];
    }
    const name = basename(path).toLowerCase();
    const candidate = (scoped ? path.slice(prefix.length) : path).toLowerCase();
    const score = !search
      ? 1
      : name === search
        ? 100
        : name.startsWith(search)
          ? 80
          : name.includes(search)
            ? 50
            : candidate.includes(search)
              ? 30
              : 0;
    return score ? [{ path, directory, score: score + (directory && search ? 10 : 0) }] : [];
  });
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.path.split('/').length - b.path.split('/').length ||
      a.path.length - b.path.length ||
      a.path.localeCompare(b.path),
  );
  const results: ProjectFileSearch['entries'] = [];
  const safeParents = new Set<string>();
  let checked = 0;
  for (const entry of ranked) {
    signal?.throwIfAborted();
    if (++checked > 200) {
      truncated = true;
      break;
    }
    try {
      const parts = entry.path.split('/');
      let safe = true;
      for (let index = 1; index < parts.length; index++) {
        const parent = parts.slice(0, index).join('/');
        if (safeParents.has(parent)) {
          continue;
        }
        const info = await lstat(join(root, parent));
        if (!info.isDirectory() || info.isSymbolicLink()) {
          safe = false;
          break;
        }
        safeParents.add(parent);
      }
      if (!safe) {
        continue;
      }
      const info = await lstat(join(root, entry.path));
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
        continue;
      }
      results.push({ path: entry.path, directory: info.isDirectory() });
      if (results.length === 20) {
        break;
      }
    } catch {
      /* Ignore stale index entries and files removed during a search. */
    }
  }
  return { entries: results, truncated };
}
