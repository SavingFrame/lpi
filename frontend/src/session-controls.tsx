import type { BridgeCommand } from '../../src/bridge/protocol';
import type { SessionControls } from '../../src/session-controls';

export function SessionSettings({
  controls,
  disabled,
  onCommand,
}: {
  controls: SessionControls;
  disabled: boolean;
  onCommand: (command: BridgeCommand) => void;
}) {
  const { model, availableModels, thinkingLevel, availableThinkingLevels, contextUsage } = controls;
  const modelKey = (option: { provider: string; id: string }) =>
    JSON.stringify([option.provider, option.id]);
  const models =
    model && !availableModels.some((option) => modelKey(option) === modelKey(model))
      ? [model, ...availableModels]
      : availableModels;
  return (
    <div className="session-settings">
      <label>
        Model:{' '}
        <select
          aria-label="Model"
          className="h-8 max-w-full rounded-md border border-input bg-background px-2 text-xs"
          disabled={disabled || availableModels.length === 0}
          value={model ? modelKey(model) : ''}
          onChange={(event) => {
            const selected = availableModels.find(
              (option) => modelKey(option) === event.target.value,
            );
            if (selected) {
              onCommand({ type: 'set_model', provider: selected.provider, modelId: selected.id });
            }
          }}
        >
          {!model && <option value="">unavailable</option>}
          {models.map((option) => (
            <option key={modelKey(option)} value={modelKey(option)}>
              {option.provider} / {option.name}
            </option>
          ))}
        </select>
      </label>
      <label title="Supported thinking levels reported by native Pi for the current model.">
        Thinking:{' '}
        <select
          aria-label="Thinking level"
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          disabled={disabled || !model || availableThinkingLevels.length <= 1}
          value={thinkingLevel ?? ''}
          onChange={(event) => {
            const level = availableThinkingLevels.find((level) => level === event.target.value);
            if (level) {
              onCommand({ type: 'set_thinking_level', level });
            }
          }}
        >
          {thinkingLevel === null && <option value="">unavailable</option>}
          {thinkingLevel !== null && !availableThinkingLevels.includes(thinkingLevel) && (
            <option value={thinkingLevel} disabled>
              {thinkingLevel}
            </option>
          )}
          {availableThinkingLevels.map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>
      <div
        className="context-usage"
        title="Pi's current context estimate, not cumulative session usage. Unknown after compaction until the next assistant response."
      >
        <span>
          Context:{' '}
          {contextUsage
            ? `${contextUsage.tokens?.toLocaleString() ?? '?'} / ${contextUsage.contextWindow.toLocaleString()} · ${contextUsage.percent === null ? '?' : contextUsage.percent.toFixed(1)}%`
            : 'unavailable'}
        </span>
        {contextUsage?.percent !== null && contextUsage?.percent !== undefined && (
          <meter
            aria-label="Context window usage"
            min={0}
            max={100}
            high={80}
            optimum={0}
            value={Math.min(contextUsage.percent, 100)}
          />
        )}
      </div>
    </div>
  );
}
