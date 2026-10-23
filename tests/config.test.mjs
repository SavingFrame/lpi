import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig } from '../dist/src/config.js';
import { fixture } from './helpers.mjs';

function setup(t) {
  const { root } = fixture(t);
  const home = join(root, 'home');
  const projects = join(home, 'Projects');
  mkdirSync(projects);
  const path = join(root, 'config.json');
  const load = (projectRoots, extra = {}) => {
    writeFileSync(path, JSON.stringify({ projectRoots, ...extra }));
    return loadConfig(path, home);
  };
  return { root, home, projects, load };
}

test('project roots expand home paths and discover immediate non-Git and hidden directories', (t) => {
  const { projects, load } = setup(t);
  for (const name of ['lpi', 'notes', '.hidden']) {
    mkdirSync(join(projects, name));
  }
  mkdirSync(join(projects, 'notes', 'nested'));
  writeFileSync(join(projects, 'README.md'), 'not a project');
  const config = load(['~/Projects/']);
  assert.deepEqual(config.projectRoots, [projects]);
  assert.deepEqual(
    config.projects.map((project) => project.name),
    ['.hidden', 'lpi', 'notes'],
  );
  for (const project of config.projects) {
    assert.match(project.id, /^[a-f0-9]{64}$/);
    assert.equal(project.directory, join(projects, project.name));
  }
});

test('overlapping roots are containers and canonical symlink aliases are deduplicated', (t) => {
  const { root, projects, load } = setup(t);
  const work = join(projects, 'work');
  mkdirSync(work);
  mkdirSync(join(work, 'client'));
  mkdirSync(join(projects, 'lpi'));
  symlinkSync(join(projects, 'lpi'), join(projects, 'alias'));
  symlinkSync(projects, join(root, 'root-alias'));
  symlinkSync(join(projects, 'missing'), join(projects, 'broken'));
  writeFileSync(join(projects, 'file'), 'file');
  symlinkSync(join(projects, 'file'), join(projects, 'file-alias'));
  const roots = ['~/Projects', '~/Projects/work', join(root, 'root-alias'), '~/Projects'];
  const config = load(roots);
  assert.equal(config.projectRoots.length, 2);
  assert.equal(config.projects.length, 2);
  assert.deepEqual(
    new Set(config.projects.map((project) => project.name)),
    new Set(['lpi', 'client']),
  );
  assert.deepEqual(load([...roots].reverse()).projects, config.projects);
});

test('same-named folders have distinct IDs and new folders do not change existing IDs', (t) => {
  const { projects, load } = setup(t);
  const work = join(projects, 'work');
  mkdirSync(work);
  mkdirSync(join(projects, 'app'));
  mkdirSync(join(work, 'app'));
  const before = load(['~/Projects', '~/Projects/work']).projects;
  assert.equal(before.length, 2);
  assert.equal(before[0].name, before[1].name);
  assert.notEqual(before[0].id, before[1].id);
  mkdirSync(join(projects, 'another'));
  const after = load(['~/Projects/work', '~/Projects']).projects;
  for (const project of before) {
    assert.deepEqual(
      after.find((item) => item.directory === project.directory),
      project,
    );
  }
});

test('empty roots are valid, including the home root itself', (t) => {
  const { projects, home, load } = setup(t);
  assert.deepEqual(load(['~/Projects']).projects, []);
  const config = load(['~']);
  assert.deepEqual(config.projectRoots, [home]);
  assert.deepEqual(
    config.projects.map((project) => project.directory),
    [projects],
  );
});

test('network binding defaults to all IPv4 interfaces and accepts explicit IP addresses', (t) => {
  const { load } = setup(t);
  assert.equal(load(['~/Projects']).host, '0.0.0.0');
  for (const host of ['127.0.0.1', '192.168.1.20', '100.64.0.1', '::']) {
    assert.equal(load(['~/Projects'], { host }).host, host);
  }
  for (const host of ['', 'localhost', 123, 'not an address']) {
    assert.throws(() => load(['~/Projects'], { host }), /bind address/);
  }
});

test('desktop origin is explicit and cannot authorize arbitrary custom schemes', (t) => {
  const { load } = setup(t);
  const origins = ['http://127.0.0.1:3141', 'lpi-app://app'];
  assert.deepEqual(load(['~/Projects'], { origins }).origins, origins);
  for (const origin of [
    'null',
    'lpi-app://other',
    'lpi-app://app/',
    'lpi-app://app:123',
    'file://app',
    'lpi-app://user@app',
  ]) {
    assert.throws(() => load(['~/Projects'], { origins: [origin] }));
  }
});

test('Home Assistant is opt-in and accepts only a credential-free origin and mobile notification service', (t) => {
  const { load } = setup(t);
  assert.equal(load(['~/Projects']).homeAssistant, undefined);
  const homeAssistant = { url: 'https://ha.example/', service: 'mobile_app_test_iphone' };
  assert.deepEqual(load(['~/Projects'], { homeAssistant }).homeAssistant, {
    ...homeAssistant,
    url: 'https://ha.example',
  });
  for (const invalid of [
    null,
    { ...homeAssistant, url: 'https://user:token@ha.example' },
    { ...homeAssistant, url: 'https://ha.example/api' },
    { ...homeAssistant, url: 'https://ha.example/?token=secret' },
    { ...homeAssistant, url: 'file:///tmp/ha' },
    { ...homeAssistant, service: 'notify.mobile_app_phone' },
    { ...homeAssistant, service: '../turn_on' },
  ]) {
    assert.throws(() => load(['~/Projects'], { homeAssistant: invalid }));
  }
});

test('invalid roots and the old explicit project schema fail with configuration errors', (t) => {
  const { projects, load } = setup(t);
  assert.throws(() => load([]), /at least one project root/);
  assert.throws(() => load(undefined), /at least one project root/);
  assert.throws(() => load('~/Projects'), /at least one project root/);
  assert.throws(() => load(['Projects']), /absolute or start with/);
  assert.throws(() => load(['~someone/Projects']), /absolute or start with/);
  assert.throws(() => load(['~/missing']), /Project root is unavailable: ~\/missing/);
  writeFileSync(join(projects, 'file'), 'file');
  assert.throws(() => load([join(projects, 'file')]), /Project root is unavailable/);
  assert.throws(() => load(['~/Projects'], { projects: [] }), /Replace projects with projectRoots/);
});
