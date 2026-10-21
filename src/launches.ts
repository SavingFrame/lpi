import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { NativeBridges } from './bridge/server.js';
import type { Config } from './config.js';
import type { Sessions } from './sessions.js';
import { AppError } from './shared/errors.js';
import type { Session } from './shared/sessions.js';

const execute = promisify(execFile);
export type Tmux = (args: string[]) => Promise<string>;

async function tmux(args: string[]): Promise<string> {
  try {
    const result = await execute('tmux', ['-L', 'pim', '-f', '/dev/null', ...args], {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    if (
      args[0] === 'list-sessions' &&
      error instanceof Error &&
      'stderr' in error &&
      typeof error.stderr === 'string' &&
      /no server running|no sessions|error connecting .*No such file/.test(error.stderr)
    ) {
      return '';
    }
    throw error;
  }
}

/** Explicit native-TUI launching. No runtime or conversation persistence in the relay. */
export class Launches {
  private busy = false;
  private readonly config: Config;
  private readonly sessions: Sessions;
  private readonly bridges: NativeBridges;
  private readonly run: Tmux;
  private readonly timeout: number;

  constructor(
    config: Config,
    sessions: Sessions,
    bridges: NativeBridges,
    run: Tmux = tmux,
    timeout = 20_000,
  ) {
    this.config = config;
    this.sessions = sessions;
    this.bridges = bridges;
    this.run = run;
    this.timeout = timeout;
  }

  async start(projectId: string, resumeId?: string, confirmedOffline = false): Promise<Session> {
    if (this.busy) {
      throw new AppError('Another launch is being checked. Wait before trying again', 409);
    }
    const project = this.config.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new AppError('Project not found', 404);
    }
    this.busy = true;
    let dispatched = false;
    try {
      const saved = resumeId ? this.sessions.get(resumeId) : undefined;
      if (saved && saved.projectId !== projectId) {
        throw new AppError('Session belongs to another project', 400);
      }
      if (saved?.connection === 'connected') {
        return saved;
      }
      const names = (await this.run(['list-sessions', '-F', '#{session_name}']))
        .trim()
        .split('\n')
        .filter(Boolean);
      if (names.length >= 32) {
        throw new AppError('Managed runtime limit reached', 429);
      }
      if (saved) {
        for (const name of names) {
          const options = await this.run(['show-options', '-t', `=${name}:`]);
          if (options.includes(`@pim_file_${saved.id} `)) {
            throw new AppError(
              `Pi may still be running in tmux session ${name}. Wait for its bridge or attach with tmux -L pim attach -t ${name}`,
              409,
            );
          }
          if (!options.includes('@pim_file_')) {
            throw new AppError(
              `Tmux session ${name} has not registered its file yet. Inspect it before resuming`,
              409,
            );
          }
        }
        if (!confirmedOffline) {
          throw new AppError('Confirm that no Pi process outside Pim is using this file', 409);
        }
        // Revalidate bounded history and identity immediately before opening a writer.
        this.sessions.validateResume(saved.id);
        if (this.sessions.get(saved.id).connection === 'connected') {
          return this.sessions.get(saved.id);
        }
      }
      const launchId = randomUUID();
      const name = `pim-${launchId}`;
      const host = this.config.host === '::' ? '[::1]' : '127.0.0.1';
      const endpointHost =
        this.config.host === '0.0.0.0' || this.config.host === '::'
          ? host
          : this.config.host.includes(':')
            ? `[${this.config.host}]`
            : this.config.host;
      const cli = join(
        dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))),
        'bundle/cli.js',
      );
      const args = [
        'new-session',
        '-d',
        '-s',
        name,
        '-c',
        realpathSync(project.directory),
        '-x',
        '120',
        '-y',
        '40',
        '-e',
        `PIM_BRIDGE_URL=ws://${endpointHost}:${this.config.port}/bridge`,
        '-e',
        `PIM_LAUNCH_ID=${launchId}`,
        '-e',
        `PIM_TMUX_SESSION=${name}`,
        process.execPath,
        cli,
        ...(saved ? ['--session', saved.file] : ['--session-id', launchId]),
      ];
      // Once sent to tmux, a lost subprocess result is not proof that Pi did not start.
      dispatched = true;
      await this.run(args);
      const deadline = Date.now() + this.timeout;
      while (Date.now() < deadline) {
        const attached = this.bridges.findLaunch(launchId);
        if (attached) {
          if (
            attached.projectId !== projectId ||
            (saved
              ? attached.file !== saved.file || attached.piSessionId !== saved.piSessionId
              : attached.piSessionId !== launchId)
          ) {
            throw new AppError('Launched Pi registered an unexpected session', 503, 'unknown');
          }
          return attached;
        }
        const current = await this.run(['list-sessions', '-F', '#{session_name}']);
        if (!current.trim().split('\n').includes(name)) {
          throw new AppError(
            'Pi exited before its bridge registered. Inspect native Pi setup',
            503,
          );
        }
        await delay(100);
      }
      throw new AppError(
        `Startup outcome unknown. Inspect tmux -L pim attach -t ${name}. Do not launch again automatically`,
        503,
        'unknown',
      );
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        dispatched
          ? 'Tmux launch outcome unknown. Inspect tmux -L pim list-sessions before trying again'
          : 'Cannot inspect tmux. Install tmux and check access to its dedicated pim socket',
        503,
        dispatched ? 'unknown' : 'rejected',
      );
    } finally {
      this.busy = false;
    }
  }
}
