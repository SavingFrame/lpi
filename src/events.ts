import { randomUUID } from 'node:crypto';
import type { ServerEvent } from './shared/events.js';

export class Events {
  readonly epoch = randomUUID();
  private cursor = 0;
  checkpoint(): { epoch: string; cursor: number } {
    return { epoch: this.epoch, cursor: this.cursor };
  }
  private readonly listeners = new Set<(event: ServerEvent) => void>();

  publish(sessionId: string, generation: number, type: string, data: unknown): void {
    const event = { epoch: this.epoch, cursor: ++this.cursor, sessionId, generation, type, data };
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
