import { type ReactNode, useId } from 'react';
import { SafeMarkdown } from '../../../components/safe-markdown';
import { Textarea } from '../../../components/ui/textarea';
import type { TranscriptTool } from '../transcript-state';
import { askHistory } from './ask-history';
import '../../../../../src/extension-support/ask-user-question/web.css';

export function AskHistory({ tool, children }: { tool: TranscriptTool; children: ReactNode }) {
  const id = useId();
  const history = askHistory(tool);
  if (!history) {
    return children;
  }
  const failed = Boolean(history.error || tool.status === 'Failed');
  return (
    <section className="ask-questionnaire ask-history" aria-label="Questions and answers">
      <header>
        <div className="flex items-center justify-between gap-3">
          <h2>Questions and answers</h2>
          <span className={`text-xs ${failed ? 'error' : 'text-muted-foreground'}`}>
            {failed ? 'Failed' : history.cancelled ? 'Cancelled' : 'Answered'}
          </span>
        </div>
        <p>Read-only. Recorded answers cannot be changed here.</p>
      </header>
      {history.error && <p className="error">{history.error}</p>}
      {history.questions.map((question, questionIndex) => {
        const name = `${id}-question-${questionIndex}`;
        return (
          <fieldset className="ask-question" key={question.question}>
            <legend>
              {question.header && <span className="ask-header">{question.header}</span>}
              {question.question}
            </legend>
            <div className="ask-options">
              {question.options.map((option) => (
                <div className="ask-option" key={option.label}>
                  <input
                    type={question.multiSelect ? 'checkbox' : 'radio'}
                    name={name}
                    aria-label={option.label}
                    checked={question.selected.some((selected) => selected.label === option.label)}
                    disabled
                    readOnly
                  />
                  <div>
                    <strong>{option.label}</strong>
                    {option.description && (
                      <span className="ask-description">{option.description}</span>
                    )}
                    {option.preview && option.preview !== question.preview && (
                      <details className="mt-2 text-sm">
                        <summary>Preview</summary>
                        <div className="ask-preview">
                          <SafeMarkdown>{option.preview}</SafeMarkdown>
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              ))}
              <div className="ask-option">
                <input
                  type={question.multiSelect ? 'checkbox' : 'radio'}
                  name={name}
                  aria-label="Type something."
                  checked={question.custom !== undefined}
                  disabled
                  readOnly
                />
                <span>Type something.</span>
              </div>
            </div>
            {question.custom !== undefined && (
              <label className="ask-text" htmlFor={`${name}-custom`}>
                Custom answer
                <Textarea id={`${name}-custom`} value={question.custom} readOnly rows={3} />
              </label>
            )}
            {question.skipped && (
              <p className="ask-hint">
                {failed ? 'No answer available' : history.cancelled ? 'Cancelled' : 'Skipped'}
              </p>
            )}
            {question.notes && (
              <label className="ask-text" htmlFor={`${name}-note`}>
                Note
                <Textarea id={`${name}-note`} value={question.notes} readOnly rows={2} />
              </label>
            )}
            {question.preview && (
              <div className="ask-preview mt-3">
                <SafeMarkdown>{question.preview}</SafeMarkdown>
              </div>
            )}
          </fieldset>
        );
      })}
      {history.globalNote && (
        <label className="ask-text" htmlFor={`${id}-global-note`}>
          Note for all answers
          <Textarea id={`${id}-global-note`} value={history.globalNote} readOnly rows={2} />
        </label>
      )}
      <details className="mt-3 text-xs">
        <summary>Tool details</summary>
        {children}
      </details>
    </section>
  );
}
