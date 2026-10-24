export interface DiffLine {
  kind: 'context' | 'addition' | 'deletion' | 'hunk' | 'note';
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffFile {
  path: string;
  previousPath?: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

/** Decode Git's quoted UTF-8 paths without treating patch text as executable content. */
function gitPath(input: string, prefix = true): string {
  let path = input;
  if (input.startsWith('"') && input.endsWith('"')) {
    const escapes: Record<string, string> = {
      n: '\n',
      r: '\r',
      t: '\t',
      b: '\b',
      f: '\f',
      v: '\v',
      a: '\x07',
    };
    const encoded = [...input.slice(1, -1).matchAll(/\\([0-7]{1,3}|.)|([^\\]+)/gs)]
      .map((match) => {
        const escaped = match[1];
        if (escaped === undefined) {
          return encodeURIComponent(match[2] ?? '');
        }
        if (/^[0-7]{1,3}$/.test(escaped)) {
          return `%${Number.parseInt(escaped, 8).toString(16).padStart(2, '0')}`;
        }
        return encodeURIComponent(escapes[escaped] ?? escaped);
      })
      .join('');
    try {
      path = decodeURIComponent(encoded);
    } catch {
      path = input.slice(1, -1);
    }
  }
  return prefix ? path.replace(/^[ab]\//, '') : path;
}

/** Native-friendly unified diff projection. Binary and metadata-only files remain listed. */
export function diffFiles(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const paths = line.slice(11).match(/^("(?:\\.|[^"\\])*"|a\/.+) ("(?:\\.|[^"\\])*"|b\/.+)$/);
      file = { path: gitPath(paths?.[2] ?? line.slice(11)), additions: 0, deletions: 0, lines: [] };
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) {
      continue;
    }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      file.lines.push({ kind: 'hunk', text: line });
      inHunk = true;
      continue;
    }
    if (inHunk) {
      if (line.startsWith('+')) {
        file.additions++;
        file.lines.push({ kind: 'addition', text: line.slice(1), newLine: newLine++ });
      } else if (line.startsWith('-')) {
        file.deletions++;
        file.lines.push({ kind: 'deletion', text: line.slice(1), oldLine: oldLine++ });
      } else if (line.startsWith(' ')) {
        file.lines.push({
          kind: 'context',
          text: line.slice(1),
          oldLine: oldLine++,
          newLine: newLine++,
        });
      } else if (line.startsWith('\\')) {
        file.lines.push({ kind: 'note', text: line });
      }
    } else if (line.startsWith('--- ') && line !== '--- /dev/null') {
      file.previousPath = gitPath(line.slice(4));
    } else if (line.startsWith('+++ ') && line !== '+++ /dev/null') {
      file.path = gitPath(line.slice(4));
    } else if (line.startsWith('rename to ')) {
      file.path = gitPath(line.slice(10), false);
    } else if (line.startsWith('rename from ')) {
      file.previousPath = gitPath(line.slice(12), false);
    } else if (
      line.startsWith('Binary files ') ||
      line.startsWith('old mode ') ||
      line.startsWith('new mode ')
    ) {
      file.lines.push({ kind: 'note', text: line });
    }
  }
  return files;
}
