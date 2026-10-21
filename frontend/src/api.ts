import { record } from '../../src/shared/client-state.ts';
import type { BridgeCommand } from '../../src/shared/commands.ts';
import { readState, type SessionReadState } from '../../src/shared/session-read-state.ts';
import {
  type BranchPreview,
  branchPreview,
  type SessionTree,
  sessionTree,
} from '../../src/shared/session-tree.ts';
import {
  type InventorySession,
  inventorySession,
  type Project,
  project,
  type Session,
  session,
} from '../../src/shared/sessions.ts';
import { type Snapshot, snapshot } from '../../src/shared/snapshots.ts';

export class ApiError extends Error {
  readonly outcome: string;
  constructor(message: string, outcome: string) {
    super(message);
    this.outcome = outcome;
  }
}

async function request(
  path: string,
  payload?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const mutation = payload !== undefined;
  try {
    const requestId = mutation ? crypto.randomUUID() : undefined;
    const response = await fetch(path, {
      method: mutation ? 'POST' : 'GET',
      headers: mutation ? { 'Content-Type': 'application/json' } : undefined,
      body: mutation ? JSON.stringify({ ...payload, requestId }) : undefined,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(35_000)])
        : AbortSignal.timeout(35_000),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const error = record(data);
      throw new ApiError(
        String(error.error ?? 'Request failed'),
        String(error.outcome ?? 'unknown'),
      );
    }
    if (mutation) {
      const result = record(data);
      if (result.requestId !== requestId || result.outcome !== 'acknowledged') {
        throw new Error('Invalid mutation acknowledgment');
      }
      if (result.data !== null && result.data !== undefined) {
        record(result.data);
      }
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (mutation) {
      throw new ApiError(
        'Response lost. The command may have executed. Inspect the session before sending again.',
        'unknown',
      );
    }
    throw error;
  }
}

export async function projects(): Promise<Project[]> {
  const raw = record(await request('/projects'));
  if (!Array.isArray(raw.projects)) {
    throw new Error('Invalid projects');
  }
  return raw.projects.map(project);
}

export async function sessions(): Promise<InventorySession[]> {
  const raw = record(await request('/sessions'));
  if (!Array.isArray(raw.sessions)) {
    throw new Error('Invalid sessions');
  }
  return raw.sessions.map(inventorySession);
}

export async function inspect(id: string, signal: AbortSignal): Promise<Snapshot> {
  return snapshot(await request(`/sessions/${encodeURIComponent(id)}/snapshot`, undefined, signal));
}

export async function tree(id: string, signal: AbortSignal): Promise<SessionTree> {
  const result = sessionTree(
    await request(`/sessions/${encodeURIComponent(id)}/tree`, undefined, signal),
  );
  if (result.sessionId !== id) {
    throw new Error('Tree session mismatch');
  }
  return result;
}

export async function previewBranch(
  id: string,
  entryId: string,
  signal: AbortSignal,
): Promise<BranchPreview> {
  const result = branchPreview(
    await request(
      `/sessions/${encodeURIComponent(id)}/branch?entryId=${encodeURIComponent(entryId)}`,
      undefined,
      signal,
    ),
  );
  if (result.sessionId !== id || result.entryId !== entryId) {
    throw new Error('Branch preview mismatch');
  }
  return result;
}

export async function launch(projectId: string, resumeId?: string): Promise<Session> {
  const result = record(
    await request(resumeId ? `/sessions/${encodeURIComponent(resumeId)}/resume` : '/sessions', {
      projectId,
      confirmedOffline: resumeId !== undefined,
    }),
  );
  return session(record(result.data).session);
}

export async function markViewed(id: string, completionId: string): Promise<SessionReadState> {
  const result = record(
    await request(`/sessions/${encodeURIComponent(id)}/viewed`, { completionId }),
  );
  return readState(record(result.data).readState);
}

export async function operate(
  id: string,
  generation: number,
  command: BridgeCommand,
): Promise<Record<string, unknown>> {
  return record(
    await request(`/sessions/${encodeURIComponent(id)}/commands`, { generation, command }),
  );
}
