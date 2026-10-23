import { randomUUID } from 'node:crypto';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { AppError } from '../../../src/shared/errors.js';

interface Navigation {
  token: string;
  targetId: string;
  validate: (context: ExtensionCommandContext) => void;
  resolve: () => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Obtain a fresh public command context without a terminal-input proxy or model turn. */
export class NativeNavigation {
  busy = false;
  private pending: Navigation | undefined;
  private readonly pi: ExtensionAPI;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
    pi.registerCommand('lpi-tree', {
      description: 'Internal lpi tree navigation. Use the browser branch controls.',
      handler: async (args, context) => {
        const pending = this.pending;
        if (!pending || args !== pending.token) {
          return;
        }
        // Consume before awaiting. A duplicate command can never navigate twice.
        this.pending = undefined;
        try {
          pending.validate(context);
          const result = await context.navigateTree(pending.targetId, { summarize: false });
          if (result.cancelled) {
            throw new AppError('Native tree navigation was cancelled', 422);
          }
          pending.resolve();
        } catch (error) {
          pending.reject(error);
        } finally {
          clearTimeout(pending.timer);
          this.busy = false;
        }
      },
    });
  }

  navigate(targetId: string, validate: Navigation['validate']): Promise<void> {
    this.busy = true;
    return new Promise((resolve, reject) => {
      const pending: Navigation = {
        token: randomUUID(),
        targetId,
        validate,
        resolve,
        reject,
        timer: setTimeout(() => {
          if (this.pending === pending) {
            this.pending = undefined;
            this.busy = false;
          }
          // Once a hook is running, retain the busy guard until it finishes.
          reject(new Error('Native tree navigation outcome unknown'));
        }, 8000),
      };
      this.pending = pending;
      try {
        this.pi.sendUserMessage(`/lpi-tree ${pending.token}`, { expandPromptTemplates: true });
      } catch (error) {
        clearTimeout(pending.timer);
        this.pending = undefined;
        this.busy = false;
        reject(error);
      }
    });
  }
}
