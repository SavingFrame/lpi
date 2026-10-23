import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { SessionPage } from '../session/page';
import { SettingsPage } from './settings';
import { Shell } from './shell';
import { Welcome } from './welcome';

const root = createRootRoute({ component: Shell });
const index = createRoute({ getParentRoute: () => root, path: '/', component: Welcome });
const project = createRoute({
  getParentRoute: () => root,
  path: '/app/projects/$projectId',
  component: Welcome,
});
const session = createRoute({
  getParentRoute: () => root,
  path: '/app/projects/$projectId/sessions/$sessionId',
  validateSearch: (search: Record<string, unknown>): { branch?: string } => ({
    ...(typeof search.branch === 'string' && search.branch.length <= 128
      ? { branch: search.branch }
      : {}),
  }),
  component: SessionPage,
});
const settings = createRoute({
  getParentRoute: () => root,
  path: '/app/settings',
  component: SettingsPage,
});
export const router = createRouter({
  routeTree: root.addChildren([index, project, session, settings]),
  defaultNotFoundComponent: () => <Welcome />,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
