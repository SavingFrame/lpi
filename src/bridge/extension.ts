import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { NativeCommands } from './native/commands.js';
import { registerImageEntry } from './native/image-entry.js';
import { NativeState } from './native/state.js';
import { NativeTransport } from './native/transport.js';

/** Wire native Pi hooks without opening another runtime or starting resources at load time. */
export default function nativeBridge(pi: ExtensionAPI): void {
  const state = new NativeState(pi);
  const commands = new NativeCommands(pi, state);
  const transport = new NativeTransport(state, commands);
  registerImageEntry(pi);

  function forward(event: Record<string, unknown>, context: ExtensionContext): void {
    try {
      if (state.observe(event, context)) {
        transport.forward(event);
      }
    } catch {
      transport.terminate();
    }
  }

  function sync(context: ExtensionContext): void {
    state.context = context;
    transport.sync();
  }

  pi.on('session_start', (_event, context) => {
    transport.stop();
    state.open(context, forward);
    if (context.mode === 'tui') {
      transport.start();
    }
  });
  pi.on('session_shutdown', () => {
    transport.stop();
    state.dispose();
  });
  pi.registerCommand('pim-connect', {
    description: 'Connect this native session to Pim. Optional argument: bridge WebSocket URL.',
    handler: async (args, context) => {
      if (context.mode !== 'tui') {
        return;
      }
      transport.url = args.trim() || transport.url;
      if (
        await context.ui.confirm(
          'Connect to Pim?',
          `Share this transcript and allow remote prompts, model/thinking changes, supported extension answers, and abort requests through ${transport.url}?`,
        )
      ) {
        state.resume(context);
        transport.start();
      }
    },
  });
  pi.registerCommand('pim-disconnect', {
    description: 'Disconnect Pim without stopping the native agent.',
    handler: async () => transport.stop(),
  });
  pi.on('agent_start', (event, context) => forward({ ...event }, context));
  pi.on('agent_settled', (event, context) => {
    forward({ ...event }, context);
    // Rebuild Pi's final branch after persistence and other message transformations.
    transport.sync();
  });
  pi.on('message_start', (event, context) => forward({ ...event }, context));
  pi.on('message_update', (event, context) =>
    forward({ type: event.type, message: event.message }, context),
  );
  pi.on('message_end', (event, context) => forward({ ...event }, context));
  pi.on('tool_execution_start', (event, context) => forward({ ...event }, context));
  pi.on('tool_execution_update', (event, context) => forward({ ...event }, context));
  pi.on('tool_execution_end', (event, context) => forward({ ...event }, context));
  pi.on('session_tree', (_event, context) => sync(context));
  pi.on('session_compact', (_event, context) => sync(context));
  pi.on('ui_prompt_start', (event, context) => {
    state.prompt(event.kind, context);
    transport.sync();
  });
  pi.on('ui_prompt_end', (_event, context) => {
    state.prompt(null, context);
    transport.sync();
  });
}
