import type { Api, Model, ModelThinkingLevel } from '@earendil-works/pi-ai';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected session controls object');
  }
  return value as Record<string, unknown>;
}

export type ModelOption = Pick<Model<Api>, 'provider' | 'id' | 'name'>;

export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export type ThinkingLevel = ModelThinkingLevel;

// Wire validation only. Selectable levels come from the native model's capabilities.
const thinkingLevels = {
  off: true,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
} satisfies Record<ThinkingLevel, true>;

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && Object.hasOwn(thinkingLevels, value);
}

export interface SessionControls {
  availableModels: ModelOption[];
  scopedModels: ModelOption[];
  model: ModelOption | null;
  thinkingLevel: ThinkingLevel | null;
  availableThinkingLevels: ThinkingLevel[];
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
  if (!Array.isArray(raw.availableModels)) {
    throw new Error('Invalid controls.availableModels: expected an array');
  }
  if (!Array.isArray(raw.scopedModels)) {
    throw new Error('Invalid controls.scopedModels: expected an array');
  }
  if (!Array.isArray(raw.availableThinkingLevels)) {
    throw new Error('Invalid controls.availableThinkingLevels: expected an array');
  }
  if (raw.thinkingLevel !== null && !isThinkingLevel(raw.thinkingLevel)) {
    throw new Error('Invalid controls.thinkingLevel: expected a known level or null');
  }
  const availableThinkingLevels = raw.availableThinkingLevels.map((level: unknown) => {
    if (!isThinkingLevel(level)) {
      throw new Error('Invalid controls.availableThinkingLevels entry');
    }
    return level;
  });
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
    availableModels: raw.availableModels.map(modelOption),
    scopedModels: raw.scopedModels.map(modelOption),
    model: raw.model === null ? null : modelOption(raw.model),
    thinkingLevel: raw.thinkingLevel,
    availableThinkingLevels,
    contextUsage,
  };
}
