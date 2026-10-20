import { getSupportedThinkingLevels } from '@earendil-works/pi-ai/models';
import {
  buildSessionContext,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { WebSocket } from 'ws';
import { emptyView, record, reduceEvent, type View } from '../client-state.js';
import { text } from '../errors.js';
import { reserveManagedFile } from '../tmux-binding.js';
import { BRIDGE_LIMIT, bridgeCommand } from './protocol.js';

/** Connect native Pi to the relay without opening another runtime. */
export default function nativeBridge(pi: ExtensionAPI): void {
  let ctx: ExtensionContext | undefined;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let partialTimer: ReturnType<typeof setTimeout> | undefined;
  let partialEvent: Record<string, unknown> | undefined;
  let generation: number | undefined;
  let sessionFile: string | undefined;
  let sessionId: string | undefined;
  let view: View = emptyView();
  let enabled = false;
  let attempt = 0;
  let bridgeUrl = process.env.PIM_BRIDGE_URL ?? 'ws://127.0.0.1:3141/bridge';
  let lastStatus = '';
  let stopping = false;
  let changingSettings = false;
  const launchId = process.env.PIM_LAUNCH_ID;
  const managedRuntime =
    launchId !== undefined &&
    /^[a-f0-9-]{36}$/.test(launchId) &&
    process.env.PIM_TMUX_SESSION === `pim-${launchId}`;
  const seenCommands = new Set<string>();

  pi.registerEntryRenderer('pim-image-attachments', (entry, _options, theme) => {
    if (!entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data)) {
      return undefined;
    }
    const data = record(entry.data);
    if (
      typeof data.count !== 'number' ||
      !Number.isSafeInteger(data.count) ||
      data.count < 1 ||
      (data.mode !== 'prompt' && data.mode !== 'steer' && data.mode !== 'follow_up')
    ) {
      return undefined;
    }
    const mode = data.mode === 'follow_up' ? 'follow-up' : data.mode;
    const label = `Pim: ${data.count} image${data.count === 1 ? '' : 's'} submitted (${mode})`;
    return {
      render: (width) => [theme.fg('muted', label.slice(0, Math.max(0, width)))],
      invalidate() {},
    };
  });

  function stop(): void {
    enabled = false;
    clearTimeout(retry);
    clearTimeout(partialTimer);
    partialTimer = undefined;
    clearInterval(heartbeat);
    partialEvent = undefined;
    generation = undefined;
    const previous = socket;
    socket = undefined;
    previous?.terminate();
    ctx?.ui.setStatus('pim-bridge', undefined);
  }

  function send(value: unknown): void {
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      const data = JSON.stringify(value);
      if (socket.bufferedAmount + Buffer.byteLength(data) > BRIDGE_LIMIT) {
        socket.terminate();
        return;
      }
      socket.send(data);
    } catch {
      socket.terminate();
    }
  }

  function status() {
    if (!ctx) {
      throw new Error('Native context unavailable');
    }
    const thinkingLevel = pi.getThinkingLevel();
    return {
      state: {
        managedRuntime,
        isStreaming: !ctx.isIdle(),
        hasPendingMessages: ctx.hasPendingMessages(),
        sessionName: ctx.sessionManager.getSessionName(),
        pendingDialog: view.notice,
      },
      controls: {
        availableModels: ctx.modelRegistry.getAvailable().map(({ provider, id, name }) => ({
          provider,
          id,
          name,
        })),
        scopedModels: ctx.scopedModels.map(({ model: { provider, id, name } }) => ({
          provider,
          id,
          name,
        })),
        model: ctx.model
          ? { provider: ctx.model.provider, id: ctx.model.id, name: ctx.model.name }
          : null,
        thinkingLevel,
        availableThinkingLevels: ctx.model ? getSupportedThinkingLevels(ctx.model) : [],
        contextUsage: ctx.getContextUsage() ?? null,
      },
    };
  }

  function sync(): void {
    if (!ctx || generation === undefined) {
      return;
    }
    // Full snapshot includes the latest throttled partial.
    clearTimeout(partialTimer);
    partialTimer = undefined;
    partialEvent = undefined;
    send({
      type: 'sync',
      snapshot: {
        ...status(),
        view: { ...view, messages: buildSessionContext(ctx.sessionManager.getBranch()).messages },
      },
    });
  }

  function connect(): void {
    if (!enabled || !ctx) {
      return;
    }
    try {
      const url = new URL(bridgeUrl);
      if (
        !['ws:', 'wss:'].includes(url.protocol) ||
        url.pathname !== '/bridge' ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      ) {
        throw new Error('Pim endpoint must be a ws:// or wss:// URL ending in /bridge');
      }
      sessionFile = ctx.sessionManager.getSessionFile();
      sessionId = ctx.sessionManager.getSessionId();
      if (!sessionFile) {
        throw new Error('Ephemeral sessions cannot connect to Pim');
      }
      reserveManagedFile(sessionFile);
      const current = new WebSocket(url, {
        maxPayload: BRIDGE_LIMIT,
        perMessageDeflate: false,
        handshakeTimeout: 5000,
      });
      socket = current;
      generation = undefined;
      ctx.ui.setStatus('pim-bridge', 'Pim: connecting');
      current.on('open', () => {
        if (socket !== current || !ctx) {
          return;
        }
        send({
          type: 'attach',
          launchId: process.env.PIM_LAUNCH_ID,
          session: {
            file: sessionFile,
            id: sessionId,
            cwd: ctx.cwd,
            createdAt: ctx.sessionManager.getHeader()?.timestamp ?? new Date().toISOString(),
          },
          snapshot: {
            ...status(),
            view: {
              ...view,
              messages: buildSessionContext(ctx.sessionManager.getBranch()).messages,
            },
          },
        });
      });
      current.on('message', async (data, binary) => {
        if (socket !== current || !ctx) {
          return;
        }
        try {
          if (binary) {
            throw new Error('Text bridge frames required');
          }
          const raw = record(JSON.parse(data.toString()));
          if (raw.type === 'attached' && generation === undefined) {
            if (typeof raw.generation !== 'number' || !Number.isSafeInteger(raw.generation)) {
              throw new Error('Invalid bridge generation');
            }
            generation = raw.generation;
            attempt = 0;
            ctx.ui.setStatus('pim-bridge', 'Pim: connected (remote controls enabled)');
            // Events can happen between attach and its acknowledgment. Reconcile before commands.
            sync();
            return;
          }
          if (raw.type !== 'command') {
            throw new Error('Unsupported bridge message');
          }
          const id = text(raw.id, 'command ID', 64);
          if (seenCommands.has(id) || seenCommands.size >= 100_000) {
            throw new Error('Duplicate native command or command capacity exceeded');
          }
          seenCommands.add(id);
          let command: ReturnType<typeof bridgeCommand>;
          try {
            if (
              generation === undefined ||
              raw.generation !== generation ||
              ctx.sessionManager.getSessionFile() !== sessionFile ||
              ctx.sessionManager.getSessionId() !== sessionId
            ) {
              throw new Error('Stale native session command');
            }
            command = bridgeCommand(raw.command);
            if (stopping) {
              throw new Error('Native runtime is stopping');
            }
            if (changingSettings) {
              throw new Error('Native settings change in progress');
            }
            if (
              (command.type === 'set_model' || command.type === 'set_thinking_level') &&
              (!ctx.isIdle() || view.compacting || ctx.hasPendingMessages() || view.notice !== null)
            ) {
              throw new Error('Wait until native Pi is idle with no queued messages or dialogs');
            }
            if (command.type === 'stop_runtime' && !managedRuntime) {
              throw new Error('Only Pim-managed runtimes can be stopped remotely');
            }
            if (command.type === 'prompt' && !ctx.isIdle() && !command.streamingBehavior) {
              throw new Error('Native agent is busy. Use steer or follow-up.');
            }
          } catch (error) {
            send({
              type: 'ack',
              id,
              outcome: 'rejected',
              error: error instanceof Error ? error.message : 'Command rejected',
            });
            return;
          }
          // Never report rejection after dispatch. A thrown action has an uncertain outcome.
          if (command.type === 'stop_runtime') {
            stopping = true;
            const context = ctx;
            // Flush acceptance before shutdown handlers disconnect the bridge.
            current.send(JSON.stringify({ type: 'ack', id, outcome: 'acknowledged' }), (error) => {
              if (error) {
                current.terminate();
                return;
              }
              try {
                context.abort();
                context.shutdown();
              } catch {
                current.terminate();
              }
            });
            return;
          }
          if (command.type === 'set_model') {
            const model = ctx.modelRegistry
              .getAvailable()
              .find((model) => model.provider === command.provider && model.id === command.modelId);
            if (!model) {
              send({ type: 'ack', id, outcome: 'rejected', error: 'Model is unavailable' });
              return;
            }
            changingSettings = true;
            try {
              if (!(await pi.setModel(model))) {
                send({
                  type: 'ack',
                  id,
                  outcome: 'rejected',
                  error: 'Model authentication is unavailable',
                });
                return;
              }
            } finally {
              changingSettings = false;
            }
            sync();
          } else if (command.type === 'set_thinking_level') {
            pi.setThinkingLevel(command.level);
            sync();
          } else if (command.type === 'abort') {
            ctx.abort();
          } else {
            const deliverAs =
              command.type === 'steer'
                ? 'steer'
                : command.type === 'follow_up'
                  ? 'followUp'
                  : command.streamingBehavior;
            pi.sendUserMessage(
              command.images?.length
                ? [{ type: 'text', text: command.message }, ...command.images]
                : command.message,
              { deliverAs, expandPromptTemplates: false },
            );
            if (command.images?.length) {
              // Durable TUI feedback only. Image bytes remain in the user message, not this entry.
              pi.appendEntry('pim-image-attachments', {
                count: command.images.length,
                mode: deliverAs === 'followUp' ? 'follow_up' : (deliverAs ?? 'prompt'),
              });
            }
          }
          send({ type: 'ack', id, outcome: 'acknowledged' });
        } catch {
          current.terminate();
        }
      });
      current.on('error', () => current.terminate());
      current.on('close', (code) => {
        if (socket !== current) {
          return;
        }
        socket = undefined;
        generation = undefined;
        ctx?.ui.setStatus('pim-bridge', 'Pim: disconnected');
        if (code === 1008 || code === 1009) {
          enabled = false;
          ctx?.ui.notify(
            'Pim rejected the bridge or its payload. Check project configuration and bridge conflicts, then /pim-connect again.',
            'warning',
          );
        } else if (enabled) {
          retry = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 10_000));
        }
      });
    } catch (error) {
      enabled = false;
      ctx.ui.notify(error instanceof Error ? error.message : 'Pim bridge failed', 'error');
    }
  }

  function start(context: ExtensionContext): void {
    stop();
    ctx = context;
    if (ctx.mode !== 'tui') {
      return;
    }
    view = { ...view, running: !ctx.isIdle() };
    enabled = true;
    lastStatus = '';
    connect();
    heartbeat = setInterval(() => {
      if (!ctx || generation === undefined) {
        return;
      }
      const current = status();
      const serialized = JSON.stringify(current);
      if (serialized !== lastStatus) {
        lastStatus = serialized;
        send({ type: 'status', ...current });
      }
    }, 1000);
    heartbeat.unref();
  }

  function forward(event: Record<string, unknown>, context: ExtensionContext): void {
    ctx = context;
    if (ctx.mode !== 'tui') {
      return;
    }
    // Track transient state even offline so reconnect can recover an in-progress response.
    try {
      view = { ...reduceEvent(view, event), messages: [] };
      if (view.tools.length > 512) {
        throw new Error('Native bridge tool limit reached');
      }
    } catch {
      view = emptyView();
      socket?.terminate();
      return;
    }
    if (generation === undefined) {
      return;
    }
    if (event.type === 'message_update') {
      partialEvent = event;
      if (!partialTimer) {
        partialTimer = setTimeout(() => {
          partialTimer = undefined;
          if (partialEvent) {
            send({ type: 'event', event: partialEvent });
            partialEvent = undefined;
          }
        }, 40);
      }
      return;
    }
    clearTimeout(partialTimer);
    partialTimer = undefined;
    if (partialEvent) {
      send({ type: 'event', event: partialEvent });
      partialEvent = undefined;
    }
    send({ type: 'event', event });
  }

  pi.on('session_start', (_event, context) => {
    ctx = context;
    view = { ...emptyView(), running: !context.isIdle() };
    if (context.mode === 'tui') {
      start(context);
    }
  });
  pi.on('session_shutdown', () => stop());
  pi.registerCommand('pim-connect', {
    description: 'Connect this native session to Pim. Optional argument: bridge WebSocket URL.',
    handler: async (args, context) => {
      if (context.mode !== 'tui') {
        return;
      }
      bridgeUrl = args.trim() || bridgeUrl;
      if (
        await context.ui.confirm(
          'Connect to Pim?',
          `Share this transcript and allow remote prompts, model/thinking changes, and abort requests through ${bridgeUrl}?`,
        )
      ) {
        start(context);
      }
    },
  });
  pi.registerCommand('pim-disconnect', {
    description: 'Disconnect Pim without stopping the native agent.',
    handler: async () => stop(),
  });
  pi.on('agent_start', (event, context) => forward({ ...event }, context));
  pi.on('agent_settled', (event, context) => {
    forward({ ...event }, context);
    // Rebuild from Pi's final branch after persistence and other message transformations.
    sync();
  });
  pi.on('message_start', (event, context) => forward({ ...event }, context));
  pi.on('message_update', (event, context) =>
    forward({ type: event.type, message: event.message }, context),
  );
  pi.on('message_end', (event, context) => forward({ ...event }, context));
  pi.on('tool_execution_start', (event, context) => forward({ ...event }, context));
  pi.on('tool_execution_update', (event, context) => forward({ ...event }, context));
  pi.on('tool_execution_end', (event, context) => forward({ ...event }, context));
  pi.on('session_tree', (_event, context) => {
    ctx = context;
    sync();
  });
  pi.on('session_compact', (_event, context) => {
    ctx = context;
    sync();
  });
  pi.on('ui_prompt_start', (event, context) => {
    ctx = context;
    view.notice = `Native Pi is waiting for ${event.kind}. Answer in the terminal.`;
    sync();
  });
  pi.on('ui_prompt_end', (_event, context) => {
    ctx = context;
    view.notice = null;
    sync();
  });
}
