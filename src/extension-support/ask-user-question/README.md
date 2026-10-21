# Ask User Question support

Native extension: `@juicesharp/rpiv-ask-user-question`.
Public contract inspected: **2.13.9**, its exported `/events` declarations and
`docs/tool-schema.md`. This is not the separate `pi-ask-user` package.

Install/load the native extension through normal Pi configuration. Pim neither installs
it nor registers another `ask_user_question` tool. Rebuild Pim, restart the relay, reload
its bridge in native Pi while idle, and refresh the browser to enable support. No extra
Pim dependency or API key is required.

## Behavior

- One to four questions per questionnaire, single-select and multi-select.
- Custom text for every question, combined with checked options on multi-select.
- Per-question notes and a global note.
- Markdown previews from matching tool-call arguments, with raw HTML and remote images
  disabled. If preview content is unavailable, the browser says to inspect the terminal.
- Submit all answers together or explicitly decline the questionnaire.
- Multiple questionnaires tracked independently by tool-call ID.
- Completed questionnaires stay in a read-only form layout directly in the transcript.
  All available choices remain visible in their original order, with selected radios or
  checkboxes marked at normal contrast. Custom answers and provided notes remain visible;
  there are no submit/cancel actions. Previews and raw tool data remain available. Skipped
  questions, cancellation, and errors are explicit. This reads native persisted results,
  including terminal answers; missing or unsupported result details fall back to the
  normal tool display.
- Native UI remains usable. The extension owns validation and first-answer-wins behavior;
  a later browser submission is rejected, not applied to a different question.

The browser must answer every question. The extension's external-answer API does not
support the native terminal's partial-submit behavior.

Browser drafts are local component state, not session entries. Navigation, reload, or a
new bridge generation can discard unsent drafts. Pending native questions themselves
survive transport disconnects and are included in reconnect snapshots. A disconnect
never answers, declines, or restarts a tool.

## Shared draft behavior

`draft.ts` owns framework-independent selection, custom-answer, note, and answer-validation
helpers for browser and mobile. It imports only the shared extension contract, not React,
browser components, CSS, or native Pi. Mobile rendering and explicit mobile registration
remain unimplemented; reusing these helpers does not establish device support.

## Browser entry points

Pending questions render through this module's `web.tsx`, registered explicitly in
`src/extension-support/web.tsx`. Persisted answers are parsed by
`frontend/src/ask-history.ts` and rendered by `frontend/src/ask-history-card.tsx`, wired
explicitly into `frontend/src/transcript.tsx` with the normal raw tool fallback. Both
preview surfaces use `frontend/src/components/safe-markdown.ts`. This per-extension
integration is intentional; adding another extension does not require a generic UI
schema or renderer registry.

## Public events

| Event | Adapter use |
| --- | --- |
| `rpiv:ask-user:prompt` | Validate and retain the questionnaire |
| `rpiv:ask-user:blocked` | Remove the named questionnaire when `active: false` |
| `rpiv:ask-user:answer` | Emit a validated external answer/cancellation |
| `rpiv:ask-user:answer-result` | Correlate the authoritative verdict by request and tool-call IDs |

Tool completion is an additional cleanup signal. Prompts are not inferred from old
tool calls in history. Only live public prompt events make a questionnaire actionable.

The prompt event deliberately excludes preview content. The adapter attaches previews
from the same live tool call when the option matches, normalizing carriage returns like
the native extension. Missing arguments never prevent answering without previews.

## Internal messages

`view.extensions['ask-user-question']` contains pending questionnaires. An
`extension_support` notification on the existing event stream replaces the validated
extension snapshot and updates its waiting notice.

Answers use the normal `POST /sessions/:id/commands` endpoint:

```json
{
  "requestId": "unique-browser-request",
  "generation": 3,
  "command": {
    "type": "extension",
    "extension": "ask-user-question",
    "action": {
      "toolCallId": "native-tool-call-id",
      "answers": [{ "questionIndex": 0, "optionIndexes": [1] }]
    }
  }
}
```

Indexes are zero-based. Entries may include `text` and `notes`; the action may include
`globalNote`. To decline, send `{ toolCallId, cancel: true }` as the action.

Only known fields are forwarded. Pim supplies its own native request ID, validates
against the current open questionnaire, and waits for the extension's verdict before
acknowledging. An explicit rejection keeps the connection usable. Verdict timeout
(five seconds), malformed correlation, or transport loss is an unknown outcome, never
an automatic retry. Late verdicts cannot acknowledge commands on a new connection.

Pending state is bounded to 32 questionnaires and 524,288 serialized characters.
Unsupported/malformed/oversized prompt events stay terminal-only.

## Limits and verification

Versions without the public external-answer events are unsupported. There is no generic
extension capability negotiation. Non-TUI hosts, arbitrary custom dialogs, child
sessions using another event bus, and questions opened before the bridge loaded are not
covered. Reloading/restarting native Pi does not recover an unfinished tool.

Focused unit, fake-native bridge, and mocked browser synchronization tests cover this
adapter without model calls or real user state. **Real native-Pi integration remains
unverified.**
