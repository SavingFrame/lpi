import {
  type AskAnswer,
  type AskPrompt,
  type AskQuestion,
  askAnswer,
  validateAskAnswer,
} from './contract.ts';

export interface AskQuestionDraft {
  optionIndexes: number[];
  custom: boolean;
  text: string;
  notes: string;
}

export interface AskDraft {
  questions: AskQuestionDraft[];
  globalNote: string;
}

export function emptyAskDraft(prompt: AskPrompt): AskDraft {
  return {
    questions: prompt.questions.map(() => ({
      optionIndexes: [],
      custom: false,
      text: '',
      notes: '',
    })),
    globalNote: '',
  };
}

export function selectAskOption(
  question: AskQuestion,
  draft: AskQuestionDraft,
  index: number,
): AskQuestionDraft {
  const optionIndexes = question.multiSelect
    ? draft.optionIndexes.includes(index)
      ? draft.optionIndexes.filter((selected) => selected !== index)
      : [...draft.optionIndexes, index].sort((a, b) => a - b)
    : [index];
  return { ...draft, optionIndexes, custom: question.multiSelect ? draft.custom : false };
}

export function selectAskCustom(question: AskQuestion, draft: AskQuestionDraft): AskQuestionDraft {
  return {
    ...draft,
    custom: question.multiSelect ? !draft.custom : true,
    optionIndexes: question.multiSelect ? draft.optionIndexes : [],
  };
}

export function askDraftAnswer(prompt: AskPrompt, draft: AskDraft): AskAnswer {
  const answer = askAnswer({
    toolCallId: prompt.toolCallId,
    answers: draft.questions.map((question, questionIndex) => ({
      questionIndex,
      optionIndexes: question.optionIndexes,
      ...(question.custom ? { text: question.text } : {}),
      notes: question.notes,
    })),
    globalNote: draft.globalNote,
  });
  validateAskAnswer(answer, prompt);
  return answer;
}
