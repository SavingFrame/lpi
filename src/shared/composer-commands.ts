import { record } from './client-state.ts';

export interface ComposerCommand {
  name: string;
  description: string;
  source: 'extension' | 'skill';
}

export function composerCommands(value: unknown): ComposerCommand[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 4096) {
    throw new Error('Invalid composer commands');
  }
  return value.map((item) => {
    const raw = record(item);
    if (
      typeof raw.name !== 'string' ||
      !raw.name ||
      /\s|\//.test(raw.name) ||
      typeof raw.description !== 'string' ||
      (raw.source !== 'extension' && raw.source !== 'skill')
    ) {
      throw new Error('Invalid composer command');
    }
    return { name: raw.name, description: raw.description, source: raw.source };
  });
}

export function availableComposerCommands(commands: ComposerCommand[]): ComposerCommand[] {
  return commands.filter(
    ({ name }) => !name.startsWith('lpi-') && !['new', 'compact'].includes(name),
  );
}
