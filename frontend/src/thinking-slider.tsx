import { useId, useState } from 'react';
import type { ThinkingLevel } from '../../src/shared/session-controls';

export function ThinkingSlider({
  level,
  levels,
  disabled,
  onSelect,
}: {
  level: ThinkingLevel | null;
  levels: ThinkingLevel[];
  disabled: boolean;
  onSelect: (level: ThinkingLevel) => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const id = useId();
  const current = level === null ? -1 : levels.indexOf(level);
  const index = preview ?? Math.max(0, current);
  const displayed = preview === null ? level : levels[index];
  const commit = (value: string) => {
    const selected = levels[Number(value)];
    setPreview(null);
    if (!disabled && selected && selected !== level) {
      onSelect(selected);
    }
  };
  return (
    <div className={`thinking-control thinking-${displayed ?? 'off'}`}>
      <label htmlFor={id}>
        Thinking <span>{displayed ?? 'unavailable'}</span>
      </label>
      <input
        id={id}
        type="range"
        aria-label="Thinking level"
        aria-valuetext={displayed ?? 'unavailable'}
        title="Supported levels for the current model. Release to apply."
        min={0}
        max={Math.max(1, levels.length - 1)}
        step={1}
        value={index}
        disabled={disabled || levels.length <= 1 || current < 0}
        onChange={(event) => setPreview(Number(event.target.value))}
        onPointerUp={(event) => commit(event.currentTarget.value)}
        onPointerCancel={() => setPreview(null)}
        onBlur={() => setPreview(null)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setPreview(null);
          }
        }}
        onKeyUp={(event) => {
          if (
            [
              'ArrowLeft',
              'ArrowRight',
              'ArrowUp',
              'ArrowDown',
              'Home',
              'End',
              'PageUp',
              'PageDown',
            ].includes(event.key)
          ) {
            commit(event.currentTarget.value);
          }
        }}
      />
      <div className="thinking-ticks" aria-hidden="true">
        {levels.map((item) => (
          <span key={item} className={`thinking-${item}`}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
