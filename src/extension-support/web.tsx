import { AskQuestionnaire } from './ask-user-question/web';
import type { ExtensionCommand, ExtensionSnapshots } from './registry';

/** Browser registry. Never import native bindings or Pi runtime modules here. */
export function ExtensionPanels({
  extensions,
  disabled,
  onCommand,
}: {
  extensions: ExtensionSnapshots;
  disabled: boolean;
  onCommand: (command: ExtensionCommand) => void;
}) {
  return (extensions['ask-user-question'] ?? []).map((prompt) => (
    <AskQuestionnaire
      key={prompt.toolCallId}
      prompt={prompt}
      disabled={disabled}
      onAnswer={(action) =>
        onCommand({ type: 'extension', extension: 'ask-user-question', action })
      }
    />
  ));
}
