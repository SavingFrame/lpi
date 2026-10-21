import { QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell, Welcome } from './app';
import { queryClient } from './client';
import { SessionPage } from './session/page';
import './style.css';

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
const router = createRouter({
  routeTree: root.addChildren([index, project, session]),
  defaultNotFoundComponent: () => <Welcome />,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const element = document.getElementById('root');
if (!element) {
  throw new Error('Missing root element');
}
createRoot(element).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
