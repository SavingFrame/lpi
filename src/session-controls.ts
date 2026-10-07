function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected session controls object');
  }
  return value as Record<string, unknown>;
}

export interface ModelOption {
  provider: string;
  id: string;
  name: string;
}

export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface SessionControls {
  model: ModelOption | null;
  thinkingLevel: string | null;
  models: ModelOption[];
  thinkingLevels: string[];
  contextUsage: ContextUsage | null;
}

function modelOption(value: unknown): ModelOption {
  const raw = record(value);
  if (
    typeof raw.provider !== 'string' ||
    typeof raw.id !== 'string' ||
    typeof raw.name !== 'string'
  ) {
    throw new Error('Invalid model option');
  }
  return { provider: raw.provider, id: raw.id, name: raw.name };
}

export function sessionControls(value: unknown): SessionControls {
  const raw = record(value);
  if (
    !Array.isArray(raw.models) ||
    !Array.isArray(raw.thinkingLevels) ||
    raw.thinkingLevels.some((level) => typeof level !== 'string') ||
    (raw.thinkingLevel !== null && typeof raw.thinkingLevel !== 'string')
  ) {
    throw new Error('Invalid session controls');
  }
  let contextUsage: ContextUsage | null = null;
  if (raw.contextUsage !== null) {
    const usage = record(raw.contextUsage);
    if (
      typeof usage.contextWindow !== 'number' ||
      !Number.isFinite(usage.contextWindow) ||
      usage.contextWindow <= 0 ||
      (usage.tokens !== null &&
        (typeof usage.tokens !== 'number' || !Number.isFinite(usage.tokens) || usage.tokens < 0)) ||
      (usage.percent !== null &&
        (typeof usage.percent !== 'number' || !Number.isFinite(usage.percent) || usage.percent < 0))
    ) {
      throw new Error('Invalid context usage');
    }
    contextUsage = {
      tokens: usage.tokens,
      contextWindow: usage.contextWindow,
      percent: usage.percent,
    };
  }
  return {
    model: raw.model === null ? null : modelOption(raw.model),
    thinkingLevel: raw.thinkingLevel,
    models: raw.models.map(modelOption),
    thinkingLevels: raw.thinkingLevels as string[],
    contextUsage,
  };
}
