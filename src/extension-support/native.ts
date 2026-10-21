import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { askUserQuestionSupport } from './ask-user-question/native.js';
import type { ExtensionCommand, ExtensionSnapshots } from './registry.js';

/** Native registry. Keep browser components out of this import graph. */
export function nativeExtensionSupport(
  pi: ExtensionAPI,
  changed: () => void,
  toolArgs: (toolCallId: string) => unknown,
) {
  const ask = askUserQuestionSupport(pi, changed, toolArgs);
  return {
    snapshot(): ExtensionSnapshots {
      const pending = ask.snapshot();
      return pending.length ? { 'ask-user-question': pending } : {};
    },
    notice(): string | null {
      return ask.snapshot().length
        ? 'Pi is waiting for input. Answer supported questions below or in the terminal.'
        : null;
    },
    execute(command: ExtensionCommand, requestId: string): Promise<void> {
      return ask.answer(command.action, requestId);
    },
    observe(event: Record<string, unknown>): void {
      if (event.type === 'tool_execution_end' && typeof event.toolCallId === 'string') {
        ask.complete(event.toolCallId);
      }
    },
    dispose(): void {
      ask.dispose();
    },
  };
}
