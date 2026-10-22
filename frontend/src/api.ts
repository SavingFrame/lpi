import { v4 as uuid } from 'uuid';
import { RelayApi } from '../../src/client/api.ts';

export { ApiError } from '../../src/client/api.ts';

const api = new RelayApi({
  fetch: (path, request) => fetch(path, request),
  requestId: () => uuid(),
});

export const searchFiles = api.searchFiles.bind(api);
export const projects = api.projects.bind(api);
export const sessions = api.sessions.bind(api);
export const inspect = api.inspect.bind(api);
export const tree = api.tree.bind(api);
export const previewBranch = api.previewBranch.bind(api);
export const launch = api.launch.bind(api);
export const setArchived = api.setArchived.bind(api);
export const markViewed = api.markViewed.bind(api);
export const operate = api.operate.bind(api);
