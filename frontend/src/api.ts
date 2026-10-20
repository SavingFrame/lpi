import { message, record, type View } from '../../src/client-state.ts';
import type { Project } from '../../src/config.ts';
import { type SessionControls, sessionControls } from '../../src/session-controls.ts';
import type { Session } from '../../src/sessions.ts';

export interface Snapshot {
  epoch: string;
  cursor: number;
  session: Session;
  state: Record<string, unknown>;
  controls: SessionControls;
  view: View;
}

export class ApiError extends Error {
  readonly outcome: string;
  constructor(message: string, outcome: string) {
    super(message);
    this.outcome = outcome;
  }
}

export function session(value: unknown): Session {
  const raw = record(value);
  if (
    typeof raw.id !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(raw.id) ||
    typeof raw.projectId !== 'string' ||
    typeof raw.directory !== 'string' ||
    typeof raw.file !== 'string' ||
    typeof raw.createdAt !== 'string' ||
    typeof raw.piSessionId !== 'string' ||
    !['connected', 'disconnected'].includes(String(raw.connection)) ||
    typeof raw.generation !== 'number' ||
    !Number.isSafeInteger(raw.generation) ||
    raw.generation < 0
  ) {
    throw new Error('Invalid session record');
  }
  return raw as unknown as Session;
}

export function snapshot(value: unknown): Snapshot {
  const raw = record(value);
  const view = record(raw.view);
  if (
    typeof raw.epoch !== 'string' ||
    typeof raw.cursor !== 'number' ||
    !Number.isSafeInteger(raw.cursor) ||
    raw.cursor < 0 ||
    !Array.isArray(view.messages) ||
    !Array.isArray(view.tools) ||
    typeof view.running !== 'boolean' ||
    typeof view.compacting !== 'boolean' ||
    (view.notice !== null && typeof view.notice !== 'string')
  ) {
    throw new Error('Invalid snapshot');
  }
  return {
    epoch: raw.epoch,
    cursor: raw.cursor,
    session: session(raw.session),
    state: record(raw.state),
    controls: sessionControls(raw.controls),
    view: {
      messages: view.messages.map(message),
      partial: view.partial === null ? null : message(view.partial),
      tools: view.tools.map((value) => {
        const tool = record(value);
        if (typeof tool.id !== 'string' || typeof tool.name !== 'string') {
          throw new Error('Invalid tool');
        }
        return { id: tool.id, name: tool.name, args: tool.args, result: tool.result };
      }),
      running: view.running,
      compacting: view.compacting,
      notice: view.notice,
    },
  };
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
  return raw.projects.map((value) => {
    const project = record(value);
    if (
      typeof project.id !== 'string' ||
      typeof project.name !== 'string' ||
      typeof project.directory !== 'string'
    ) {
      throw new Error('Invalid project');
    }
    return { id: project.id, name: project.name, directory: project.directory };
  });
}

export async function sessions(): Promise<Session[]> {
  const raw = record(await request('/sessions'));
  if (!Array.isArray(raw.sessions)) {
    throw new Error('Invalid sessions');
  }
  return raw.sessions.map(session);
}

export async function inspect(id: string, signal: AbortSignal): Promise<Snapshot> {
  return snapshot(await request(`/sessions/${encodeURIComponent(id)}/snapshot`, undefined, signal));
}

export async function operate(
  id: string,
  generation: number,
  command: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return record(
    await request(`/sessions/${encodeURIComponent(id)}/commands`, { generation, command }),
  );
}
