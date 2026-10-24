import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type ComposerDraft, composerCommand } from '../../../../src/client/drafts';
import type { BridgeCommand } from '../../../../src/shared/commands';
import { composerCommands } from '../../../../src/shared/composer-commands';
import type { Snapshot } from '../../../../src/shared/snapshots';
import { searchFiles } from '../../client/api';
import { drafts, launches } from '../../client/controllers';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { useKeyboard, useKeyboardAction } from '../../keyboard/keyboard';
import { shortcut } from '../../keyboard/shortcuts';
import { fileReference, referencePath, slashSuggestions } from './composer-input';
import { ImageAttachments } from './image-attachments';
import { PendingMessages } from './pending-queue';
import { SessionSettings } from './session-controls';

export function Composer({
  id,
  projectId,
  snapshot,
  active,
  previewing,
  restoredDraft,
  pending,
  uncertain,
  outcome,
  onFollow,
  onCommand,
  onNew,
}: {
  id: string;
  projectId: string;
  snapshot: Snapshot | null;
  active: boolean;
  previewing: boolean;
  restoredDraft: ComposerDraft | null;
  pending: boolean;
  uncertain: boolean;
  outcome: string | null;
  onFollow: () => void;
  onCommand: (command: BridgeCommand) => Promise<boolean>;
  onNew: () => Promise<boolean>;
}) {
  const { bindings } = useKeyboard();
  const [controller] = useState(() => drafts.get(id));
  const draftState = useSyncExternalStore(controller.subscribe, controller.getState);
  const { draft } = draftState;
  const [readingImages, setReadingImages] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [caret, setCaret] = useState(draft.text.length);
  const [selected, setSelected] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const launchState = useSyncExternalStore(launches.subscribe, () => launches.getState());
  useEffect(() => {
    void launches.initialize();
  }, []);
  const reference = fileReference(draft.text, caret);
  const fileQuery = reference?.query ?? null;
  const [debouncedFileQuery, setDebouncedFileQuery] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFileQuery(fileQuery), 120);
    return () => clearTimeout(timer);
  }, [fileQuery]);
  const referenceQuery = useQuery({
    queryKey: ['project-file-search', projectId, debouncedFileQuery],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => searchFiles(projectId, debouncedFileQuery ?? '', signal),
    enabled: fileQuery !== null && fileQuery === debouncedFileQuery && !previewing,
    retry: false,
  });
  const refreshingReferences =
    Boolean(reference) && (fileQuery !== debouncedFileQuery || referenceQuery.isPlaceholderData);
  const suggestions =
    dismissed || previewing
      ? []
      : reference
        ? (referenceQuery.data?.entries ?? []).map((entry) => ({
            name: `${entry.path.split('/').at(-1)}${entry.directory ? '/' : ''}`,
            path: `${entry.path}${entry.directory ? '/' : ''}`,
            description: entry.path,
            source: 'file' as const,
          }))
        : slashSuggestions(draft.text, snapshot?.state.commands);
  const highlighted = Math.min(selected, Math.max(0, suggestions.length - 1));
  const suggestionList = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = suggestionList.current;
    const row = suggestions.length ? list?.children.item(highlighted) : null;
    if (!list || !row) {
      return;
    }
    const bounds = list.getBoundingClientRect();
    const selectedBounds = row.getBoundingClientRect();
    if (selectedBounds.top < bounds.top) {
      list.scrollTop += selectedBounds.top - bounds.top;
    } else if (selectedBounds.bottom > bounds.bottom) {
      list.scrollTop += selectedBounds.bottom - bounds.bottom;
    }
  }, [highlighted, suggestions.length]);
  function chooseSuggestion(index: number) {
    const item = suggestions[index];
    if (!item || refreshingReferences) {
      return;
    }
    const path = 'path' in item ? item.path : item.name;
    const replacement = reference
      ? path.endsWith('/')
        ? `@${/\s/.test(path) ? '"' : ''}${path}`
        : `${referencePath(path)} `
      : `/${item.name} `;
    const text = reference
      ? draft.text.slice(0, reference.start) + replacement + draft.text.slice(reference.end)
      : replacement;
    const nextCaret = reference ? reference.start + replacement.length : replacement.length;
    controller.update((current) => ({ ...current, text }));
    setCaret(nextCaret);
    setSelected(0);
    setDismissed(!reference || !path.endsWith('/'));
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    void controller.initialize();
  }, [controller]);
  useEffect(() => {
    if (restoredDraft) {
      controller.restore(restoredDraft);
    }
  }, [controller, restoredDraft]);
  const canSend =
    !previewing &&
    (active || /^\/new\s*$/.test(draft.text)) &&
    !pending &&
    !uncertain &&
    (!/^\/new\s*$/.test(draft.text) || launchState.status === 'ready') &&
    !draftState.loading &&
    !readingImages &&
    Boolean(draft.text.trim() || draft.images.length);
  const settingsDisabled =
    !active ||
    !snapshot ||
    snapshot.view.running ||
    snapshot.view.compacting ||
    snapshot.state.isStreaming === true ||
    snapshot.state.hasPendingMessages === true ||
    snapshot.state.pendingDialog != null;
  useKeyboardAction(
    'thinking',
    () => {
      if (!snapshot) {
        return;
      }
      const { availableThinkingLevels: levels, thinkingLevel } = snapshot.controls;
      const next = levels[(levels.indexOf(thinkingLevel ?? 'off') + 1) % levels.length];
      if (next) {
        void onCommand({ type: 'set_thinking_level', level: next });
      }
    },
    !settingsDisabled &&
      Boolean(snapshot?.controls.model) &&
      (snapshot?.controls.availableThinkingLevels.length ?? 0) > 1,
  );
  useKeyboardAction(
    'abort',
    () => {
      void onCommand({ type: 'abort' });
    },
    active,
  );
  useKeyboardAction('send', () => input.current?.form?.requestSubmit(), canSend);
  return (
    <div className="composer">
      {snapshot && (
        <SessionSettings
          controls={snapshot.controls}
          disabled={settingsDisabled}
          onCommand={onCommand}
        />
      )}
      {snapshot && !previewing && (
        <PendingMessages
          snapshot={snapshot}
          active={active}
          canCopy={!draftState.loading && !pending && !uncertain}
          onCopy={(text) => {
            controller.update((current) => ({
              ...current,
              text: [current.text, text].filter(Boolean).join('\n\n'),
            }));
            input.current?.focus({ preventScroll: true });
          }}
          onCommand={onCommand}
        />
      )}
      {draftState.error && (
        <div className="banner error" role="alert">
          Draft could not be loaded or saved. Keep this tab open to preserve your edits.
          <Button type="button" variant="ghost" size="sm" onClick={() => void controller.retry()}>
            Retry draft storage
          </Button>
        </div>
      )}
      {typeof snapshot?.state.compactionError === 'string' && (
        <p className="banner error" role="alert">
          {snapshot.state.compactionError}
        </p>
      )}
      {inputError && (
        <p className="banner error" role="alert">
          {inputError}
        </p>
      )}
      {launchState.error && (
        <p className="banner error" role="alert">
          {launchState.error.message}
        </p>
      )}
      {launchState.status === 'uncertain' && (
        <div className="banner error">
          Launch outcome unknown. Inspect sessions and tmux before retrying.{' '}
          <Button type="button" variant="ghost" size="sm" onClick={() => launches.review()}>
            I inspected the runtimes
          </Button>
        </div>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!canSend) {
            return;
          }
          const submitted = draft;
          setInputError(null);
          if (submitted.text.trimStart().startsWith('/')) {
            const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(submitted.text.trim());
            const name = match?.[1] ?? '';
            const args = match?.[2] ?? '';
            if (submitted.images.length) {
              setInputError('Send images separately from slash commands.');
              return;
            }
            if (name === 'new') {
              if (args) {
                setInputError(`/${name} does not take arguments.`);
                return;
              }
              controller.settle(submitted, await onNew());
              return;
            }
            if (
              name !== 'compact' &&
              !composerCommands(snapshot?.state.commands).some((command) => command.name === name)
            ) {
              setInputError('Unknown command. Choose an available command from the / menu.');
              return;
            }
            const accepted = await onCommand(
              name === 'compact'
                ? { type: 'compact', instructions: args || undefined }
                : { type: 'slash_command', name, args },
            );
            controller.settle(submitted, accepted);
            return;
          }
          onFollow();
          const accepted = await onCommand(
            composerCommand(submitted, snapshot?.view.running === true),
          );
          controller.settle(submitted, accepted);
        }}
      >
        {suggestions.length > 0 && (
          <div
            ref={suggestionList}
            id="composer-suggestions"
            role="listbox"
            aria-busy={refreshingReferences}
            aria-label={reference ? 'Project file references' : 'Commands'}
            className="composer-suggestions"
          >
            {suggestions.map((item, index) => (
              <div
                tabIndex={-1}
                key={`${item.source}:${'path' in item ? item.path : item.name}`}
                id={`composer-suggestion-${index}`}
                role="option"
                aria-selected={index === highlighted}
              >
                <button
                  type="button"
                  aria-disabled={refreshingReferences}
                  title={`${item.description}${item.source === 'extension' ? '\nMay require interaction in the native terminal. Sending confirms dispatch, not completion.' : ''}`}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseSuggestion(index)}
                >
                  <strong>
                    {reference ? '@' : '/'}
                    {item.name}
                  </strong>
                  <small>{item.source}</small>
                  <span>{item.description}</span>
                </button>
              </div>
            ))}
          </div>
        )}
        {reference && fileQuery === debouncedFileQuery && referenceQuery.error && (
          <p role="status" className="error text-xs">
            {referenceQuery.error.message}
          </p>
        )}
        <ImageAttachments
          images={draft.images}
          onChange={(images) => controller.update((current) => ({ ...current, images }))}
          disabled={previewing || pending || uncertain}
          onBusy={setReadingImages}
        >
          <Textarea
            ref={input}
            data-message-composer
            aria-label="Message"
            aria-controls={suggestions.length ? 'composer-suggestions' : undefined}
            aria-expanded={suggestions.length > 0}
            aria-autocomplete="list"
            aria-activedescendant={
              suggestions.length ? `composer-suggestion-${highlighted}` : undefined
            }
            onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
            disabled={previewing}
            placeholder={
              snapshot?.session.connection === 'connected'
                ? 'What should Pi work on?'
                : 'Connect native Pi to send a message'
            }
            value={draft.text}
            onChange={(event) => {
              const text = event.target.value;
              controller.update((current) => ({ ...current, text }));
              setCaret(event.target.selectionStart);
              setSelected(0);
              setDismissed(false);
              setInputError(null);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
                return;
              }
              const key = shortcut(event);
              if (
                suggestions.length &&
                !event.altKey &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.shiftKey
              ) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSelected(
                    (highlighted + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) %
                      suggestions.length,
                  );
                  return;
                }
                if (event.key === 'Tab' || event.key === 'Enter') {
                  event.preventDefault();
                  if (!event.repeat) {
                    chooseSuggestion(highlighted);
                  }
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDismissed(true);
                  return;
                }
              }
              if (key === bindings.send && bindings.send) {
                event.preventDefault();
                if (!event.repeat) {
                  event.currentTarget.form?.requestSubmit();
                }
              } else if (key === bindings.newline && bindings.newline) {
                event.preventDefault();
                if (event.repeat) {
                  return;
                }
                const element = event.currentTarget;
                const start = element.selectionStart;
                const end = element.selectionEnd;
                controller.update((current) => ({
                  ...current,
                  text: `${current.text.slice(0, start)}\n${current.text.slice(end)}`,
                }));
                setCaret(start + 1);
                requestAnimationFrame(() => element.setSelectionRange(start + 1, start + 1));
              }
            }}
            rows={4}
          />
        </ImageAttachments>
        <div className="composer-footer">
          <span className="muted" role="status">
            {pending ? 'Submitting…' : outcome ? outcome : 'Draft stays in this tab.'}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-red-300 hover:text-red-200"
            disabled={!active}
            onClick={() => void onCommand({ type: 'abort' })}
            title={`Abort${bindings.abort ? ` (${bindings.abort})` : ''}. Does not clear queued messages`}
          >
            <Square aria-hidden="true" />
            Abort
          </Button>
          <Button
            type="submit"
            size="sm"
            title={`Send${bindings.send ? ` (${bindings.send} in message box)` : ''}`}
            disabled={!canSend}
          >
            <ArrowUp aria-hidden="true" />
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
