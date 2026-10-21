import type { FileContents } from '@pierre/diffs';
import type { TranscriptTool } from './transcript-state.ts';

/** Requested content, not proof that the write succeeded. */
export function writePreview(tool: TranscriptTool): FileContents | undefined {
  if (tool.name !== 'write' || typeof tool.args !== 'object' || tool.args === null) {
    return undefined;
  }
  const args = tool.args as Record<string, unknown>;
  if (typeof args.path !== 'string' || typeof args.content !== 'string') {
    return undefined;
  }
  return { name: args.path, contents: args.content };
}
