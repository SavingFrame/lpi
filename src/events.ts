import { randomUUID } from 'node:crypto';

export interface ServerEvent {
  epoch: string;
  cursor: number;
  sessionId: string;
  generation: number;
  type: string;
  data: unknown;
}

export class Events {
  readonly epoch = randomUUID();
  private cursor = 0;
  private readonly revisions = new Map<string, number>();

  checkpoint(sessionId?: string): { epoch: string; cursor: number; revision: number } {
    return {
      epoch: this.epoch,
      cursor: this.cursor,
      revision: sessionId ? (this.revisions.get(sessionId) ?? 0) : this.cursor,
    };
  }
  private readonly listeners = new Set<(event: ServerEvent) => void>();

  publish(sessionId: string, generation: number, type: string, data: unknown): void {
    const event = { epoch: this.epoch, cursor: ++this.cursor, sessionId, generation, type, data };
    this.revisions.set(sessionId, event.cursor);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
