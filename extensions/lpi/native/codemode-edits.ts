import type {
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  ToolResultEvent,
  ToolResultEventResult,
} from '@earendil-works/pi-coding-agent';

interface SavedPatch {
  toolCallId: string;
  patch: string;
}

interface PendingPatches {
  patches: SavedPatch[];
  bytes: number;
  omitted: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Only final, successful direct children of codemode are saved. Never reconstruct from input. */
export class NativeCodemodeEdits {
  private readonly pending = new Map<string, PendingPatches>();

  clear(): void {
    this.pending.clear();
  }

  start(event: ToolExecutionStartEvent): void {
    if (event.toolName === 'codemode' && !event.parentToolCallId) {
      this.pending.set(event.toolCallId, { patches: [], bytes: 0, omitted: false });
    }
  }

  end(event: ToolExecutionEndEvent): void {
    if (!event.parentToolCallId) {
      this.pending.delete(event.toolCallId);
      return;
    }
    const parent = this.pending.get(event.parentToolCallId);
    if (!parent || event.toolName !== 'edit' || event.isError) {
      return;
    }
    const patch = record(record(event.result)?.details)?.patch;
    if (typeof patch !== 'string' || !patch.trim()) {
      return;
    }
    const bytes = Buffer.byteLength(patch, 'utf8');
    // Bound additional JSONL/relay data without ever truncating a patch into a misleading diff.
    if (parent.patches.length >= 256 || parent.bytes + bytes > 1024 * 1024) {
      parent.omitted = true;
      return;
    }
    parent.patches.push({ toolCallId: event.toolCallId, patch });
    parent.bytes += bytes;
  }

  result(event: ToolResultEvent): ToolResultEventResult | undefined {
    if (event.toolName !== 'codemode' || event.parentToolCallId) {
      return;
    }
    const parent = this.pending.get(event.toolCallId);
    this.pending.delete(event.toolCallId);
    if (!parent || (!parent.patches.length && !parent.omitted)) {
      return;
    }
    return {
      details: {
        ...record(event.details),
        lpiEditPatches: parent.patches,
        lpiEditPatchesOmitted: parent.omitted,
      },
    };
  }
}
