import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { nativeExtensionSupport } from '../../extension-support/native.js';
import { historyMessages } from '../../pi-history.js';
import { emptyView, reduceEvent, type View } from '../../shared/client-state.js';
import type { NativeIdentity } from '../../shared/commands.js';
import type { NativeStatus } from '../../shared/snapshots.js';
import { nativeComposerCommands } from './composer-commands.js';
import { NativeQueue } from './queue.js';

/** Session-scoped Pi state, retained independently of the relay connection. */
export class NativeState {
  context: ExtensionContext | undefined;
  readonly queue = new NativeQueue();
  readonly managedRuntime: boolean;
  private readonly pi: ExtensionAPI;
  private current: View = emptyView();
  private support: ReturnType<typeof nativeExtensionSupport> | undefined;
  private nativeNotice: string | null = null;
  private compactionError: string | null = null;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
    const launchId = process.env.PIM_LAUNCH_ID;
    this.managedRuntime =
      launchId !== undefined &&
      /^[a-f0-9-]{36}$/.test(launchId) &&
      process.env.PIM_TMUX_SESSION === `pim-${launchId}`;
  }

  get view(): View {
    return this.current;
  }

  get extensions(): ReturnType<typeof nativeExtensionSupport> | undefined {
    return this.support;
  }

  open(
    context: ExtensionContext,
    changed: (event: Record<string, unknown>, context: ExtensionContext) => void,
  ): void {
    this.dispose();
    this.context = context;
    this.nativeNotice = null;
    this.compactionError = null;
    this.current = { ...emptyView(), running: !context.isIdle() };
    if (context.mode === 'tui') {
      this.queue.start(() => this.context);
      this.support = nativeExtensionSupport(
        this.pi,
        () => {
          if (this.context && this.support) {
            changed(
              {
                type: 'extension_support',
                extensions: this.support.snapshot(),
                notice: this.support.notice() ?? this.nativeNotice,
              },
              this.context,
            );
          }
        },
        (toolCallId) => this.current.tools.find((tool) => tool.id === toolCallId)?.args,
      );
    }
  }

  resume(context: ExtensionContext): void {
    this.context = context;
    if (context.mode === 'tui') {
      this.current = { ...this.current, running: !context.isIdle() };
    }
  }

  dispose(): void {
    this.queue.dispose();
    this.support?.dispose();
    this.support = undefined;
  }

  identity(): NativeIdentity {
    const context = this.requireContext();
    const file = context.sessionManager.getSessionFile();
    if (!file) {
      throw new Error('Ephemeral sessions cannot connect to Pim');
    }
    return {
      file,
      id: context.sessionManager.getSessionId(),
      cwd: context.cwd,
      createdAt: context.sessionManager.getHeader()?.timestamp ?? new Date().toISOString(),
      parentSession: context.sessionManager.getHeader()?.parentSession,
    };
  }

  status(): NativeStatus {
    const context = this.requireContext();
    return {
      state: {
        commands: nativeComposerCommands(this.pi),
        compactionError: this.compactionError,
        managedRuntime: this.managedRuntime,
        leafId: context.sessionManager.getLeafId(),
        isStreaming: !context.isIdle(),
        hasPendingMessages: context.hasPendingMessages(),
        queue: this.queue.snapshot(),
        sessionName: context.sessionManager.getSessionName(),
        pendingDialog: this.current.notice,
      },
      controls: {
        availableModels: context.modelRegistry.getAvailable().map(({ provider, id, name }) => ({
          provider,
          id,
          name,
        })),
        scopedModels: context.scopedModels.map(({ model: { provider, id, name } }) => ({
          provider,
          id,
          name,
        })),
        model: context.model
          ? { provider: context.model.provider, id: context.model.id, name: context.model.name }
          : null,
        thinkingLevel: this.pi.getThinkingLevel(),
        availableThinkingLevels: context.model ? getSupportedThinkingLevels(context.model) : [],
        contextUsage: context.getContextUsage() ?? null,
      },
    };
  }

  snapshot() {
    const context = this.requireContext();
    return {
      ...this.status(),
      view: {
        ...this.current,
        messages: historyMessages(context.sessionManager.getBranch()),
      },
    };
  }

  observe(event: Record<string, unknown>, context: ExtensionContext): boolean {
    this.context = context;
    if (context.mode !== 'tui') {
      return false;
    }
    if (event.type === 'compaction_start') {
      this.compactionError = null;
    } else if (event.type === 'compaction_end') {
      this.compactionError = typeof event.errorMessage === 'string' ? event.errorMessage : null;
    }
    this.support?.observe(event);
    // Track transient state offline; history always comes from Pi's current branch.
    try {
      this.current = { ...reduceEvent(this.current, event), messages: [] };
    } catch (error) {
      this.current = emptyView();
      throw error;
    }
    return true;
  }

  prompt(kind: string | null, context: ExtensionContext): void {
    this.context = context;
    this.nativeNotice =
      kind === null ? null : `Native Pi is waiting for ${kind}. Answer in the terminal.`;
    this.current.notice = this.support?.notice() ?? this.nativeNotice;
  }

  private requireContext(): ExtensionContext {
    if (!this.context) {
      throw new Error('Native context unavailable');
    }
    return this.context;
  }
}
