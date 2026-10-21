import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { AppError, object, text } from '../../errors.ts';
import {
  ASK_ANSWER,
  ASK_ANSWER_RESULT,
  ASK_BLOCKED,
  ASK_MAX_PENDING,
  ASK_PROMPT,
  type AskAnswer,
  type AskPrompt,
  askPrompt,
  askState,
  validateAskAnswer,
  withAskPreviews,
} from './contract.ts';

interface Attempt {
  toolCallId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Uses only the extension's public bus contract. Does not register or replace its tool. */
export function askUserQuestionSupport(
  pi: Pick<ExtensionAPI, 'events'>,
  changed: () => void,
  toolArgs: (toolCallId: string) => unknown,
  timeout = 5000,
) {
  const prompts = new Map<string, AskPrompt>();
  const attempts = new Map<string, Attempt>();

  function close(toolCallId: string): void {
    if (prompts.delete(toolCallId)) {
      changed();
    }
  }

  const unsubscribe = [
    pi.events.on(ASK_PROMPT, (value) => {
      try {
        const prompt = askPrompt(value);
        if (prompts.has(prompt.toolCallId) || prompts.size >= ASK_MAX_PENDING) {
          return;
        }
        const enriched = withAskPreviews(prompt, toolArgs(prompt.toolCallId));
        askState([...prompts.values(), enriched]);
        prompts.set(prompt.toolCallId, enriched);
        changed();
      } catch {
        // An unsupported or oversized prompt remains usable in the native terminal.
      }
    }),
    pi.events.on(ASK_BLOCKED, (value) => {
      try {
        const blocked = object(value);
        if (blocked.active === false) {
          close(text(blocked.toolCallId, 'Ask tool call ID', 256));
        }
      } catch {
        // Malformed notifications must not resolve or cancel a native interaction.
      }
    }),
    pi.events.on(ASK_ANSWER_RESULT, (value) => {
      let requestId: string;
      let raw: Record<string, unknown>;
      try {
        raw = object(value);
        requestId = text(raw.requestId, 'Ask answer request ID', 64);
      } catch {
        return;
      }
      const attempt = attempts.get(requestId);
      if (!attempt) {
        return;
      }
      clearTimeout(attempt.timer);
      attempts.delete(requestId);
      if (
        raw.toolCallId !== attempt.toolCallId ||
        typeof raw.ok !== 'boolean' ||
        (raw.ok === false &&
          !['not_found', 'invalid_payload', 'invalid_answer', 'unsupported_host'].includes(
            String(raw.code),
          ))
      ) {
        attempt.reject(
          new AppError('Invalid Ask answer verdict. Outcome unknown.', 503, 'unknown'),
        );
        return;
      }
      if (raw.ok) {
        close(attempt.toolCallId);
        attempt.resolve();
      } else {
        if (raw.code === 'not_found') {
          close(attempt.toolCallId);
        }
        attempt.reject(new AppError(`Ask rejected the answer (${String(raw.code)}).`, 422));
      }
    }),
  ];

  return {
    snapshot(): AskPrompt[] {
      return [...prompts.values()];
    },
    complete(toolCallId: string): void {
      close(toolCallId);
    },
    answer(action: AskAnswer, requestId: string): Promise<void> {
      const prompt = prompts.get(action.toolCallId);
      if (!prompt) {
        throw new AppError('Ask questionnaire is no longer open', 422);
      }
      validateAskAnswer(action, prompt);
      if (
        attempts.size >= 32 ||
        attempts.has(requestId) ||
        [...attempts.values()].some((attempt) => attempt.toolCallId === action.toolCallId)
      ) {
        throw new AppError('An Ask answer is already pending or the channel is full', 429);
      }
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          attempts.delete(requestId);
          reject(new AppError('Ask answer verdict timed out. Outcome unknown.', 503, 'unknown'));
        }, timeout);
        attempts.set(requestId, { toolCallId: action.toolCallId, resolve, reject, timer });
        // Install correlation before emit: rpiv can respond synchronously.
        try {
          pi.events.emit(ASK_ANSWER, { ...action, requestId });
        } catch {
          clearTimeout(timer);
          attempts.delete(requestId);
          reject(new AppError('Ask answer delivery failed. Outcome unknown.', 503, 'unknown'));
        }
      });
    },
    dispose(): void {
      for (const off of unsubscribe) {
        off();
      }
      for (const attempt of attempts.values()) {
        clearTimeout(attempt.timer);
        attempt.reject(
          new AppError('Native session changed. Ask answer outcome unknown.', 503, 'unknown'),
        );
      }
      attempts.clear();
      prompts.clear();
    },
  };
}
