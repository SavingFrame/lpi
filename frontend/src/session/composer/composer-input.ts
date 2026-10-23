import {
  type ComposerCommand,
  composerCommands,
} from '../../../../src/shared/composer-commands.ts';

export interface InputSuggestion {
  name: string;
  description: string;
  source: 'lpi' | ComposerCommand['source'];
}

export function slashSuggestions(text: string, commands: unknown): InputSuggestion[] {
  if (!/^\/[^\s]*$/.test(text)) {
    return [];
  }
  const query = text.slice(1).toLowerCase();
  return [
    {
      name: 'compact',
      description: 'Compact context. Optional instructions after the command.',
      source: 'lpi' as const,
    },
    { name: 'new', description: 'Create a new session in this project.', source: 'lpi' as const },
    ...composerCommands(commands),
  ]
    .filter((item) => item.name.toLowerCase().includes(query))
    .slice(0, 30);
}

export function fileReference(text: string, caret: number) {
  const match = /(?:^|\s)(@(?:"[^"]*|[^\s"]*))$/.exec(text.slice(0, caret));
  if (!match) {
    return null;
  }
  const token = match[1] ?? '@';
  const value = token.slice(token.startsWith('@"') ? 2 : 1);
  return {
    start: caret - token.length,
    end: caret,
    query: value,
  };
}

export function referencePath(path: string): string {
  return `@${/\s/.test(path) ? JSON.stringify(path) : path}`;
}
