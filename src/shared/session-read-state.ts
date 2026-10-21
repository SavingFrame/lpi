import { record } from './client-state.ts';

export interface SessionReadState {
  completionId: string | null;
  viewedCompletionId: string | null;
}

export function readState(value: unknown): SessionReadState {
  const raw = record(value);
  for (const id of [raw.completionId, raw.viewedCompletionId]) {
    if (id !== null && (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))) {
      throw new Error('Invalid session read state');
    }
  }
  return {
    completionId: raw.completionId as string | null,
    viewedCompletionId: raw.viewedCompletionId as string | null,
  };
}

export function hasUnreadCompletion(state: SessionReadState): boolean {
  return state.completionId !== null && state.completionId !== state.viewedCompletionId;
}
