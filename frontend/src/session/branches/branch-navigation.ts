import type { MouseEvent } from 'react';
import type { ComposerDraft } from '../../../../src/client/drafts.ts';
import type { BridgeCommand } from '../../../../src/shared/commands.ts';
import type { BranchPreview } from '../../../../src/shared/session-tree.ts';
import type { LiveState } from '../../client/live.ts';
import { draftForBranch } from './branch-state.ts';

type BranchAction = 'current' | 'switch' | 'preview';

interface BranchSelection {
  sessionId: string;
  entryId: string;
  action: BranchAction;
}

/** Ephemeral click intent. URLs and later idle/reconnect events never authorize a switch. */
export class BranchSelections {
  private pending: BranchSelection | null = null;
  private latest: BranchSelection | null = null;
  private readonly listeners = new Set<() => void>();

  getState = () => this.pending;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  request(sessionId: string, entryId: string, action: BranchAction): void {
    this.pending = { sessionId, entryId, action };
    this.latest = this.pending;
    for (const listener of this.listeners) {
      listener();
    }
  }
  take(sessionId: string, entryId: string): BranchSelection | null {
    const pending = this.pending;
    if (pending?.sessionId !== sessionId || pending.entryId !== entryId) {
      return null;
    }
    this.pending = null;
    for (const listener of this.listeners) {
      listener();
    }
    return pending;
  }
  discard(sessionId: string, entryId: string): void {
    if (this.latest?.sessionId !== sessionId || this.latest.entryId !== entryId) {
      return;
    }
    this.latest = null;
    this.pending = null;
    for (const listener of this.listeners) {
      listener();
    }
  }
  isLatest(selection: BranchSelection): boolean {
    return this.latest === selection;
  }
}

export const branchSelections = new BranchSelections();

export function requestBranchSelection(
  event: MouseEvent,
  sessionId: string,
  projectId: string,
  entryId: string,
  connection: LiveState,
): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  branchSelections.request(
    sessionId,
    entryId,
    branchAction(connection, sessionId, projectId, entryId, true),
  );
}

interface NavigationEnvironment {
  connection: () => LiveState;
  available: () => boolean;
  current: () => boolean;
  preview: (id: string, entryId: string) => Promise<BranchPreview>;
  submit: (command: BridgeCommand) => Promise<boolean>;
}

type NavigationResult =
  | { type: 'current' | 'preview' | 'cancelled' }
  | { type: 'switched'; draft: ComposerDraft | null };

export function branchAction(
  connection: LiveState,
  sessionId: string,
  projectId: string,
  entryId: string,
  available: boolean,
): BranchAction {
  const snapshot = connection.snapshot;
  if (
    connection.status !== 'ready' ||
    !snapshot ||
    snapshot.session.id !== sessionId ||
    snapshot.session.projectId !== projectId ||
    snapshot.session.connection !== 'connected'
  ) {
    return 'preview';
  }
  if (snapshot.state.leafId === entryId) {
    return 'current';
  }
  if (
    !available ||
    snapshot.view.running ||
    snapshot.view.compacting ||
    snapshot.view.notice !== null ||
    snapshot.state.isStreaming === true ||
    snapshot.state.hasPendingMessages === true ||
    snapshot.state.pendingDialog != null ||
    (snapshot.state.leafId !== null && typeof snapshot.state.leafId !== 'string')
  ) {
    return 'preview';
  }
  return 'switch';
}

/** One attempt per click, rechecking identity/position after loading the selected message. */
export async function navigateBranch(
  selection: BranchSelection,
  projectId: string,
  environment: NavigationEnvironment,
): Promise<NavigationResult> {
  if (!environment.current()) {
    return { type: 'cancelled' };
  }
  if (selection.action !== 'switch') {
    return { type: selection.action };
  }
  const connection = environment.connection();
  const action = branchAction(
    connection,
    selection.sessionId,
    projectId,
    selection.entryId,
    environment.available(),
  );
  if (action !== 'switch') {
    return { type: action };
  }
  const snapshot = connection.snapshot;
  if (!snapshot) {
    return { type: 'cancelled' };
  }
  const generation = snapshot.session.generation;
  const expectedLeafId = snapshot.state.leafId;
  if (expectedLeafId !== null && typeof expectedLeafId !== 'string') {
    return { type: 'preview' };
  }
  const preview = await environment.preview(selection.sessionId, selection.entryId);
  if (!environment.current()) {
    return { type: 'cancelled' };
  }
  let draft: ComposerDraft | null;
  try {
    draft = draftForBranch(preview);
  } catch {
    throw new Error(
      'This message has attachments that cannot be restored in the browser. Navigate in native Pi instead.',
    );
  }
  const fresh = environment.connection();
  if (
    fresh.snapshot?.session.generation !== generation ||
    fresh.snapshot?.state.leafId !== expectedLeafId ||
    branchAction(
      fresh,
      selection.sessionId,
      projectId,
      selection.entryId,
      environment.available(),
    ) !== 'switch'
  ) {
    return { type: 'preview' };
  }
  const accepted = await environment.submit({
    type: 'navigate_tree',
    targetId: selection.entryId,
    expectedLeafId,
  });
  if (!accepted || !environment.current()) {
    return { type: 'preview' };
  }
  return { type: 'switched', draft };
}
