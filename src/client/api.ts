import { record } from '../shared/client-state.ts';
import type { BridgeCommand } from '../shared/commands.ts';
import { readState, type SessionReadState } from '../shared/session-read-state.ts';
import {
  type BranchPreview,
  branchPreview,
  type SessionTree,
  sessionTree,
} from '../shared/session-tree.ts';
import {
  type InventorySession,
  inventorySession,
  type Project,
  project,
  type Session,
  session,
} from '../shared/sessions.ts';
import { type Snapshot, snapshot } from '../shared/snapshots.ts';

export class ApiError extends Error {
  readonly outcome: string;
  constructor(message: string, outcome: string) {
    super(message);
    this.outcome = outcome;
  }
}

export interface HttpResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export interface HttpRequest {
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

export interface ApiEnvironment {
  fetch: (path: string, request: HttpRequest) => Promise<HttpResponse>;
  requestId: () => string;
}

/** Validated relay transport. Adapters own server addressing and native networking. */
export class RelayApi {
  private readonly environment: ApiEnvironment;

  constructor(environment: ApiEnvironment) {
    this.environment = environment;
  }

  private async request(
    path: string,
    payload?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const mutation = payload !== undefined;
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      controller.abort();
    }
    const timeout = setTimeout(abort, 35_000);
    try {
      const requestId = mutation ? this.environment.requestId() : undefined;
      const response = await this.environment.fetch(path, {
        method: mutation ? 'POST' : 'GET',
        headers: mutation ? { 'Content-Type': 'application/json' } : undefined,
        body: mutation ? JSON.stringify({ ...payload, requestId }) : undefined,
        signal: controller.signal,
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
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  async projects(): Promise<Project[]> {
    const raw = record(await this.request('/projects'));
    if (!Array.isArray(raw.projects)) {
      throw new Error('Invalid projects');
    }
    return raw.projects.map(project);
  }

  async sessions(): Promise<InventorySession[]> {
    const raw = record(await this.request('/sessions'));
    if (!Array.isArray(raw.sessions)) {
      throw new Error('Invalid sessions');
    }
    return raw.sessions.map(inventorySession);
  }

  async inspect(id: string, signal: AbortSignal): Promise<Snapshot> {
    return snapshot(
      await this.request(`/sessions/${encodeURIComponent(id)}/snapshot`, undefined, signal),
    );
  }

  async tree(id: string, signal: AbortSignal): Promise<SessionTree> {
    const result = sessionTree(
      await this.request(`/sessions/${encodeURIComponent(id)}/tree`, undefined, signal),
    );
    if (result.sessionId !== id) {
      throw new Error('Tree session mismatch');
    }
    return result;
  }

  async previewBranch(id: string, entryId: string, signal: AbortSignal): Promise<BranchPreview> {
    const result = branchPreview(
      await this.request(
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

  async launch(projectId: string, resumeId?: string): Promise<Session> {
    const result = record(
      await this.request(
        resumeId ? `/sessions/${encodeURIComponent(resumeId)}/resume` : '/sessions',
        {
          projectId,
          confirmedOffline: resumeId !== undefined,
        },
      ),
    );
    return session(record(result.data).session);
  }

  async markViewed(id: string, completionId: string): Promise<SessionReadState> {
    const result = record(
      await this.request(`/sessions/${encodeURIComponent(id)}/viewed`, { completionId }),
    );
    return readState(record(result.data).readState);
  }

  async operate(
    id: string,
    generation: number,
    command: BridgeCommand,
  ): Promise<Record<string, unknown>> {
    return record(
      await this.request(`/sessions/${encodeURIComponent(id)}/commands`, { generation, command }),
    );
  }
}
