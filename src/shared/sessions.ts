import { record } from './client-state.ts';
import type { SessionActivity } from './session-activity.ts';
import { readState, type SessionReadState } from './session-read-state.ts';

export interface Project {
  id: string;
  name: string;
  directory: string;
}

export interface Session {
  id: string;
  projectId: string;
  directory: string;
  file: string;
  createdAt: string;
  updatedAt?: string;
  title?: string;
  piSessionId: string;
  /** Pi's parentSession header, also used by clone and explicitly parented sessions. */
  parentSession?: string;
  connection: 'connected' | 'disconnected';
  /** Connection version for rejecting stale commands, not a runtime ownership claim. */
  generation: number;
}

export function promptTitle(content: unknown): string | undefined {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((part: unknown) => {
              if (
                part &&
                typeof part === 'object' &&
                'type' in part &&
                part.type === 'text' &&
                'text' in part &&
                typeof part.text === 'string'
              ) {
                return part.text;
              }
              return '';
            })
            .join(' ')
        : '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 160) || undefined;
}

export interface InventorySession extends Session {
  activity: SessionActivity;
  archived: boolean;
  managedRuntime: boolean;
  readState: SessionReadState;
}

export function project(value: unknown): Project {
  const raw = record(value);
  if (
    typeof raw.id !== 'string' ||
    typeof raw.name !== 'string' ||
    typeof raw.directory !== 'string'
  ) {
    throw new Error('Invalid project');
  }
  return { id: raw.id, name: raw.name, directory: raw.directory };
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
    (raw.updatedAt !== undefined &&
      (typeof raw.updatedAt !== 'string' || !Number.isFinite(Date.parse(raw.updatedAt)))) ||
    (raw.title !== undefined && typeof raw.title !== 'string') ||
    typeof raw.piSessionId !== 'string' ||
    (raw.parentSession !== undefined && typeof raw.parentSession !== 'string') ||
    !['connected', 'disconnected'].includes(String(raw.connection)) ||
    typeof raw.generation !== 'number' ||
    !Number.isSafeInteger(raw.generation) ||
    raw.generation < 0
  ) {
    throw new Error('Invalid session record');
  }
  return raw as unknown as Session;
}

export function inventorySession(value: unknown): InventorySession {
  const raw = record(value);
  const item = session(raw);
  const { activity } = raw;
  if (
    activity !== 'idle' &&
    activity !== 'running' &&
    activity !== 'blocked' &&
    activity !== 'unknown'
  ) {
    throw new Error('Invalid session activity');
  }
  if (typeof raw.managedRuntime !== 'boolean') {
    throw new Error('Invalid managed runtime state');
  }
  if (typeof raw.archived !== 'boolean') {
    throw new Error('Invalid session archive state');
  }
  return {
    ...item,
    activity,
    archived: raw.archived,
    managedRuntime: raw.managedRuntime,
    readState: readState(raw.readState),
  };
}
