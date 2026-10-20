import type { BridgeCommand } from '../../src/bridge/protocol';
import type { SessionControls } from '../../src/session-controls';
import { ModelPicker } from './model-picker';
import { ThinkingSlider } from './thinking-slider';

export function SessionSettings({
  controls,
  disabled,
  onCommand,
}: {
  controls: SessionControls;
  disabled: boolean;
  onCommand: (command: BridgeCommand) => void;
}) {
  const {
    model,
    availableModels,
    scopedModels,
    thinkingLevel,
    availableThinkingLevels,
    contextUsage,
  } = controls;
  return (
    <div className="session-settings">
      <ModelPicker
        model={model}
        availableModels={availableModels}
        scopedModels={scopedModels}
        disabled={disabled}
        onSelect={(selected) =>
          onCommand({ type: 'set_model', provider: selected.provider, modelId: selected.id })
        }
      />
      <ThinkingSlider
        key={JSON.stringify([model, thinkingLevel, availableThinkingLevels, disabled])}
        level={thinkingLevel}
        levels={availableThinkingLevels}
        disabled={disabled || !model}
        onSelect={(level) => onCommand({ type: 'set_thinking_level', level })}
      />
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
