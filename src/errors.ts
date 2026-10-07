export class AppError extends Error {
  readonly status: number;
  readonly outcome: 'rejected' | 'unknown';

  constructor(message: string, status = 409, outcome: 'rejected' | 'unknown' = 'rejected') {
    super(message);
    this.status = status;
    this.outcome = outcome;
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError('Expected an object', 400);
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, name: string, maximum = 100_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new AppError(`Invalid ${name}`, 400);
  }
  return value;
}

export function generation(value: unknown): number {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 0) {
    throw new AppError('Invalid generation', 400);
  }
  return value;
}
