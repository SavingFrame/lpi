export interface SessionTab {
  projectId: string;
  sessionId: string;
  branch?: string;
}

export interface SessionTabsState {
  tabs: SessionTab[];
  active: string | null;
}

export function parseSessionTabs(value: unknown): SessionTabsState {
  const empty: SessionTabsState = { tabs: [], active: null };
  if (!value || typeof value !== 'object') {
    return empty;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.tabs)) {
    return empty;
  }
  const tabs: SessionTab[] = [];
  for (const value of record.tabs as unknown[]) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    const item = value as Record<string, unknown>;
    if (
      typeof item.projectId !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.projectId) ||
      typeof item.sessionId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.sessionId) ||
      tabs.some((tab) => tab.sessionId === item.sessionId)
    ) {
      continue;
    }
    tabs.push({
      projectId: item.projectId,
      sessionId: item.sessionId,
      ...(typeof item.branch === 'string' && item.branch.length <= 128
        ? { branch: item.branch }
        : {}),
    });
  }
  return {
    tabs,
    active:
      typeof record.active === 'string' && tabs.some((tab) => tab.sessionId === record.active)
        ? record.active
        : (tabs[0]?.sessionId ?? null),
  };
}

export function openSessionTab(state: SessionTabsState, tab: SessionTab): SessionTabsState {
  const exists = state.tabs.some((item) => item.sessionId === tab.sessionId);
  return {
    tabs: exists
      ? state.tabs.map((item) => (item.sessionId === tab.sessionId ? tab : item))
      : [...state.tabs, tab],
    active: tab.sessionId,
  };
}

export function closeSessionTab(state: SessionTabsState, id: string): SessionTabsState {
  const index = state.tabs.findIndex((tab) => tab.sessionId === id);
  if (index < 0) {
    return state;
  }
  const tabs = state.tabs.filter((tab) => tab.sessionId !== id);
  return {
    tabs,
    active:
      state.active === id
        ? (tabs[Math.min(index, tabs.length - 1)]?.sessionId ?? null)
        : state.active,
  };
}
