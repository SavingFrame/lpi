import { isRelayProfileId } from '../../../src/shared/desktop.ts';

export interface SessionTab {
  profileId?: string;
  projectId: string;
  sessionId: string;
  branch?: string;
}

export interface SessionTabsState {
  tabs: SessionTab[];
  active: string | null;
}

export function sessionTabKey({
  profileId,
  sessionId,
}: Pick<SessionTab, 'profileId' | 'sessionId'>) {
  return profileId ? `${profileId}:${sessionId}` : sessionId;
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
      (item.profileId !== undefined && !isRelayProfileId(item.profileId))
    ) {
      continue;
    }
    const key = sessionTabKey({ profileId: item.profileId, sessionId: item.sessionId });
    if (tabs.some((tab) => sessionTabKey(tab) === key)) {
      continue;
    }
    tabs.push({
      ...(item.profileId ? { profileId: item.profileId } : {}),
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
      typeof record.active === 'string' && tabs.some((tab) => sessionTabKey(tab) === record.active)
        ? record.active
        : tabs[0]
          ? sessionTabKey(tabs[0])
          : null,
  };
}

export function openSessionTab(state: SessionTabsState, tab: SessionTab): SessionTabsState {
  const key = sessionTabKey(tab);
  const exists = state.tabs.some((item) => sessionTabKey(item) === key);
  return {
    tabs: exists
      ? state.tabs.map((item) => (sessionTabKey(item) === key ? tab : item))
      : [...state.tabs, tab],
    active: key,
  };
}

export function closeSessionTab(state: SessionTabsState, id: string): SessionTabsState {
  const index = state.tabs.findIndex((tab) => sessionTabKey(tab) === id);
  if (index < 0) {
    return state;
  }
  const tabs = state.tabs.filter((tab) => sessionTabKey(tab) !== id);
  const neighbor = tabs[Math.min(index, tabs.length - 1)];
  return {
    tabs,
    active: state.active === id ? (neighbor ? sessionTabKey(neighbor) : null) : state.active,
  };
}
