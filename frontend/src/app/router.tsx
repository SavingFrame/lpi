import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  useParams,
} from '@tanstack/react-router';
import { defaultRelay, relayFor } from '../client/controllers';
import { RelayProvider } from '../client/relay-context';
import { SessionPage } from '../session/page';
import { DiffPage } from '../workspace/diff-page';
import { diffRoute, projectRoute, sessionRoute } from './routes';
import { SettingsPage } from './settings';
import { Shell } from './shell';
import { Welcome } from './welcome';

function WorkspaceRoot() {
  const { projectId, profileId } = useParams({ strict: false });
  const relay = projectId === undefined ? defaultRelay : relayFor(profileId);
  if (!relay) {
    return (
      <main>
        <p role="alert">This link does not belong to a configured relay.</p>
        <Link to="/">Return to workspace</Link>
      </main>
    );
  }
  return (
    <RelayProvider relay={relay}>
      <Shell />
    </RelayProvider>
  );
}

const root = createRootRoute({ component: WorkspaceRoot });
const index = createRoute({ getParentRoute: () => root, path: '/', component: Welcome });
const project = createRoute({
  getParentRoute: () => root,
  path: projectRoute,
  component: Welcome,
});
const session = createRoute({
  getParentRoute: () => root,
  path: sessionRoute,
  validateSearch: (search: Record<string, unknown>): { branch?: string } => ({
    ...(typeof search.branch === 'string' && search.branch.length <= 128
      ? { branch: search.branch }
      : {}),
  }),
  component: SessionPage,
});
const diff = createRoute({
  getParentRoute: () => root,
  path: diffRoute,
  validateSearch: (search: Record<string, unknown>): { file?: string } => ({
    ...(typeof search.file === 'string' && search.file.length > 0 && search.file.length <= 4096
      ? { file: search.file }
      : {}),
  }),
  component: DiffPage,
});
const settings = createRoute({
  getParentRoute: () => root,
  path: '/app/settings',
  component: SettingsPage,
});
export const router = createRouter({
  routeTree: root.addChildren([index, project, session, diff, settings]),
  defaultNotFoundComponent: () => <Welcome />,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
