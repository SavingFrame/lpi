import type { LiveState } from '../../../src/client/live.ts';

interface LiveSource {
  getState: () => LiveState;
  subscribe: (listener: () => void) => () => void;
}

function canBatch(previous: LiveState, next: LiveState): boolean {
  const before = previous.snapshot;
  const after = next.snapshot;
  if (
    previous.status !== 'ready' ||
    next.status !== 'ready' ||
    previous.error !== next.error ||
    !before ||
    !after ||
    before.epoch !== after.epoch ||
    before.session !== after.session ||
    before.controls !== after.controls ||
    before.readState !== after.readState ||
    !before.view.running ||
    !after.view.running ||
    before.view.compacting !== after.view.compacting ||
    before.view.notice !== after.view.notice ||
    before.view.extensions !== after.view.extensions
  ) {
    return false;
  }
  const keys = Object.keys(before.state);
  return (
    keys.length === Object.keys(after.state).length &&
    keys.every((key) => before.state[key] === after.state[key])
  );
}

/** Coalesce rendering only. The authoritative transport still processes every event immediately. */
export class LivePresentation {
  private current: LiveState;
  private readonly source: LiveSource;
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(source: LiveSource) {
    this.source = source;
    this.current = source.getState();
  }

  getState = (): LiveState => (this.listeners.size ? this.current : this.source.getState());

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.current = this.source.getState();
      this.unsubscribe = this.source.subscribe(this.receive);
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        clearTimeout(this.timer);
        this.timer = undefined;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        this.current = this.source.getState();
      }
    };
  };

  private publish = (): void => {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.current = this.source.getState();
    for (const listener of this.listeners) {
      listener();
    }
  };

  private receive = (): void => {
    if (!canBatch(this.current, this.source.getState())) {
      this.publish();
    } else if (this.timer === undefined) {
      // Trailing delivery, not debounce: continuous streams still render ten times a second.
      this.timer = setTimeout(this.publish, 100);
    }
  };
}
