import { defaultClient } from './controllers.ts';

export { ApiError } from '../../../src/client/api.ts';

const { api } = defaultClient;

export const diff = api.diff.bind(api);
export const searchFiles = api.searchFiles.bind(api);
export const projects = () => api.projects();
export const usage = api.usage.bind(api);
export const sessions = () => api.sessions();
export const inspect = api.inspect.bind(api);
export const tree = api.tree.bind(api);
export const previewBranch = api.previewBranch.bind(api);
export const launch = api.launch.bind(api);
export const setArchived = api.setArchived.bind(api);
export const markViewed = api.markViewed.bind(api);
export const operate = api.operate.bind(api);
