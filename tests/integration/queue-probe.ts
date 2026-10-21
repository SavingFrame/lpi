import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { NativeCommands } from '../../src/bridge/native/commands.ts';
import { NativeState } from '../../src/bridge/native/state.ts';

/** Explicitly loaded only by the isolated, opt-in native-queue integration test. */
export default function queueProbe(pi: ExtensionAPI): void {
  const state = new NativeState(pi);
  const commands = new NativeCommands(pi, state);
  const seen: string[] = [];
  let calls = 0;
  let cleared = false;
  let failure: string | undefined;
  const resultFile = process.env.PIM_QUEUE_PROBE_RESULT;
  assert.ok(resultFile);

  pi.on('session_start', (_event, context) => {
    assert.equal(context.mode, 'json');
    assert.ok(
      pi.getCommands().some((command) => command.name === 'pim-connect'),
      'source bridge loaded',
    );
    state.open(context, () => {});
    // Exercise the same adapter without starting the TUI-only bridge transport.
    state.queue.start(() => state.context);
  });
  pi.on('session_shutdown', () => state.dispose());
  pi.on('agent_settled', () => {
    try {
      assert.equal(failure, undefined);
      assert.ok(cleared);
      assert.ok(seen.includes('replacement-steer'));
      assert.ok(seen.includes('replacement-followup'));
      assert.ok(!seen.includes('cancel-steer'));
      assert.ok(!seen.includes('cancel-followup'));
      assert.deepEqual(state.queue.snapshot()?.steering, []);
      assert.deepEqual(state.queue.snapshot()?.followUp, []);
      writeFileSync(resultFile, JSON.stringify({ passed: true, calls, seen }));
    } catch (error) {
      writeFileSync(resultFile, JSON.stringify({ passed: false, error: String(error), failure }));
    }
  });
  pi.registerProvider('pim-queue-probe', {
    api: 'pim-queue-probe-api',
    baseUrl: 'http://127.0.0.1:1',
    apiKey: 'fake-not-a-credential',
    models: [
      {
        id: 'fake',
        name: 'Fake',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100000,
        maxTokens: 1000,
      },
    ],
    streamSimple(model, context) {
      const stream = createAssistantMessageEventStream();
      const call = ++calls;
      for (const message of context.messages) {
        if (message.role === 'user') {
          seen.push(
            typeof message.content === 'string'
              ? message.content
              : message.content
                  .filter((part) => part.type === 'text')
                  .map((part) => part.text)
                  .join(''),
          );
        }
      }
      void (async () => {
        const output = {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'fake response' }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop' as const,
          timestamp: Date.now(),
        };
        try {
          if (call === 1) {
            assert.ok(state.queue.snapshot(), 'prompt wrapper captured the real session');
            pi.sendUserMessage('cancel-steer', { deliverAs: 'steer' });
            pi.sendUserMessage('cancel-followup', { deliverAs: 'followUp' });
            for (let attempt = 0; attempt < 200; attempt++) {
              const queue = state.queue.snapshot();
              if (queue?.steering.length === 1 && queue.followUp.length === 1) {
                break;
              }
              await delay(5);
            }
            const queue = state.queue.snapshot();
            assert.ok(queue);
            assert.deepEqual(queue.steering, ['cancel-steer']);
            assert.deepEqual(queue.followUp, ['cancel-followup']);
            const result = await commands.execute(
              {
                id: 'clear',
                generation: 1,
                command: { type: 'clear_queue', expectedRevision: queue.revision },
              },
              { generation: 1, session: state.identity(), isCurrent: () => true },
            );
            assert.equal(result.outcome, 'acknowledged');
            assert.deepEqual(state.queue.snapshot()?.steering, []);
            assert.deepEqual(state.queue.snapshot()?.followUp, []);
            cleared = true;
            pi.sendUserMessage('replacement-steer', { deliverAs: 'steer' });
            pi.sendUserMessage('replacement-followup', { deliverAs: 'followUp' });
            for (let attempt = 0; attempt < 200; attempt++) {
              const next = state.queue.snapshot();
              if (next?.steering.length === 1 && next.followUp.length === 1) {
                break;
              }
              await delay(5);
            }
            assert.deepEqual(state.queue.snapshot()?.steering, ['replacement-steer']);
            assert.deepEqual(state.queue.snapshot()?.followUp, ['replacement-followup']);
          }
          stream.push({ type: 'start', partial: output });
          stream.push({ type: 'done', reason: 'stop', message: output });
        } catch (error) {
          failure = String(error);
          stream.push({
            type: 'error',
            reason: 'error',
            error: {
              ...output,
              stopReason: 'error',
              errorMessage: failure,
            },
          });
        } finally {
          stream.end();
        }
      })();
      return stream;
    },
  });
}
