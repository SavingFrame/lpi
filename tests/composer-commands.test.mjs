import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeCommands } from '../dist/bridge/native/commands.js';
import { nativeComposerCommands } from '../dist/bridge/native/composer-commands.js';
import { bridgeCommand } from '../dist/shared/commands.js';

function setup() {
  const sent = [];
  const catalog = [
    { name: 'hello', source: 'extension', description: 'Hello' },
    { name: 'skill:review', source: 'skill' },
    { name: 'template', source: 'prompt' },
    { name: 'pim-tree', source: 'extension' },
    { name: 'new', source: 'extension' },
  ];
  const pi = {
    registerCommand() {},
    getCommands: () => catalog,
    sendUserMessage: (...args) => sent.push(args),
  };
  const context = {
    sessionManager: { getSessionFile: () => '/isolated/session', getSessionId: () => 'native' },
    isIdle: () => true,
    hasPendingMessages: () => false,
    ui: { notify() {} },
  };
  const state = { context, view: { compacting: false, notice: null } };
  const commands = new NativeCommands(pi, state);
  const connection = {
    generation: 1,
    session: { file: '/isolated/session', id: 'native' },
    isCurrent: () => true,
  };
  let sequence = 0;
  return {
    pi,
    context,
    state,
    sent,
    catalog,
    execute: (command) =>
      commands.execute({ id: String(sequence++), generation: 1, command }, connection),
  };
}

test('discovered extensions and skills dispatch explicitly, excluding internal and unknown commands', async () => {
  const base = setup();
  assert.deepEqual(
    nativeComposerCommands(base.pi).map((item) => item.name),
    ['hello', 'skill:review'],
  );
  for (const name of ['hello', 'skill:review']) {
    assert.equal(
      (await base.execute({ type: 'slash_command', name, args: 'src' })).outcome,
      'acknowledged',
    );
  }
  assert.deepEqual(base.sent, [
    ['/hello src', { expandPromptTemplates: true }],
    ['/skill:review src', { expandPromptTemplates: true }],
  ]);
  base.catalog.length = 0;
  assert.match(
    (await base.execute({ type: 'slash_command', name: 'hello', args: '' })).error,
    /no longer available/,
  );
  assert.equal(base.sent.length, 2);
  assert.throws(() => bridgeCommand({ type: 'prompt', message: '/hello' }), /slash commands/);
});

test('compaction accepts dispatch, guards concurrent mutations and releases on native completion', async () => {
  const base = setup();
  let options;
  base.context.compact = (value) => {
    options = value;
  };
  const command = { type: 'compact', instructions: 'Keep architecture decisions' };
  base.context.isIdle = () => false;
  assert.match((await base.execute(command)).error, /idle/);
  base.context.isIdle = () => true;
  assert.equal((await base.execute(command)).outcome, 'acknowledged');
  assert.equal(options.customInstructions, command.instructions);
  assert.match((await base.execute(command)).error, /compaction in progress/);
  options.onComplete();
  assert.equal((await base.execute(command)).outcome, 'acknowledged');
  options.onError(new Error('No context'));
  assert.equal((await base.execute(command)).outcome, 'acknowledged');
  options.onComplete();
});
