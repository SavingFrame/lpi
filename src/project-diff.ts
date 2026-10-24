import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Config } from './config.js';
import { AppError } from './shared/errors.js';
import type { ProjectDiff } from './shared/project-diff.js';

const execute = promisify(execFile);
const LIMIT = 4 * 1024 * 1024;

/** Read-only comparison against HEAD, including staged, unstaged and untracked files. */
export async function readProjectDiff(
  config: Config,
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectDiff> {
  const project = config.projects.find((item) => item.id === projectId);
  if (!project) {
    throw new AppError('Project not found', 404);
  }
  const git = async (args: string[], differences = false): Promise<string> => {
    try {
      const { stdout } = await execute('git', ['-C', project.directory, ...args], {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: LIMIT,
        signal,
        env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' },
      });
      return stdout;
    } catch (error) {
      if (
        differences &&
        error instanceof Error &&
        'code' in error &&
        error.code === 1 &&
        'stdout' in error &&
        typeof error.stdout === 'string'
      ) {
        return error.stdout;
      }
      throw error;
    }
  };
  try {
    // Confirm Git before interpreting a missing HEAD as an unborn repository.
    await git(['rev-parse', '--show-toplevel']);
    let base: string;
    try {
      base = (await git(['rev-parse', '--verify', 'HEAD'])).trim();
    } catch {
      signal?.throwIfAborted();
      base = (await git(['hash-object', '-t', 'tree', '/dev/null'])).trim();
    }
    const options = [
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--src-prefix=a/',
      '--dst-prefix=b/',
    ];
    let patch = await git(['diff', ...options, base, '--', '.']);
    const paths = (await git(['ls-files', '--others', '--exclude-standard', '-z', '--', '.']))
      .split('\0')
      .filter(Boolean);
    let truncated = paths.length > 100;
    for (const path of paths.slice(0, 100)) {
      signal?.throwIfAborted();
      // Git's no-index mode compares symlinks themselves, never their targets.
      const addition = await git(['diff', ...options, '--no-index', '--', '/dev/null', path], true);
      if (Buffer.byteLength(patch) + Buffer.byteLength(addition) > LIMIT) {
        truncated = true;
        break;
      }
      patch += addition;
    }
    return { patch, truncated };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    throw new AppError(
      'Could not read diff. Git is required; diff output is limited to 4 MiB.',
      503,
    );
  }
}
