import type { SessionControls } from '../../src/session-controls';

export function SessionSettings({
  controls,
  enabled,
  onChange,
}: {
  controls: SessionControls;
  enabled: boolean;
  onChange: (command: Record<string, unknown>) => void;
}) {
  const { model, models, thinkingLevel, thinkingLevels, contextUsage } = controls;
  const selected = model ? JSON.stringify([model.provider, model.id]) : '';
  const options =
    model && !models.some((item) => item.provider === model.provider && item.id === model.id)
      ? [model, ...models]
      : models;
  return (
    <div className="session-settings">
      <label>
        Model
        <select
          value={selected}
          disabled={!enabled || models.length === 0}
          title="Applies to the next model request. The current response is unchanged."
          onChange={(event) => {
            const next = options.find(
              (item) => JSON.stringify([item.provider, item.id]) === event.target.value,
            );
            if (next) {
              onChange({ type: 'set_model', provider: next.provider, modelId: next.id });
            }
          }}
        >
          {!model && <option value="">No model selected</option>}
          {options.map((item) => (
            <option
              key={JSON.stringify([item.provider, item.id])}
              value={JSON.stringify([item.provider, item.id])}
            >
              {item.provider} / {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Thinking
        <select
          value={thinkingLevel ?? ''}
          disabled={!enabled || thinkingLevels.length <= 1}
          title="Applies to the next model request. The current response is unchanged."
          onChange={(event) => onChange({ type: 'set_thinking_level', level: event.target.value })}
        >
          {thinkingLevel === null && <option value="">Unavailable</option>}
          {thinkingLevels.map((level) => (
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
      <p className="muted">
        Changes apply to the next model request, including tool continuations.
      </p>
    </div>
  );
}
