import { record } from '../../src/shared/client-state.ts';
import type { TranscriptTool } from './transcript-state.ts';

interface HistoryOption {
  label: string;
  description?: string;
  preview?: string;
}

interface HistoryQuestion {
  question: string;
  header?: string;
  multiSelect: boolean;
  options: HistoryOption[];
  selected: HistoryOption[];
  custom?: string;
  notes?: string;
  preview?: string;
  skipped: boolean;
}

/** Read native persisted results, never browser drafts or pending extension state. */
export function askHistory(tool: TranscriptTool) {
  if (tool.name !== 'ask_user_question' || !tool.result) {
    return null;
  }
  try {
    const details = record(tool.result.details);
    if (!Array.isArray(details.answers) || typeof details.cancelled !== 'boolean') {
      return null;
    }
    const answers = details.answers.map((value) => {
      const answer = record(value);
      if (
        !Number.isInteger(answer.questionIndex) ||
        typeof answer.questionIndex !== 'number' ||
        answer.questionIndex < 0 ||
        typeof answer.question !== 'string' ||
        !['option', 'custom', 'multi'].includes(String(answer.kind)) ||
        (answer.answer !== null && typeof answer.answer !== 'string') ||
        (answer.selected !== undefined &&
          (!Array.isArray(answer.selected) ||
            !answer.selected.every((label) => typeof label === 'string')))
      ) {
        throw new Error('Invalid answer');
      }
      return answer;
    });
    let sources: Record<string, unknown>[] = [];
    try {
      const args = record(tool.args);
      if (Array.isArray(args.questions)) {
        sources = args.questions.map(record);
      }
    } catch {
      // Results remain readable when original arguments are unavailable.
    }
    const indexes = new Set([...sources.keys(), ...answers.map((a) => Number(a.questionIndex))]);
    const questions: HistoryQuestion[] = [...indexes]
      .sort((a, b) => a - b)
      .map((index) => {
        const answer = answers.find((entry) => entry.questionIndex === index);
        const source = sources[index];
        const matches = source && (!answer || source.question === answer.question);
        const options: HistoryOption[] =
          matches && Array.isArray(source.options)
            ? source.options.map((value: unknown) => {
                const raw = record(value);
                if (typeof raw.label !== 'string') {
                  throw new Error('Invalid option');
                }
                return {
                  label: raw.label,
                  description: typeof raw.description === 'string' ? raw.description : undefined,
                  preview: typeof raw.preview === 'string' ? raw.preview : undefined,
                };
              })
            : [];
        const labels =
          answer?.kind === 'option' && typeof answer.answer === 'string'
            ? [answer.answer]
            : answer?.kind === 'multi' && Array.isArray(answer.selected)
              ? (answer.selected as string[])
              : [];
        const selected = labels.map(
          (label) => options.find((entry) => entry.label === label) ?? { label },
        );
        return {
          question: String(answer?.question ?? source?.question ?? `Question ${index + 1}`),
          header: matches && typeof source.header === 'string' ? source.header : undefined,
          multiSelect: (matches && source.multiSelect === true) || answer?.kind === 'multi',
          options: [
            ...options,
            ...selected.filter((entry) => !options.some((option) => option.label === entry.label)),
          ],
          selected,
          custom:
            answer?.kind !== 'option' && typeof answer?.answer === 'string'
              ? answer.answer
              : undefined,
          notes: typeof answer?.notes === 'string' ? answer.notes : undefined,
          preview: typeof answer?.preview === 'string' ? answer.preview : undefined,
          skipped: !selected.length && !answer?.answer,
        };
      });
    return {
      questions,
      cancelled: details.cancelled,
      globalNote: typeof details.globalNote === 'string' ? details.globalNote : undefined,
      error: typeof details.error === 'string' ? details.error : undefined,
    };
  } catch {
    return null;
  }
}
