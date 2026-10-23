import { Ellipsis, Maximize2, X } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type DisplayArtifact,
  type DisplayTheme,
  displayContentHeight,
  MIN_DISPLAY_HEIGHT,
} from '../../../../../src/shared/display';
import { useDisplayTheme } from './display-theme';

function DisplayPreview({ artifact, theme }: { artifact: DisplayArtifact; theme: DisplayTheme }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const instance = useId();
  const html = artifact.kind === 'html' ? artifact.html : undefined;
  const id = useMemo(() => `${instance}:${html?.length ?? 0}:${Math.random()}`, [instance, html]);
  const [size, setSize] = useState({ id, height: MIN_DISPLAY_HEIGHT });
  const send = useCallback(() => {
    if (html !== undefined) {
      // This exact sandboxed window has an opaque origin. No actions are accepted back.
      frame.current?.contentWindow?.postMessage({ type: 'lpi-display', id, html, theme }, '*');
    }
  }, [html, id, theme]);
  // Register during commit so a cached frame cannot send its first size too early.
  useLayoutEffect(() => {
    if (html === undefined) {
      return;
    }
    const resize = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) {
        return;
      }
      const height = displayContentHeight(event.data, id);
      if (height !== undefined) {
        setSize((current) =>
          current.id === id && current.height === height ? current : { id, height },
        );
      }
    };
    window.addEventListener('message', resize);
    send();
    return () => window.removeEventListener('message', resize);
  }, [id, html, send]);
  return artifact.kind === 'image' ? (
    <img
      className="display-image"
      src={`data:${artifact.image.mimeType};base64,${artifact.image.data}`}
      alt={artifact.summary || artifact.title}
      loading="lazy"
    />
  ) : (
    <iframe
      className="display-frame"
      ref={frame}
      title={artifact.title}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'"
      src="/display"
      style={{
        height: size.id === id ? size.height : MIN_DISPLAY_HEIGHT,
        colorScheme: theme.appearance,
      }}
      onLoad={send}
    />
  );
}

export function DisplayCard({ artifact }: { artifact: DisplayArtifact }) {
  const [source, setSource] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [download, setDownload] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const summary = useId();
  const theme = useDisplayTheme();
  useEffect(() => {
    if (artifact.kind === 'image') {
      setDownload(`data:${artifact.image.mimeType};base64,${artifact.image.data}`);
      return;
    }
    const url = URL.createObjectURL(new Blob([artifact.html], { type: 'text/html;charset=utf-8' }));
    setDownload(url);
    return () => URL.revokeObjectURL(url);
  }, [artifact]);
  useEffect(() => {
    if (expanded) {
      dialog.current?.showModal();
    }
  }, [expanded]);
  return (
    <section className="display-card" aria-label={artifact.title} aria-describedby={summary}>
      <span id={summary} className="display-accessibility">
        {artifact.summary}
      </span>
      <div className="display-actions">
        <button
          type="button"
          aria-label="Expand visual"
          title="Expand visual"
          onClick={() => setExpanded(true)}
        >
          <Maximize2 size={14} aria-hidden="true" />
        </button>
        <details className="display-options">
          <summary aria-label="Visual options" title="Visual options">
            <Ellipsis size={16} aria-hidden="true" />
          </summary>
          <div className="display-menu">
            {artifact.kind === 'html' && (
              <button type="button" onClick={() => setSource(!source)}>
                {source ? 'Preview' : 'Source'}
              </button>
            )}
            <a href={download} download={artifact.filename}>
              Download
            </a>
            {artifact.kind === 'html' && <small>Downloaded HTML runs outside lpi’s sandbox.</small>}
          </div>
        </details>
      </div>
      {source && artifact.kind === 'html' ? (
        <pre className="display-source">{artifact.html}</pre>
      ) : (
        <DisplayPreview artifact={artifact} theme={theme} />
      )}
      {expanded && (
        <dialog
          className="display-dialog"
          ref={dialog}
          onClose={() => setExpanded(false)}
          onCancel={() => setExpanded(false)}
        >
          <header className="display-toolbar">
            <strong>{artifact.title}</strong>
            <button type="button" aria-label="Close visual" onClick={() => setExpanded(false)}>
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="display-dialog-body">
            <DisplayPreview artifact={artifact} theme={theme} />
          </div>
        </dialog>
      )}
    </section>
  );
}
