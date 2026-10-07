#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';

if (process.argv.includes('--version')) {
  console.log('1.0.4');
  process.exit(0);
}
const path = process.argv[process.argv.indexOf('--session') + 1];
let buffer = '';
let streaming = false;
let steering = [];
let snapshotReads = 0;
const models = [
  { provider: 'fake', id: 'first', name: 'First' },
  { provider: 'fake', id: 'second', name: 'Second' },
];
let model = models[0];
let thinkingLevel = 'medium';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const index = buffer.indexOf('\n');
    const command = JSON.parse(buffer.slice(0, index));
    buffer = buffer.slice(index + 1);
    if (command.message === 'exit') {
      process.exit(7);
    }
    if (command.message === 'malformed') {
      process.stdout.write('not json\n');
      continue;
    }
    if (command.message === 'overflow') {
      process.stdout.write('x'.repeat(8 * 1024 * 1024 + 1));
      continue;
    }
    if (command.message === 'hang') {
      continue;
    }
    if (command.message === 'stderr') {
      process.stderr.write('x'.repeat(128 * 1024));
    }
    let data = null;
    if (command.type === 'get_state') {
      const header = JSON.parse(readFileSync(path, 'utf8').split('\n')[0]);
      data = {
        sessionId: header.id,
        sessionFile: path,
        isStreaming: streaming,
        pendingMessageCount: steering.length,
        model,
        thinkingLevel,
      };
    } else if (command.type === 'get_available_models') {
      data = { models };
    } else if (command.type === 'get_available_thinking_levels') {
      data = { levels: model.id === 'second' ? ['off'] : ['off', 'medium', 'high'] };
    } else if (command.type === 'get_session_stats') {
      data = {
        contextUsage:
          process.env.PIM_FAKE_CONTEXT_UNKNOWN === 'true'
            ? { tokens: null, contextWindow: 200000, percent: null }
            : { tokens: 60000, contextWindow: 200000, percent: 30 },
      };
    } else if (command.type === 'set_model') {
      model = models.find(
        (item) => item.provider === command.provider && item.id === command.modelId,
      );
      thinkingLevel = model.id === 'second' ? 'off' : 'medium';
      data = model;
    } else if (command.type === 'set_thinking_level') {
      thinkingLevel = model.id === 'second' ? 'off' : command.level;
      process.stdout.write(
        `${JSON.stringify({ type: 'thinking_level_changed', level: thinkingLevel })}\n`,
      );
    } else if (command.type === 'get_commands') {
      data = {
        commands: [
          { name: 'skill:test', source: 'skill' },
          { name: 'template', source: 'prompt' },
          { name: 'management', source: 'extension' },
          { name: 'management', source: 'prompt' },
        ],
      };
    } else if (command.type === 'prompt') {
      appendFileSync(
        path,
        `${JSON.stringify({
          type: 'message',
          id: command.id,
          parentId: null,
          timestamp: new Date().toISOString(),
          message: { role: 'user', content: command.message, timestamp: Date.now() },
        })}\n`,
      );
      data = { disposition: 'started', message: command.message };
      if (command.message === 'snapshot-stream') {
        streaming = true;
        const events = [
          { type: 'agent_start' },
          {
            type: 'message_start',
            message: { role: 'assistant', timestamp: 42, content: [], stopReason: 'pending' },
          },
          {
            type: 'message_update',
            assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello' },
          },
          {
            type: 'tool_execution_start',
            toolCallId: 'call',
            toolName: 'bash',
            args: { command: 'echo test' },
          },
        ];
        for (const event of events) {
          process.stdout.write(`${JSON.stringify(event)}\n`);
        }
      } else {
        process.stdout.write(`${JSON.stringify({ type: 'agent_settled' })}\n`);
      }
    } else if (command.type === 'get_messages') {
      snapshotReads++;
      const race = process.env.PIM_FAKE_SNAPSHOT_RACE;
      if (race === 'always' || (race === 'once' && snapshotReads === 1)) {
        steering = [`raced-${snapshotReads}`];
        process.stdout.write(
          `${JSON.stringify({ type: 'queue_update', steering, followUp: [] })}\n`,
        );
      }
      data = {
        messages: readFileSync(path, 'utf8')
          .trim()
          .split('\n')
          .slice(1)
          .map((line) => JSON.parse(line).message),
      };
    }
    const line = `${JSON.stringify({ type: 'response', id: command.id, command: command.type, success: true, data })}\r\n`;
    // Split inside the UTF-8 encoding of a multibyte character.
    const bytes = Buffer.from(line);
    const multibyte = bytes.indexOf(0xe2);
    const split = multibyte >= 0 ? multibyte + 1 : Math.floor(bytes.length / 2);
    const delay = command.message === 'slow' ? 50 : 0;
    setTimeout(() => {
      process.stdout.write(bytes.subarray(0, split));
      process.stdout.write(bytes.subarray(split));
    }, delay);
  }
});
process.stdin.on('end', () => process.exit(0));
