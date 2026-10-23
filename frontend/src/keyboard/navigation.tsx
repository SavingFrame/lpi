import { useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { Button } from '../components/ui/button';
import { LaunchSession } from '../navigation/launch-session';
import { useKeyboardAction } from './keyboard';

export function KeyboardNavigation() {
  const navigate = useNavigate();
  useKeyboardAction('settings', () => {
    void navigate({ to: '/app/settings' });
  });
  const { projectId } = useParams({ strict: false });
  const lastLeft = useRef<HTMLElement | null>(null);
  const lastRight = useRef<HTMLElement | null>(null);
  const launch = useRef<HTMLDialogElement>(null);
  const beforeLaunch = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) {
        return;
      }
      if (event.target.closest('.sidebar')) {
        lastLeft.current = event.target;
      }
      if (event.target.closest('main')) {
        lastRight.current = event.target;
      }
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, []);
  useKeyboardAction('left', () => {
    const target = lastLeft.current?.isConnected
      ? lastLeft.current
      : (document.querySelector<HTMLElement>('.sidebar .session-link.selected') ??
        document.querySelector<HTMLElement>('.session-search input'));
    target?.focus();
  });
  useKeyboardAction('right', () => {
    const target = lastRight.current?.isConnected
      ? lastRight.current
      : (document.querySelector<HTMLElement>('[data-message-composer]:not(:disabled)') ??
        document.querySelector<HTMLElement>('main'));
    target?.focus();
  });
  useKeyboardAction('composer', () =>
    document.querySelector<HTMLElement>('[data-message-composer]:not(:disabled)')?.focus(),
  );
  useKeyboardAction('search', () => {
    const input = document.querySelector<HTMLInputElement>('.session-search input');
    input?.focus();
    input?.select();
  });
  useKeyboardAction('new', () => {
    beforeLaunch.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    launch.current?.showModal();
    launch.current?.querySelector<HTMLElement>('select, [data-launch-session]')?.focus();
  });
  return (
    <dialog
      ref={launch}
      className="keyboard-dialog"
      aria-labelledby="new-session-heading"
      onClose={() => beforeLaunch.current?.isConnected && beforeLaunch.current.focus()}
    >
      <div className="keyboard-dialog-heading">
        <h2 id="new-session-heading">New session</h2>
        <Button variant="ghost" onClick={() => launch.current?.close()}>
          Close
        </Button>
      </div>
      <LaunchSession projectId={projectId} onStarted={() => launch.current?.close()} />
    </dialog>
  );
}
