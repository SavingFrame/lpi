import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { type BridgeCommand, bridgeCommand, type NativeIdentity } from '../../shared/commands.js';
import { AppError, text } from '../../shared/errors.js';
import type { NativeState } from './state.js';

interface CommandConnection {
  generation: number | undefined;
  session: NativeIdentity;
}

type CommandResult =
  | { id: string; outcome: 'rejected'; error: string }
  | { id: string; outcome: 'acknowledged'; sync?: true; shutdown?: () => void };

/** Native preflight and dispatch. Throws after uncertain dispatch instead of claiming rejection. */
export class NativeCommands {
  private readonly pi: ExtensionAPI;
  private readonly state: NativeState;
  private readonly seen = new Set<string>();
  private stopping = false;
  private changingSettings = false;

  constructor(pi: ExtensionAPI, state: NativeState) {
    this.pi = pi;
    this.state = state;
  }

  async execute(
    raw: Record<string, unknown>,
    connection: CommandConnection,
  ): Promise<CommandResult> {
    const context = this.state.context;
    if (!context) {
      throw new Error('Native context unavailable');
    }
    const id = text(raw.id, 'command ID', 64);
    if (this.seen.has(id) || this.seen.size >= 100_000) {
      throw new Error('Duplicate native command or command capacity exceeded');
    }
    this.seen.add(id);
    let command: BridgeCommand;
    try {
      if (
        connection.generation === undefined ||
        raw.generation !== connection.generation ||
        context.sessionManager.getSessionFile() !== connection.session.file ||
        context.sessionManager.getSessionId() !== connection.session.id
      ) {
        throw new Error('Stale native session command');
      }
      command = bridgeCommand(raw.command);
      if (this.stopping) {
        throw new Error('Native runtime is stopping');
      }
      if (this.changingSettings) {
        throw new Error('Native settings change in progress');
      }
      if (
        (command.type === 'set_model' || command.type === 'set_thinking_level') &&
        (!context.isIdle() ||
          this.state.view.compacting ||
          context.hasPendingMessages() ||
          this.state.view.notice !== null)
      ) {
        throw new Error('Wait until native Pi is idle with no queued messages or dialogs');
      }
      if (command.type === 'stop_runtime' && !this.state.managedRuntime) {
        throw new Error('Only Pim-managed runtimes can be stopped remotely');
      }
      if (command.type === 'prompt' && !context.isIdle() && !command.streamingBehavior) {
        throw new Error('Native agent is busy. Use steer or follow-up.');
      }
    } catch (error) {
      return {
        id,
        outcome: 'rejected',
        error: error instanceof Error ? error.message : 'Command rejected',
      };
    }

    if (command.type === 'extension') {
      try {
        if (!this.state.extensions) {
          throw new AppError('Native extension support is unavailable', 422);
        }
        await this.state.extensions.execute(command, id);
      } catch (error) {
        // Only local preflight or an explicit extension verdict can reject safely.
        if (!(error instanceof AppError) || error.outcome === 'unknown') {
          throw error;
        }
        return { id, outcome: 'rejected', error: error.message };
      }
      return { id, outcome: 'acknowledged' };
    }
    if (command.type === 'stop_runtime') {
      this.stopping = true;
      return {
        id,
        outcome: 'acknowledged',
        // The transport must flush acceptance before shutdown disconnects the bridge.
        shutdown: () => {
          context.abort();
          context.shutdown();
        },
      };
    }
    if (command.type === 'set_model') {
      const model = context.modelRegistry
        .getAvailable()
        .find((model) => model.provider === command.provider && model.id === command.modelId);
      if (!model) {
        return { id, outcome: 'rejected', error: 'Model is unavailable' };
      }
      this.changingSettings = true;
      try {
        if (!(await this.pi.setModel(model))) {
          return { id, outcome: 'rejected', error: 'Model authentication is unavailable' };
        }
      } finally {
        this.changingSettings = false;
      }
      return { id, outcome: 'acknowledged', sync: true };
    }
    if (command.type === 'set_thinking_level') {
      this.pi.setThinkingLevel(command.level);
      return { id, outcome: 'acknowledged', sync: true };
    }
    if (command.type === 'abort') {
      context.abort();
    } else {
      const deliverAs =
        command.type === 'steer'
          ? 'steer'
          : command.type === 'follow_up'
            ? 'followUp'
            : command.streamingBehavior;
      this.pi.sendUserMessage(
        command.images?.length
          ? [{ type: 'text', text: command.message }, ...command.images]
          : command.message,
        { deliverAs, expandPromptTemplates: false },
      );
      if (command.images?.length) {
        // Durable TUI feedback only, without duplicating image bytes or model context.
        this.pi.appendEntry('pim-image-attachments', {
          count: command.images.length,
          mode: deliverAs === 'followUp' ? 'follow_up' : (deliverAs ?? 'prompt'),
        });
      }
    }
    return { id, outcome: 'acknowledged' };
  }
}
