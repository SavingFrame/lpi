import { record } from './client-state.ts';

export interface ProjectFileSearch {
  entries: { path: string; directory: boolean }[];
  truncated: boolean;
}

export function projectFileSearch(value: unknown): ProjectFileSearch {
  const raw = record(value);
  if (
    !Array.isArray(raw.entries) ||
    raw.entries.length > 20 ||
    typeof raw.truncated !== 'boolean'
  ) {
    throw new Error('Invalid project file search');
  }
  return {
    truncated: raw.truncated,
    entries: raw.entries.map((value) => {
      const entry = record(value);
      if (
        typeof entry.path !== 'string' ||
        !entry.path ||
        entry.path.startsWith('/') ||
        entry.path.includes('\\') ||
        entry.path.includes('\0') ||
        entry.path
          .split('/')
          .some((part) => !part || part === '.' || part === '..' || part === '.git') ||
        typeof entry.directory !== 'boolean'
      ) {
        throw new Error('Invalid project file entry');
      }
      return { path: entry.path, directory: entry.directory };
    }),
  };
}
