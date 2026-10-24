import { record } from './client-state.ts';

export function projectDiffEventsPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/diff/events`;
}

export interface ProjectDiff {
  patch: string;
  truncated: boolean;
}

export function projectDiff(value: unknown): ProjectDiff {
  const raw = record(value);
  if (
    typeof raw.patch !== 'string' ||
    raw.patch.length > 4 * 1024 * 1024 ||
    typeof raw.truncated !== 'boolean'
  ) {
    throw new Error('Invalid project diff');
  }
  return { patch: raw.patch, truncated: raw.truncated };
}
