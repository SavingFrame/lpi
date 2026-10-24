import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ModelOption } from '../../../../src/shared/session-controls';

function modelKey(model: ModelOption) {
  return JSON.stringify([model.provider, model.id]);
}

export function ModelPicker({
  model,
  availableModels,
  scopedModels,
  disabled,
  onSelect,
}: {
  model: ModelOption | null;
  availableModels: ModelOption[];
  scopedModels: ModelOption[];
  disabled: boolean;
  onSelect: (model: ModelOption) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const results = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const menu = results.current;
    const field = input.current;
    if (!open || disabled || !menu || !field) {
      return;
    }
    const position = () => {
      const bounds = field.getBoundingClientRect();
      const width = Math.min(Math.max(bounds.width, 300), window.innerWidth - 32);
      menu.style.width = `${width}px`;
      menu.style.left = `${Math.max(16, Math.min(bounds.left, window.innerWidth - width - 16))}px`;
      menu.style.bottom = `${window.innerHeight - bounds.top + 8}px`;
      menu.style.maxHeight = `${Math.max(0, Math.min(320, window.innerHeight * 0.45, bounds.top - 24))}px`;
    };
    position();
    menu.showPopover();
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    const observer = new ResizeObserver(position);
    observer.observe(field);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
      menu.hidePopover();
    };
  }, [open, disabled]);
  const terms = query.toLowerCase().trim().split(/\s+/);
  const matches = availableModels.filter((option) => {
    const text = `${option.provider} ${option.id} ${option.name}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const scoped = new Set(scopedModels.map(modelKey));
  const groups = [
    { label: 'Pi scoped models', models: matches.filter((option) => scoped.has(modelKey(option))) },
    {
      label: scoped.size ? 'Other models' : 'Available models',
      models: matches.filter((option) => !scoped.has(modelKey(option))),
    },
  ];
  return (
    <fieldset
      className="model-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          input.current?.focus();
          setOpen(false);
        }
      }}
    >
      <legend className="sr-only">Model selection</legend>
      <label>
        Model
        <input
          ref={input}
          type="search"
          aria-label="Search models"
          aria-controls={open && !disabled ? resultsId : undefined}
          autoComplete="off"
          disabled={disabled || availableModels.length === 0}
          value={open ? query : model ? `${model.provider} / ${model.name}` : ''}
          placeholder="Search models…"
          title={model ? `${model.provider} / ${model.id}` : 'No model selected'}
          onFocus={() => {
            setQuery('');
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              if (!open) {
                setOpen(true);
              } else {
                document.getElementById(resultsId)?.querySelector('button')?.focus();
              }
            }
          }}
        />
      </label>
      {open && !disabled && (
        <section
          ref={results}
          id={resultsId}
          popover="manual"
          className="model-results"
          aria-label="Matching models"
        >
          {matches.length === 0 && <p role="status">No matching models.</p>}
          {groups.map((group) =>
            group.models.length ? (
              <fieldset key={group.label}>
                <legend className="eyebrow">{group.label}</legend>
                {group.models.map((option) => (
                  <button
                    key={modelKey(option)}
                    type="button"
                    aria-pressed={model !== null && modelKey(model) === modelKey(option)}
                    onClick={() => {
                      setOpen(false);
                      input.current?.blur();
                      if (model === null || modelKey(model) !== modelKey(option)) {
                        onSelect(option);
                      }
                    }}
                  >
                    <span>{option.name}</span>
                    <small>{`${option.provider} / ${option.id}`}</small>
                  </button>
                ))}
              </fieldset>
            ) : null,
          )}
        </section>
      )}
    </fieldset>
  );
}
