import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { registerProjectRoutes } from '../dist/src/api/projects.js';
import { readProjectDiff } from '../dist/src/project-diff.js';
import { projectDiff } from '../dist/src/shared/project-diff.js';
import { fixture } from './helpers.mjs';

function setup(t) {
  const base = fixture(t);
  const previous = new Map();
  for (const [key, value] of Object.entries({
    HOME: base.home,
    XDG_CONFIG_HOME: join(base.home, '.config'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  })) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
  const directory = base.config.projects[0].directory;
  const git = (...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' });
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  return {
    ...base,
    directory,
    git,
    file: (path, content) => writeFileSync(join(directory, path), content),
  };
}

test('diff includes staged, unstaged, deleted and untracked files without changing the index', async (t) => {
  const base = setup(t);
  base.file('tracked.txt', 'original\n');
  base.file('deleted.txt', 'delete me\n');
  base.file('.gitignore', '*.secret\n');
  base.git('add', '.');
  base.git('commit', '--quiet', '-m', 'initial');
  base.file('tracked.txt', 'staged\n');
  base.git('add', 'tracked.txt');
  base.file('tracked.txt', 'working\n');
  unlinkSync(join(base.directory, 'deleted.txt'));
  base.file('new file.txt', 'new content\n');
  base.file('ignored.secret', 'must not appear\n');
  base.file('image.bin', 'binary\0content');
  writeFileSync(join(base.root, 'outside'), 'outside secret content\n');
  symlinkSync(join(base.root, 'outside'), join(base.directory, 'link'));
  // A configured external diff must never execute.
  base.git('config', 'diff.external', '/nonexistent-diff-command');
  const before = base.git('diff', '--cached', '--no-ext-diff');
  const result = projectDiff(await readProjectDiff(base.config, 'test'));
  assert.match(result.patch, /-original\n\+working/);
  assert.match(result.patch, /deleted file mode/);
  assert.match(result.patch, /new content/);
  assert.match(result.patch, /Binary files/);
  assert.doesNotMatch(result.patch, /must not appear|outside secret content|\+staged/);
  assert.equal(result.truncated, false);
  assert.equal(base.git('diff', '--cached', '--no-ext-diff'), before);
  await assert.rejects(readProjectDiff(base.config, '../outside'), /Project not found/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readProjectDiff(base.config, 'test', controller.signal), /abort/i);
});

test('project diff route supports unborn and clean repositories and rejects non-repositories', async (t) => {
  const base = setup(t);
  base.file('first.txt', 'first\n');
  base.git('add', '.');
  const app = Fastify();
  registerProjectRoutes(app, base.config);
  t.after(() => app.close());
  const response = await app.inject('/projects/test/diff');
  assert.equal(response.statusCode, 200);
  assert.match(projectDiff(response.json()).patch, /\+first/);
  base.git('commit', '--quiet', '-m', 'initial');
  assert.deepEqual(await readProjectDiff(base.config, 'test'), { patch: '', truncated: false });
  const config = { ...base.config, projects: [{ id: 'plain', directory: base.home }] };
  await assert.rejects(readProjectDiff(config, 'plain'), /Could not read diff/);
  assert.throws(() => projectDiff({ patch: 4, truncated: false }), /Invalid project diff/);
});
