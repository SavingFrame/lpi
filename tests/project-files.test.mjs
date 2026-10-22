import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { searchProjectFiles } from '../dist/project-files.js';
import { fixture } from './helpers.mjs';

function setup(t) {
  const base = fixture(t);
  const keys = ['HOME', 'XDG_CONFIG_HOME', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL'];
  const previous = keys.map((key) => process.env[key]);
  process.env.HOME = base.home;
  process.env.XDG_CONFIG_HOME = join(base.home, '.config');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  t.after(() =>
    keys.forEach((key, index) => {
      if (previous[index] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[index];
      }
    }),
  );
  const directory = base.config.projects[0].directory;
  return {
    ...base,
    directory,
    git: (...args) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }),
    file: (path, text = 'Only names may be returned') => {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), text);
    },
    search: async (query) =>
      (await searchProjectFiles(base.config, 'test', query)).entries.map((entry) => entry.path),
  };
}

test('project-wide completion ranks basenames, supports directory scopes, and returns no content', async (t) => {
  const base = setup(t);
  base.file('frontend/src/session/composer.tsx');
  base.file('composer.tsx');
  base.file('other/my-composer.tsx');
  base.file('composer-notes/readme.md');
  assert.deepEqual(await base.search('COMPOSER.TSX'), [
    'composer.tsx',
    'frontend/src/session/composer.tsx',
    'other/my-composer.tsx',
  ]);
  assert.deepEqual(await base.search('frontend/composer'), ['frontend/src/session/composer.tsx']);
  assert.deepEqual(await base.search('notes/read'), ['composer-notes/readme.md']);
  const result = await searchProjectFiles(base.config, 'test', 'composer.tsx');
  assert.deepEqual(result.entries[0], { path: 'composer.tsx', directory: false });
  await assert.rejects(searchProjectFiles(base.config, 'unknown', ''), /not found/);
  await assert.rejects(base.search('../outside'), /Invalid project file query/);
  for (let index = 0; index < 25; index++) {
    base.file(`deep/result-${index}.txt`);
  }
  assert.equal((await base.search('result-')).length, 20);
});

test('recursive search honors Git ignores and tracked exceptions without following links or stale index entries', async (t) => {
  const base = setup(t);
  base.git('init', '--quiet');
  base.file('.gitignore', '*.log\ncache/\nnode_modules/\n');
  base.file('cache/hidden.txt');
  base.file('debug.log');
  base.file('tracked.log');
  base.file('node_modules/tracked.js');
  base.file('node_modules/ignored.js');
  base.file('src/.gitignore', '*.tmp\n!keep.tmp\n');
  base.file('src/hidden.tmp');
  base.file('src/keep.tmp');
  base.file('src/line\nbreak.tmp');
  base.file('global.skip');
  writeFileSync(join(base.root, 'global-ignore'), '*.skip\n');
  base.git('config', 'core.excludesFile', join(base.root, 'global-ignore'));
  base.file('stale.txt');
  base.git('add', '-f', '--', 'tracked.log', 'node_modules/tracked.js', 'stale.txt');
  unlinkSync(join(base.directory, 'stale.txt'));
  writeFileSync(join(base.root, 'outside-secret'), 'outside');
  symlinkSync(join(base.root, 'outside-secret'), join(base.directory, 'escape'));
  symlinkSync(base.root, join(base.directory, 'escape-folder'));
  base.git('add', '--', 'escape', 'escape-folder');
  assert.deepEqual(await base.search('tracked'), ['tracked.log', 'node_modules/tracked.js']);
  assert.deepEqual(await base.search('src/'), ['src/keep.tmp', 'src/.gitignore']);
  for (const query of [
    'hidden',
    'ignored.js',
    'debug.log',
    'global.skip',
    '.git/config',
    'stale.txt',
    'escape',
    'outside-secret',
  ]) {
    assert.deepEqual(await base.search(query), []);
  }
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(searchProjectFiles(base.config, 'test', '', aborted.signal), /abort/i);
});
