export interface SessionReadState {
  completionId: string | null;
  viewedCompletionId: string | null;
}

export function hasUnreadCompletion(state: SessionReadState): boolean {
  return state.completionId !== null && state.completionId !== state.viewedCompletionId;
}
