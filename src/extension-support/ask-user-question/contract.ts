import { AppError, object, text } from '../../shared/errors.ts';

// Public rpiv event contract, inspected against @juicesharp/rpiv-ask-user-question 2.13.9.
// No runtime import: the native extension remains independently installed and loaded by Pi.
export const ASK_PROMPT = 'rpiv:ask-user:prompt';
export const ASK_BLOCKED = 'rpiv:ask-user:blocked';
export const ASK_ANSWER = 'rpiv:ask-user:answer';
export const ASK_ANSWER_RESULT = 'rpiv:ask-user:answer-result';
export const ASK_MAX_PENDING = 32;
export const ASK_STATE_LIMIT = 512 * 1024;

export interface AskOption {
  label: string;
  description: string;
  hasPreview: boolean;
  preview?: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: AskOption[];
}

export interface AskPrompt {
  toolCallId: string;
  questions: AskQuestion[];
}

export interface AskAnswerEntry {
  questionIndex: number;
  optionIndexes?: number[];
  text?: string;
  notes?: string;
}

export interface AskAnswer {
  toolCallId: string;
  answers?: AskAnswerEntry[];
  globalNote?: string;
  cancel?: boolean;
}

function field(value: unknown, name: string, maximum = 100_000): string {
  if (typeof value !== 'string' || value.length > maximum) {
    throw new AppError(`Invalid Ask ${name}`, 400);
  }
  return value;
}

export function askPrompt(value: unknown): AskPrompt {
  const raw = object(value);
  if (!Array.isArray(raw.questions) || raw.questions.length < 1 || raw.questions.length > 4) {
    throw new AppError('Ask requires one to four questions', 400);
  }
  const prompt: AskPrompt = {
    toolCallId: text(raw.toolCallId, 'Ask tool call ID', 256),
    questions: raw.questions.map((value) => {
      const question = object(value);
      if (
        typeof question.multiSelect !== 'boolean' ||
        !Array.isArray(question.options) ||
        question.options.length < 2 ||
        question.options.length > 4
      ) {
        throw new AppError('Invalid Ask question options', 400);
      }
      return {
        question: field(question.question, 'question'),
        header: field(question.header, 'header', 16),
        multiSelect: question.multiSelect,
        options: question.options.map((value) => {
          const option = object(value);
          if (typeof option.hasPreview !== 'boolean') {
            throw new AppError('Invalid Ask preview flag', 400);
          }
          return {
            label: field(option.label, 'option label', 60),
            description: field(option.description, 'option description'),
            hasPreview: option.hasPreview,
            ...(option.preview === undefined ? {} : { preview: field(option.preview, 'preview') }),
          };
        }),
      };
    }),
  };
  if (
    new Set(prompt.questions.map((question) => question.question)).size !==
      prompt.questions.length ||
    prompt.questions.some(
      (question) =>
        new Set(question.options.map((option) => option.label)).size !== question.options.length,
    )
  ) {
    throw new AppError('Duplicate Ask question or option', 400);
  }
  if (JSON.stringify(prompt).length > ASK_STATE_LIMIT) {
    throw new AppError('Ask questionnaire is too large', 400);
  }
  return prompt;
}

export function askState(value: unknown): AskPrompt[] {
  if (!Array.isArray(value) || value.length > ASK_MAX_PENDING) {
    throw new AppError('Invalid pending Ask questionnaires', 400);
  }
  const prompts = value.map(askPrompt);
  if (
    new Set(prompts.map((prompt) => prompt.toolCallId)).size !== prompts.length ||
    JSON.stringify(prompts).length > ASK_STATE_LIMIT
  ) {
    throw new AppError('Duplicate or oversized pending Ask questionnaires', 400);
  }
  return prompts;
}

