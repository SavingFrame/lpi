import { type FileDiffMetadata, parsePatchFiles } from '@pierre/diffs';
import type { TranscriptTool } from './transcript-state.ts';

/** Only saved, successful edits describe applied changes. Never infer them from arguments. */
export function editDiff(tool: TranscriptTool): FileDiffMetadata | undefined {
  if (tool.name !== 'edit' || tool.status !== 'Completed' || tool.result?.isError === true) {
    return undefined;
  }
  const details = tool.result?.details;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) {
    return undefined;
  }
  const patch = (details as Record<string, unknown>).patch;
  if (typeof patch !== 'string' || !patch.trim()) {
    return undefined;
  }
  try {
    const files = parsePatchFiles(patch, undefined, true).flatMap((entry) => entry.files);
    return files.length === 1 && files[0]?.hunks.length ? files[0] : undefined;
  } catch {
    return undefined;
  }
}
