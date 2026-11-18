import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { seededRelayProfileId } from '../../desktop/relay-profile.ts';
import { diffRoute, projectRoute, sessionRoute } from '../src/app/routes.ts';

test('profile-qualified deep links keep local IDs and browser links stay unchanged', () => {
  const root = createRootRoute();
  const routes = [projectRoute, sessionRoute, diffRoute].map((path) =>
    createRoute({ getParentRoute: () => root, path }),
  );
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory(),
  });
  const pc = seededRelayProfileId('https://pc.example');
  const lab = seededRelayProfileId('https://homelab.example');
  assert.equal(pc, seededRelayProfileId('https://PC.example:443/'));
  assert.notEqual(pc, lab);

  for (const [route, suffix, params] of [
    [projectRoute, '', { projectId: 'project' }],
    [sessionRoute, '/sessions/session', { projectId: 'project', sessionId: 'session' }],
    [diffRoute, '/diff', { projectId: 'project' }],
  ]) {
    for (const profileId of [undefined, pc, lab]) {
      const location = router.buildLocation({ to: route, params: { ...params, profileId } });
      assert.equal(
        location.pathname,
        `/app/${profileId ? `${profileId}/` : ''}projects/project${suffix}`,
      );
      const matches = router.matchRoutes(location.pathname, {});
      const match = matches.at(-1);
      assert.equal(match.routeId, route);
      assert.equal(match.params.profileId, profileId);
      assert.equal(matches[0].params.profileId, profileId);
      assert.equal(matches[0].params.projectId, params.projectId);
      for (const [key, id] of Object.entries(params)) {
        assert.equal(match.params[key], id);
      }
    }
  }
});
