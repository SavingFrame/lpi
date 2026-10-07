import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { RpcCommand, RpcResponse } from '@earendil-works/pi-coding-agent';
import { AppError, object } from '../errors.js';
import type { Command } from './protocol.js';

interface Pending {
  type: Extract<RpcResponse, { success: true }>['command'];
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export class RpcProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly exited: Promise<Exit>;
  closed = false;
  stderr = '';
  private failure?: Error;
  private readonly pending = new Map<string, Pending>();
  private buffer = '';
  private readonly decoder = new StringDecoder('utf8');
  private readonly onFailure: (error: Error) => void;

  constructor(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    onEvent: (record: Record<string, unknown>) => void,
    onExit: (exit: Exit) => void,
    timeout = 30_000,
    onFailure: (error: Error) => void = () => {},
  ) {
    this.timeout = timeout;
    this.onFailure = onFailure;
    this.child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise((resolve) => {
      this.child.once('close', (code, signal) => {
        this.closed = true;
        this.fail(new AppError('RPC exited; command outcome unknown', 503, 'unknown'));
        resolve({ code, signal });
        onExit({ code, signal });
      });
    });
    this.child.on('error', (error) =>
      this.fail(new AppError(`RPC startup failed: ${error.message}`, 503, 'unknown')),
    );
    this.child.stdin.on('error', () => this.fail(new AppError('RPC input failed', 503, 'unknown')));
    this.child.stdout.on('error', () =>
      this.fail(new AppError('RPC output failed', 503, 'unknown')),
    );
    this.child.stderr.on('error', () =>
      this.fail(new AppError('RPC diagnostics failed', 503, 'unknown')),
    );
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-65_536);
    });
    this.child.stdout.on('data', (chunk: Buffer) => {
      if (this.failure) {
        return; // Continue draining, but discard failed protocol output.
      }
      this.buffer += this.decoder.write(chunk);
      while (true) {
        const newline = this.buffer.indexOf('\n');
        if (newline < 0) {
          break;
        }
        const line = this.buffer.slice(0, newline).replace(/\r$/, '');
        this.buffer = this.buffer.slice(newline + 1);
        if (!line) {
          continue;
        }
        try {
          if (Buffer.byteLength(line) > 8 * 1024 * 1024) {
            throw new Error('RPC record limit exceeded');
          }
          const record = object(JSON.parse(line));
          if (typeof record.type !== 'string') {
            throw new Error('Missing RPC record type');
          }
          if (record.type === 'response') {
            const pending = typeof record.id === 'string' ? this.pending.get(record.id) : undefined;
            if (!pending) {
              continue;
            }
            if (record.command !== pending.type || typeof record.success !== 'boolean') {
              throw new Error('Mismatched RPC response');
            }
            this.pending.delete(String(record.id));
            clearTimeout(pending.timer);
            if (record.success) {
              pending.resolve(record.data ?? null);
            } else {
              pending.reject(
                new AppError(
                  typeof record.error === 'string' ? record.error : 'RPC rejected command',
                  422,
                ),
              );
            }
          } else {
            onEvent(record);
          }
        } catch {
          this.fail(new AppError('Invalid RPC protocol; ownership retained', 503, 'unknown'));
          this.buffer = '';
          break;
        }
      }
      if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024) {
        this.buffer = '';
        this.fail(new AppError('RPC record limit exceeded', 503, 'unknown'));
      }
    });
  }

  private readonly timeout: number;

  private fail(error: Error): void {
    const firstFailure = !this.failure;
    this.failure ??= error;
    if (firstFailure && !this.closed) {
      this.onFailure(error);
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(command: Command): Promise<unknown> {
    if (this.failure || this.closed) {
      return Promise.reject(this.failure ?? new AppError('RPC closed', 503, 'unknown'));
    }
    if (this.pending.size >= 64 || this.child.stdin.writableLength > 1024 * 1024) {
      return Promise.reject(new AppError('RPC command backlog full', 429));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppError('RPC deadline exceeded; do not replay automatically', 504, 'unknown'));
      }, this.timeout);
      this.pending.set(id, { type: command.type, resolve, reject, timer });
      const record = { ...command, id } satisfies RpcCommand;
      this.child.stdin.write(`${JSON.stringify(record)}\n`, (error) => {
        if (error) {
          this.fail(new AppError('RPC write failed', 503, 'unknown'));
        }
      });
    });
  }

  async stop(): Promise<Exit> {
    if (!this.closed) {
      this.child.stdin.end();
    }
    for (const signal of [undefined, 'SIGTERM', 'SIGKILL'] as const) {
      if (signal && !this.closed) {
        this.child.kill(signal);
      }
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          this.exited,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('RPC shutdown deadline exceeded')), 3000);
          }),
        ]);
      } catch {
        // Only the close callback confirms release, never a signal or timeout.
      } finally {
        clearTimeout(timer);
      }
    }
    throw new AppError('RPC exit unconfirmed', 503, 'unknown');
  }
}
