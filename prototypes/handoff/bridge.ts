import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { checkRequest, readAuthority, receiptPath } from './protocol.mjs';

// Explicitly loaded only by the isolated test harness. Not a general-purpose bridge.
export default function bridge(pi: ExtensionAPI) {
  const root = process.env.PIM_HANDOFF_ROOT;
  if (!root) {
    throw new Error('Use the isolated handoff test launcher');
  }
  let switching = false;
  let dialogs = 0;

  const trace = (event: string, data: object = {}) => {
    appendFileSync(
      join(root, 'lifecycle.jsonl'),
      `${JSON.stringify({ event, pid: process.pid, ...data })}\n`,
    );
  };
  const snapshot = (ctx: ExtensionContext) => ({
    file: ctx.sessionManager.getSessionFile(),
    mode: ctx.mode,
    pid: process.pid,
    entries: ctx.sessionManager.getEntries(),
  });
  const acknowledge = (action: string, generation: number, data: object) => {
    writeFileSync(
      receiptPath(root, action, generation),
      JSON.stringify({ action, generation, ...data }, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
  };

  pi.on('session_start', (_event, ctx) => trace('start', snapshot(ctx)));
  pi.on('session_shutdown', (_event, ctx) =>
    trace('shutdown', { file: ctx.sessionManager.getSessionFile() }),
  );
  pi.on('ui_prompt_start', () => {
    dialogs++;
  });
  pi.on('ui_prompt_end', () => {
    dialogs = Math.max(0, dialogs - 1);
  });

  // Cooperative guard for this fixture, not exhaustive mutation interception.
  pi.on('session_before_switch', (event, ctx) => {
    const state = readAuthority(root);
    if (switching && state.phase === 'releasing' && state.vetoRelease) {
      return { cancel: true };
    }
    if (
      event.targetSessionFile === state.target &&
      !(switching && ctx.mode === 'tui' && state.phase === 'reclaiming')
    ) {
      return { cancel: true };
    }
  });
  pi.on('input', () => ({ action: 'handled' })); // No model calls in this fixture.

  for (const action of ['release', 'reclaim'] as const) {
    pi.registerCommand(`pim-${action}`, {
      description: `Prototype: ${action} the isolated managed session`,
      handler: async (args: string, ctx: ExtensionCommandContext) => {
        const generation = Number(args.trim());
        // Validate the receipt filename even when the request fails.
        receiptPath(root, action, generation);
        try {
          if (ctx.mode !== 'tui') {
            throw new Error('Transfer command requires native TUI');
          }
          if (switching) {
            throw new Error('A session replacement is already in progress');
          }
          if (!ctx.isIdle() || ctx.hasPendingMessages() || dialogs) {
            throw new Error('Prototype requires an idle session with no queues or dialogs');
          }
          const state = checkRequest(root, action, generation, ctx.sessionManager.getSessionFile());
          await ctx.waitForIdle();
          checkRequest(root, action, generation, ctx.sessionManager.getSessionFile());
          if (ctx.hasPendingMessages() || dialogs) {
            throw new Error('Session is no longer transferable');
          }
          const destination = action === 'release' ? state.parking : state.target;
          let replaced: ReturnType<typeof snapshot> | undefined;
          switching = true;
          const result = await ctx.switchSession(destination, {
            withSession: async (fresh) => {
              replaced = snapshot(fresh);
              fresh.ui.setStatus(
                'pim-handoff',
                action === 'release' ? 'PIM: parked' : 'PIM: TUI owns session',
              );
            },
          });
          // Old ctx/pi session bindings are invalid now. Only use captured plain data.
          if (result.cancelled || !replaced) {
            throw new Error('Session replacement cancelled');
          }
          acknowledge(action, generation, { ok: true, ...replaced });
        } catch (error) {
          acknowledge(action, generation, { ok: false, error: String(error) });
        } finally {
          switching = false;
        }
      },
    });
  }

  pi.registerCommand('pim-mark', {
    description: 'Prototype: append a harmless marker to the CURRENT session',
    handler: async (args, ctx) => {
      const state = readAuthority(root);
      const file = ctx.sessionManager.getSessionFile();
      const ownsTarget =
        (ctx.mode === 'tui' && state.phase === 'tui') ||
        (ctx.mode === 'rpc' && state.phase === 'rpc');
      if (file === state.target && !ownsTarget) {
        throw new Error('Not the target owner');
      }
      if (file !== state.target && file !== state.parking) {
        throw new Error('Not a test session');
      }
      pi.sendMessage({ customType: 'pim-prototype', content: args, display: true });
      trace('marker', { file, marker: args });
      acknowledge('mark', state.generation, { ok: true, ...snapshot(ctx) });
    },
  });
  pi.registerCommand('pim-status', {
    description: 'Prototype: snapshot the current TUI session',
    handler: async (_args, ctx) => {
      const state = readAuthority(root);
      acknowledge('status', state.generation, { ok: true, ...snapshot(ctx) });
    },
  });
  pi.registerCommand('pim-quit', {
    description: 'Prototype: shut down this test runtime',
    handler: async (_args, ctx) => ctx.shutdown(),
  });
}