export function askAnswer(value: unknown): AskAnswer {
  const raw = object(value);
  const toolCallId = text(raw.toolCallId, 'Ask tool call ID', 256);
  const globalNote =
    raw.globalNote === undefined ? undefined : field(raw.globalNote, 'global note').trim();
  if (raw.cancel !== undefined && typeof raw.cancel !== 'boolean') {
    throw new AppError('Invalid Ask cancellation', 400);
  }
  if (raw.cancel === true) {
    if (raw.answers !== undefined && (!Array.isArray(raw.answers) || raw.answers.length !== 0)) {
      throw new AppError('Ask cancellation takes no answers', 400);
    }
    return { toolCallId, cancel: true, ...(globalNote ? { globalNote } : {}) };
  }
  if (!Array.isArray(raw.answers) || raw.answers.length < 1 || raw.answers.length > 4) {
    throw new AppError('Answer every Ask question before submitting', 400);
  }
  const answers = raw.answers.map((value): AskAnswerEntry => {
    const entry = object(value);
    const questionIndex = entry.questionIndex;
    if (
      typeof questionIndex !== 'number' ||
      !Number.isInteger(questionIndex) ||
      questionIndex < 0 ||
      questionIndex > 3
    ) {
      throw new AppError('Invalid Ask question index', 400);
    }
    let optionIndexes: number[] | undefined;
    if (entry.optionIndexes !== undefined) {
      if (!Array.isArray(entry.optionIndexes) || entry.optionIndexes.length > 4) {
        throw new AppError('Invalid Ask option indexes', 400);
      }
      optionIndexes = entry.optionIndexes.map((index: unknown) => {
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 3) {
          throw new AppError('Invalid Ask option index', 400);
        }
        return index;
      });
      if (new Set(optionIndexes).size !== optionIndexes.length) {
        throw new AppError('Repeated Ask option index', 400);
      }
    }
    const answerText = entry.text === undefined ? undefined : text(entry.text, 'Ask custom answer');
    const notes = entry.notes === undefined ? undefined : field(entry.notes, 'notes').trim();
    if (!optionIndexes?.length && answerText === undefined) {
      throw new AppError('Each Ask answer needs a selection or custom text', 400);
    }
    return {
      questionIndex,
      ...(optionIndexes === undefined ? {} : { optionIndexes }),
      ...(answerText === undefined ? {} : { text: answerText }),
      ...(notes ? { notes } : {}),
    };
  });
  if (new Set(answers.map((answer) => answer.questionIndex)).size !== answers.length) {
    throw new AppError('Repeated Ask question index', 400);
  }
  return { toolCallId, answers, ...(globalNote ? { globalNote } : {}) };
}

/** Reject locally before emitting anything, then let the extension validate authoritatively. */
export function validateAskAnswer(answer: AskAnswer, prompt: AskPrompt): void {
  if (answer.toolCallId !== prompt.toolCallId) {
    throw new AppError('Ask questionnaire does not match this answer', 422);
  }
  if (answer.cancel) {
    return;
  }
  if (answer.answers?.length !== prompt.questions.length) {
    throw new AppError('Answer every Ask question before submitting', 422);
  }
  for (const entry of answer.answers) {
    const question = prompt.questions[entry.questionIndex];
    const indexes = entry.optionIndexes ?? [];
    if (!question || indexes.some((index) => index >= question.options.length)) {
      throw new AppError('Ask answer index is out of range', 422);
    }
    if (
      !question.multiSelect &&
      (indexes.length > 1 || (indexes.length && entry.text !== undefined))
    ) {
      throw new AppError('Single-select Ask questions take one option or custom text', 422);
    }
  }
}

function normalizedField(value: unknown): string | undefined {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').replace(/\r/g, '') : undefined;
}

/** The public prompt omits preview content. Only enrich from matching, normalized tool args. */
export function withAskPreviews(prompt: AskPrompt, args: unknown): AskPrompt {
  if (
    !args ||
    typeof args !== 'object' ||
    !('questions' in args) ||
    !Array.isArray(args.questions)
  ) {
    return prompt;
  }
  const questions = args.questions;
  if (questions.length !== prompt.questions.length) {
    return prompt;
  }
  const enriched = {
    ...prompt,
    questions: prompt.questions.map((question, questionIndex) => {
      const source: unknown = questions[questionIndex];
      if (
        !source ||
        typeof source !== 'object' ||
        !('question' in source) ||
        normalizedField(source.question) !== question.question ||
        !('header' in source) ||
        normalizedField(source.header) !== question.header ||
        ('multiSelect' in source ? (source.multiSelect ?? false) : false) !==
          question.multiSelect ||
        !('options' in source) ||
        !Array.isArray(source.options) ||
        source.options.length !== question.options.length
      ) {
        return question;
      }
      const options = source.options;
      return {
        ...question,
        options: question.options.map((option, index) => {
          const original: unknown = options[index];
          if (
            !option.hasPreview ||
            !original ||
            typeof original !== 'object' ||
            !('label' in original) ||
            normalizedField(original.label) !== option.label ||
            !('description' in original) ||
            normalizedField(original.description) !== option.description ||
            !('preview' in original) ||
            typeof original.preview !== 'string' ||
            original.preview.length > 100_000
          ) {
            return option;
          }
          return { ...option, preview: original.preview.replace(/\r\n/g, '\n').replace(/\r/g, '') };
        }),
      };
    }),
  };
  return JSON.stringify(enriched).length <= ASK_STATE_LIMIT ? enriched : prompt;
}
