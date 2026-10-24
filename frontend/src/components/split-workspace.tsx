import { type CSSProperties, type ReactNode, useState } from 'react';

/** Layout-only horizontal split. Each side supplies its own tabs and content. */
export function SplitWorkspace({
  primary,
  secondary,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  const [ratio, setRatio] = useState(50);
  return (
    <div
      className={`split-workspace ${secondary ? 'is-split' : ''}`}
      style={{ '--split-ratio': `${ratio}%` } as CSSProperties}
    >
      <div className="split-workspace-primary">{primary}</div>
      {secondary && (
        <>
          <button
            type="button"
            className="split-workspace-resize"
            aria-label="Resize split panes"
            title="Drag to resize. Left and Right arrows adjust width; Home resets."
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
                if (bounds) {
                  setRatio(
                    Math.max(
                      25,
                      Math.min(75, ((event.clientX - bounds.left) / bounds.width) * 100),
                    ),
                  );
                }
              }
            }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                setRatio((current) =>
                  Math.max(25, Math.min(75, current + (event.key === 'ArrowRight' ? 2 : -2))),
                );
              } else if (event.key === 'Home') {
                event.preventDefault();
                setRatio(50);
              }
            }}
          />
          <div className="split-workspace-secondary">{secondary}</div>
        </>
      )}
    </div>
  );
}
