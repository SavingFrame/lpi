import { useId, useState } from 'react';
import { SafeMarkdown } from '../../../frontend/src/components/safe-markdown';
import { Button } from '../../../frontend/src/components/ui/button';
import { Textarea } from '../../../frontend/src/components/ui/textarea';
import { type AskAnswer, type AskPrompt, askAnswer } from './contract';
import {
  type AskQuestionDraft,
  askDraftAnswer,
  emptyAskDraft,
  selectAskCustom,
  selectAskOption,
} from './web-state';
import './web.css';

export function AskQuestionnaire({
  prompt,
  disabled,
  onAnswer,
}: {
  prompt: AskPrompt;
  disabled: boolean;
  onAnswer: (answer: AskAnswer) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(() => emptyAskDraft(prompt));
  const [focused, setFocused] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);

  function update(questionIndex: number, patch: Partial<AskQuestionDraft>): void {
    setError(null);
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question, index) =>
        index === questionIndex ? { ...question, ...patch } : question,
      ),
    }));
  }

  return (
    <section className="ask-questionnaire" aria-labelledby={`${id}-title`}>
      <header>
        <h2 id={`${id}-title`}>Pi has questions</h2>
        <p>Ask User Question · Answer here or in the terminal. The first submitted answer wins.</p>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled) {
            return;
          }
          try {
            onAnswer(askDraftAnswer(prompt, draft));
            setError(null);
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Invalid answer');
          }
        }}
      >
        {prompt.questions.map((question, questionIndex) => {
          const answer = draft.questions[questionIndex];
          if (!answer) {
            return null;
          }
          const name = `${id}-question-${questionIndex}`;
          const previewOption = question.options[focused[questionIndex] ?? 0];
          const showPreview =
            !question.multiSelect &&
            !answer.custom &&
            question.options.some((option) => option.hasPreview);
          return (
            <fieldset key={name} disabled={disabled} className="ask-question">
              <legend>
                <span className="ask-header">{question.header}</span>
                {question.question}
              </legend>
              <p className="ask-hint">
                {question.multiSelect
                  ? 'Choose any options, custom text, or both.'
                  : 'Choose one option or type an answer.'}
              </p>
              <div className={showPreview ? 'ask-options-and-preview' : undefined}>
                <div className="ask-options">
                  {question.options.map((option, index) => (
                    <label key={option.label} className="ask-option">
                      <input
                        type={question.multiSelect ? 'checkbox' : 'radio'}
                        name={name}
                        checked={answer.optionIndexes.includes(index)}
                        onFocus={() =>
                          setFocused((current) => ({ ...current, [questionIndex]: index }))
                        }
                        onChange={() => {
                          update(questionIndex, selectAskOption(question, answer, index));
                          setFocused((current) => ({ ...current, [questionIndex]: index }));
                        }}
                      />
                      <span>
                        <strong>{option.label}</strong>
                        <span className="ask-description">{option.description}</span>
                      </span>
                    </label>
                  ))}
                  <label className="ask-option">
                    <input
                      type={question.multiSelect ? 'checkbox' : 'radio'}
                      name={name}
                      checked={answer.custom}
                      onChange={() => update(questionIndex, selectAskCustom(question, answer))}
                    />
                    <span>Type something.</span>
                  </label>
                </div>
                {showPreview && (
                  <aside className="ask-preview" aria-label={`${question.header} option preview`}>
                    {previewOption?.preview ? (
                      <SafeMarkdown>{previewOption.preview}</SafeMarkdown>
                    ) : (
                      <p className="ask-hint">
                        {previewOption?.hasPreview
                          ? 'Preview unavailable in the browser. Inspect it in the terminal before choosing.'
                          : 'No preview for this option.'}
                      </p>
                    )}
                  </aside>
                )}
              </div>
              {answer.custom && (
                <label className="ask-text" htmlFor={`${name}-custom`}>
                  Custom answer for {question.header}
                  <Textarea
                    id={`${name}-custom`}
                    value={answer.text}
                    maxLength={100_000}
                    onChange={(event) => update(questionIndex, { text: event.target.value })}
                    rows={3}
                  />
                </label>
              )}
              <label className="ask-text" htmlFor={`${name}-note`}>
                Note for {question.header} (optional)
                <Textarea
                  id={`${name}-note`}
                  value={answer.notes}
                  maxLength={100_000}
                  onChange={(event) => update(questionIndex, { notes: event.target.value })}
                  rows={2}
                />
              </label>
            </fieldset>
          );
        })}
        <label className="ask-text" htmlFor={`${id}-global-note`}>
          Note for all answers (optional)
          <Textarea
            id={`${id}-global-note`}
            disabled={disabled}
            value={draft.globalNote}
            maxLength={100_000}
            onChange={(event) =>
              setDraft((current) => ({ ...current, globalNote: event.target.value }))
            }
            rows={2}
          />
        </label>
        <p className="ask-hint">
          Answer every question before submitting. Cancel declines the whole questionnaire.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="ask-actions">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() =>
              onAnswer(
                askAnswer({
                  toolCallId: prompt.toolCallId,
                  cancel: true,
                  globalNote: draft.globalNote,
                }),
              )
            }
          >
            Cancel questionnaire
          </Button>
          <Button type="submit" size="sm" disabled={disabled}>
            Submit answers
          </Button>
        </div>
      </form>
    </section>
  );
}
