import { randomUUID } from 'node:crypto';
import { AgentSession, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { AppError } from '../../shared/errors.js';
import type { PendingQueue } from '../../shared/queue.js';

/** Unsupported Pi 1.3.0 adapter. Never creates a runtime or replaces its queues. */
export class NativeQueue {
  private session: AgentSession | undefined;
  private unsubscribe: (() => void) | undefined;
  private restore: (() => void) | undefined;
  private revision = randomUUID();
  private context: (() => ExtensionContext | undefined) | undefined;

  start(context: () => ExtensionContext | undefined): void {
    this.dispose();
    this.context = context;
    // Pi loads this TypeScript source through Jiti, resolving its own AgentSession class.
    const prototype = AgentSession.prototype;
    const prompt = prototype.prompt;
    const steering = prototype.getSteeringMessages;
    if (
      typeof prompt !== 'function' ||
      typeof steering !== 'function' ||
      typeof prototype.getFollowUpMessages !== 'function' ||
      typeof prototype.clearQueue !== 'function' ||
      typeof prototype.subscribe !== 'function'
    ) {
      return;
    }
    const capture = (session: AgentSession): void => {
      // A failed adapter must never break native prompting or queue rendering.
      try {
        const current = this.context?.();
        if (
          !current ||
          session.sessionManager.getSessionId() !== current.sessionManager.getSessionId() ||
          session.sessionManager.getSessionFile() !== current.sessionManager.getSessionFile() ||
          this.session === session
        ) {
          return;
        }
        this.unsubscribe?.();
        this.session = undefined;
        this.unsubscribe = session.subscribe((event) => {
          if (event.type === 'queue_update') {
            this.revision = randomUUID();
          }
        });
        this.revision = randomUUID();
        this.session = session;
      } catch {
        this.session = undefined;
      }
    };
    const wrappedPrompt: typeof prompt = function (this: AgentSession, ...args) {
      capture(this);
      return prompt.apply(this, args);
    };
    const wrappedSteering: typeof steering = function (this: AgentSession) {
      capture(this);
      return steering.call(this);
    };
    prototype.prompt = wrappedPrompt;
    prototype.getSteeringMessages = wrappedSteering;
    this.restore = () => {
      // Do not overwrite another extension's later patch.
      if (prototype.prompt === wrappedPrompt) {
        prototype.prompt = prompt;
      }
      if (prototype.getSteeringMessages === wrappedSteering) {
        prototype.getSteeringMessages = steering;
      }
    };
  }

  private current(): AgentSession | undefined {
    const context = this.context?.();
    const session = this.session;
    return context &&
      session &&
      session.sessionManager.getSessionId() === context.sessionManager.getSessionId() &&
      session.sessionManager.getSessionFile() === context.sessionManager.getSessionFile()
      ? session
      : undefined;
  }

  snapshot(): PendingQueue | null {
    const session = this.current();
    if (!session) {
      return null;
    }
    return {
      revision: this.revision,
      steering: [...session.getSteeringMessages()],
      followUp: [...session.getFollowUpMessages()],
    };
  }

  validate(revision: string): void {
    const session = this.current();
    if (!session) {
      throw new AppError(
        'Native queue access unavailable. Check the Pi extension entry point.',
        422,
      );
    }
    if (session.isCompacting) {
      throw new AppError('Wait until native compaction finishes', 422);
    }
    if (revision !== this.revision) {
      throw new AppError('Native queue changed. Review the refreshed queue before clearing.', 409);
    }
  }

  /** Synchronous after preflight. Failures after dispatch remain unknown, never replayed. */
  clear(): void {
    const session = this.current();
    if (!session) {
      throw new Error('Native queue access lost');
    }
    session.clearQueue();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.restore?.();
    this.restore = undefined;
    this.session = undefined;
    this.context = undefined;
  }
}
