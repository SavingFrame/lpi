import { X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';

interface WorkspaceTabProps {
  label: string;
  active: boolean;
  icon?: ReactNode;
  indicator?: ReactNode;
  title?: string;
  ariaLabel?: string;
  closeLabel?: string;
  onSelect: () => void;
  onClose: () => void;
}

/** Shared tab presentation and interactions. Callers own navigation and tab state. */
export function WorkspaceTab({
  label,
  active,
  icon,
  indicator,
  title = label,
  ariaLabel = label,
  closeLabel = `Close ${label}`,
  onSelect,
  onClose,
}: WorkspaceTabProps) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) {
      element.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [active]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Middle-click supplements the keyboard-accessible close button.
    <div
      ref={element}
      className={`session-tab ${active ? 'active' : ''}`}
      onMouseDown={(event) => {
        if (event.button === 1) {
          event.preventDefault();
        }
      }}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <button
        type="button"
        className="session-tab-select"
        aria-current={active ? 'page' : undefined}
        title={title}
        aria-label={ariaLabel}
        onClick={onSelect}
      >
        {icon}
        <span className="session-tab-title">{label}</span>
        {indicator}
      </button>
      <button
        type="button"
        className="session-tab-close"
        aria-label={closeLabel}
        title="Close tab (Ctrl+W / Cmd+W)"
        onClick={onClose}
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
