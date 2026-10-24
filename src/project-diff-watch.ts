import { createHash } from 'node:crypto';
import type { Config } from './config.js';
import { readProjectDiff } from './project-diff.js';
import { AppError } from './shared/errors.js';
import type { ProjectDiff } from './shared/project-diff.js';

interface Watch {
  listeners: Set<() => void>;
  data?: ProjectDiff;
  error?: AppError;
  digest?: string;
  pending?: Promise<void>;
  controller?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}

/** One bounded Git check per subscribed project, shared by every browser and phone. */
export class ProjectDiffWatch {
  private readonly watches = new Map<string, Watch>();
  private readonly config: Config;
  private readonly read: typeof readProjectDiff;
  private readonly interval: number;

  constructor(config: Config, read = readProjectDiff, interval = 1000) {
    this.config = config;
    this.read = read;
    this.interval = interval;
  }

  validate(projectId: string): void {
    if (!this.config.projects.some((project) => project.id === projectId)) {
      throw new AppError('Project not found', 404);
    }
    if (!this.watches.has(projectId) && this.watches.size >= 8) {
      throw new AppError('Diff subscription limit reached', 429);
    }
  }

  subscribe(projectId: string, listener: () => void): () => void {
    this.validate(projectId);
    let watch = this.watches.get(projectId);
    if (!watch) {
      watch = { listeners: new Set() };
      this.watches.set(projectId, watch);
    }
    watch.listeners.add(listener);
    void this.check(projectId, watch);
    return () => {
      watch.listeners.delete(listener);
      if (watch.listeners.size === 0 && this.watches.get(projectId) === watch) {
        this.watches.delete(projectId);
        clearTimeout(watch.timer);
        watch.controller?.abort();
      }
    };
  }

  async get(projectId: string, signal: AbortSignal): Promise<ProjectDiff> {
    const watch = this.watches.get(projectId);
    if (!watch) {
      return this.read(this.config, projectId, signal);
    }
    await (watch.pending ?? (watch.data || watch.error ? undefined : this.check(projectId, watch)));
    signal.throwIfAborted();
    if (watch.error) {
      throw watch.error;
    }
    if (!watch.data) {
      throw new AppError('Diff subscription closed. Refresh to try again.', 503);
    }
    return watch.data;
  }

  private check(projectId: string, watch: Watch): Promise<void> {
    if (watch.pending) {
      return watch.pending;
    }
    clearTimeout(watch.timer);
    const controller = new AbortController();
    watch.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    watch.pending = (async () => {
      try {
        const data = await this.read(this.config, projectId, controller.signal);
        if (this.watches.get(projectId) !== watch) {
          return;
        }
        const digest = createHash('sha256')
          .update(data.patch)
          .update(String(data.truncated))
          .digest('hex');
        const changed = digest !== watch.digest || watch.error !== undefined;
        watch.data = digest === watch.digest && watch.data ? watch.data : data;
        watch.digest = digest;
        watch.error = undefined;
        if (changed) {
          for (const listener of watch.listeners) {
            listener();
          }
        }
      } catch (error) {
        if (this.watches.get(projectId) === watch) {
          const failure =
            error instanceof AppError
              ? error
              : new AppError('Could not update diff. Retrying…', 503);
          const changed = watch.error?.message !== failure.message;
          watch.error = failure;
          if (changed) {
            for (const listener of watch.listeners) {
              listener();
            }
          }
        }
      } finally {
        clearTimeout(timeout);
        watch.pending = undefined;
        if (this.watches.get(projectId) === watch) {
          watch.timer = setTimeout(() => void this.check(projectId, watch), this.interval);
          watch.timer.unref();
        }
      }
    })();
    return watch.pending;
  }

  close(): void {
    for (const watch of this.watches.values()) {
      clearTimeout(watch.timer);
      watch.controller?.abort();
    }
    this.watches.clear();
  }
}
