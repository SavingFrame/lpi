import type { SessionControls } from '../../src/session-controls';

export function SessionSettings({ controls }: { controls: SessionControls }) {
  const { model, thinkingLevel, contextUsage } = controls;
  return (
    <div className="session-settings">
      <span>Model: {model ? `${model.provider} / ${model.name}` : 'unavailable'}</span>
      <span>Thinking: {thinkingLevel ?? 'unavailable'}</span>
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
