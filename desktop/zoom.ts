import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const MIN_ZOOM = 0.75;
export const MAX_ZOOM = 2;

export function validZoom(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < MIN_ZOOM ||
    value > MAX_ZOOM ||
    Math.abs(value * 20 - Math.round(value * 20)) > 0.000001
  ) {
    throw new Error('UI scale must be between 75% and 200%, in 5% steps.');
  }
  return Math.round(value * 20) / 20;
}

export function steppedZoom(current: number, direction: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(current * 20 + direction) / 20));
}

export class ZoomSettings {
  private readonly path: string;
  private value = 1;

  constructor(path: string) {
    this.path = path;
    try {
      const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (data && typeof data === 'object' && 'zoomFactor' in data) {
        this.value = validZoom(data.zoomFactor);
      }
    } catch {
      // Missing/corrupt preferences must never prevent opening the desktop.
    }
  }

  get factor(): number {
    return this.value;
  }

  set(value: unknown): number {
    const next = validZoom(value);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, `${JSON.stringify({ zoomFactor: next })}\n`, { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
    this.value = next;
    return next;
  }
}
