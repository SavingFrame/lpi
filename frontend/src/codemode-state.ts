import type { Message } from '../../src/shared/client-state.ts';
import type { TranscriptTool } from './transcript-state.ts';

export interface CodemodeCall {
  key: string;
  name: string;
  args: string;
  status: 'running' | 'ok' | 'error' | 'cancelled';
  durationMs?: number;
  error?: string;
  cost?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Metadata is a display preview, not complete tool arguments or individual outputs. */
export function codemodeState(tool: TranscriptTool) {
  const source = tool.result ?? record(tool.progress);
  const details = record(source?.details);
  const calls: CodemodeCall[] = [];
  if (Array.isArray(details?.calls)) {
    for (const [position, value] of details.calls.entries()) {
      const call = record(value);
      if (
        !call ||
        typeof call.name !== 'string' ||
        typeof call.args !== 'string' ||
        !['running', 'ok', 'error', 'cancelled'].includes(String(call.status))
      ) {
        continue;
      }
      calls.push({
        // Native pending IDs are duplicated and replaced on completion. Calls are append-only.
        key: String(position),
        name: call.name,
        args: call.args,
        status: call.status as CodemodeCall['status'],
        durationMs:
          typeof call.durationMs === 'number' &&
          Number.isFinite(call.durationMs) &&
          call.durationMs >= 0
            ? call.durationMs
            : undefined,
        error: typeof call.error === 'string' ? call.error : undefined,
        cost:
          typeof call.cost === 'number' && Number.isFinite(call.cost) && call.cost >= 0
            ? call.cost
            : undefined,
      });
    }
  }
  const args = record(tool.args);
  let output: Message | undefined = tool.result;
  let wallTime: string | undefined;
  if (output && Array.isArray(output.content)) {
    const first = output.content[0];
    const header =
      first?.type === 'text' && typeof first.text === 'string'
        ? /^Script (?:completed|failed)\nWall time ([\d.]+) seconds\nOutput:\n$/.exec(first.text)
        : null;
    if (header) {
      wallTime = `${header[1]}s`;
      output = { ...output, content: output.content.slice(1) };
    }
  }
  return {
    calls,
    script: typeof args?.code === 'string' ? args.code : undefined,
    output,
    wallTime,
    fullOutputPath:
      typeof details?.fullOutputPath === 'string' ? details.fullOutputPath : undefined,
    errors: calls.filter((call) => call.status === 'error').length,
    cancelled: calls.filter((call) => call.status === 'cancelled').length,
  };
}

export function codemodeCallInput(call: CodemodeCall): string {
  const fields = call.name === 'bash' ? ['command'] : ['path', 'query', 'url', 'command'];
  for (const field of fields) {
    // The enclosing JSON and even the selected string can be cut off by Pi's preview limit.
    const match = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`).exec(call.args);
    if (match) {
      try {
        return JSON.parse(`"${match[1]}"`);
      } catch {
        return match[1] ?? call.args;
      }
    }
  }
  return call.args;
}
