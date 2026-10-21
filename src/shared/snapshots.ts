import { record, reduceEvent, type View, view } from './client-state.ts';
import { type SessionControls, sessionControls } from './session-controls.ts';
import { readState, type SessionReadState } from './session-read-state.ts';
import { type Session, session } from './sessions.ts';

/** Native metadata before relay-owned read-only flags are applied. */
export interface NativeStatus {
  state: Record<string, unknown> & { isStreaming: boolean; hasPendingMessages: boolean };
  controls: SessionControls;
}

export interface BridgeStatus extends NativeStatus {
  notice: string | null;
}

/** Also represents disconnected, explicitly read-only last-known history. */
export interface BridgeSnapshot {
  state: Record<string, unknown>;
  controls: SessionControls;
  view: View;
}

export interface Snapshot extends BridgeSnapshot {
  epoch: string;
  cursor: number;
  session: Session;
  readState: SessionReadState;
}

export function nativeStatus(value: unknown): NativeStatus {
  const raw = record(value);
  const state = record(raw.state);
  if (typeof state.isStreaming !== 'boolean' || typeof state.hasPendingMessages !== 'boolean') {
    throw new Error('Invalid native status');
  }
  return {
    state: {
      ...state,
      isStreaming: state.isStreaming,
      hasPendingMessages: state.hasPendingMessages,
    },
    controls: sessionControls(raw.controls),
  };
}

export function bridgeStatus(value: unknown): BridgeStatus {
  const raw = record(value);
  if (raw.notice !== null && typeof raw.notice !== 'string') {
    throw new Error('Invalid native status');
  }
  return { ...nativeStatus(raw), notice: raw.notice };
}

/** Validate native snapshots at registration and each explicit branch synchronization. */
export function bridgeSnapshot(value: unknown): BridgeSnapshot {
  const raw = record(value);
  const status = nativeStatus(raw);
  return {
    state: { ...status.state, readOnly: false, nativeTui: true },
    controls: status.controls,
    view: view(raw.view),
  };
}

/** Saved snapshots need not contain live runtime metadata. */
export function snapshot(value: unknown): Snapshot {
  const raw = record(value);
  if (
    typeof raw.epoch !== 'string' ||
    typeof raw.cursor !== 'number' ||
    !Number.isSafeInteger(raw.cursor) ||
    raw.cursor < 0
  ) {
    throw new Error('Invalid snapshot');
  }
  return {
    epoch: raw.epoch,
    cursor: raw.cursor,
    session: session(raw.session),
    readState: readState(raw.readState),
    state: record(raw.state),
    controls: sessionControls(raw.controls),
    view: view(raw.view),
  };
}

/** Metadata-only updates must retain transcript and transient activity references. */
export function projectStatus(current: BridgeSnapshot, status: BridgeStatus): BridgeSnapshot {
  return {
    state: status.state,
    controls: status.controls,
    view: { ...current.view, notice: status.notice },
  };
}

/** Identical native event projection for the relay cache and the browser snapshot. */
export function projectEvent(
  current: BridgeSnapshot,
  event: Record<string, unknown>,
): BridgeSnapshot {
  const view = reduceEvent(current.view, event);
  return {
    ...current,
    view,
    state: {
      ...current.state,
      isStreaming: view.running,
      ...(event.type === 'extension_support' ? { pendingDialog: view.notice } : {}),
    },
  };
}
