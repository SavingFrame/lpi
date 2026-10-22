import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { availableComposerCommands, type ComposerCommand } from '../../shared/composer-commands.js';

export function nativeComposerCommands(pi: ExtensionAPI): ComposerCommand[] {
  return availableComposerCommands(
    pi.getCommands().flatMap((command) => {
      if (command.source !== 'extension' && command.source !== 'skill') {
        return [];
      }
      return [
        { name: command.name, description: command.description ?? '', source: command.source },
      ];
    }),
  );
}
