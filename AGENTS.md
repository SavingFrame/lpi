# Development Rules

Adapted from <https://github.com/earendil-works/pi/blob/main/AGENTS.md> for this repository.

## Project

- Native Pi is the only agent runtime and session-file writer. lpi stores relay metadata separately, never conversation history.
- lpi is a single relay server. Extensions connect to it; do not run a web server per Pi instance.
- Use public Pi extension APIs and normal JSONL persistence. Do not introduce RPC, runtime handoff, Pi Durable, or experimental server/client packages without discussion.
- A lost connection never authorizes launching another writer. Saved-session discovery is read-only.
- Browser create/resume launches native Pi through the dedicated lpi tmux socket. Keep real-Pi integration status and external-writer detection limits explicit.
- Share browser/mobile behavior in `src/client/` through platform adapters. Keep it independent of UI frameworks, DOM, filesystem, database, and Pi runtime dependencies. Contracts live in `src/shared/`; extension-specific support lives in `src/extension-support/`.
- See the repository map in `docs/development.md` for entry points. Keep platform presentation in `frontend/` and `mobile/`.

## Communication

- Keep answers concise, direct, and technical. No emojis, fluff, or cheerful filler.
- Use simple language. Explain non-trivial problems with a concrete example and why the solution is necessary.
- Answer questions before running implementation commands. Do not implement or remove functionality unless asked.
- When responding to feedback, state whether you agree or disagree before describing changes.
- Do not use em dashes or spaced hyphens as sentence interrupters.

## Code Quality

- No `any` unless absolutely necessary. Prefer explicit types and validate external data.
- Check dependency types and public Pi documentation before using APIs; do not guess.
- Top-level imports only. No dynamic imports or inline import types.
- Inline single-line helpers with only one call site.
- Use erasable TypeScript syntax. No enums, namespaces, parameter properties, or other constructs requiring JavaScript emit.
- Do not remove or downgrade functionality to resolve dependency type errors. Update the dependency instead.
- Ask before removing intentional code unless the user has explicitly requested its removal.
- Do not preserve backward compatibility unless requested.

## Tooling and Validation

- Biome is the linter and formatter. Follow `biome.json`: two spaces, single JavaScript quotes, semicolons, trailing commas, and a 100-column line width.
- After code or tooling changes, run `npm run check` with full output. Fix all diagnostics before finishing.
- `npm run check` verifies lint, formatting, and import organization. It does not run tests or type-check the Pi extension.
- Use `npm run format` for formatting, `npm run lint` for lint-only validation, and `npm run check:fix` for safe fixes. Do not use unsafe fixes without review.
- Format changed files before validation. During iteration, run the smallest relevant tests and checks; do not repeat the entire validation chain after every edit. Run final checks once the change stabilizes, and rerun affected checks if subsequent edits invalidate them.
- Do not run the full test suite or integration harness unless requested. For affected server tests, build with `npm run build:server`, then run the specific files with `node --test tests/<file>.test.mjs`. Frontend tests use `node --experimental-strip-types --test frontend/tests/<file>.test.mjs`.
- Keep successful test output concise, using a built-in compact reporter when appropriate. Preserve detailed failure diagnostics and exit status; never hide failures. The full-output requirement for `npm run check` still applies.
- `npm test` runs relay-server and browser unit tests. Native-Pi integration must be requested explicitly.
- Preserve test isolation: temporary HOME, agent directory, sessions, and settings. No real credentials, user configuration, or paid model calls.
- Never open one JSONL file in multiple Pi runtimes. Do not install the bridge globally without permission.
- Write ad-hoc scripts to temporary files, run them, and remove them afterward. Do not embed multiline scripts in shell commands.

## Test Scope and Maintenance

- This is a pet project. Prefer a small, high-value test suite over exhaustive coverage. Do not add tests automatically for every change.
- Add focused tests for meaningful regressions, non-trivial behavior, or risks involving session files, command delivery, persistence, or security. Small presentation and low-risk settings changes can use manual verification; state what was actually checked.
- Keep `node:test`. Do not introduce another test framework or build a fake React/native runtime just to inspect component props.
- Test observable behavior, not helper structure, exact markup, library behavior, or every input combination. Prefer representative cases. Test shared behavior once at the controller layer unless a platform adapter adds a distinct risk.
- Preserve safety coverage for duplicate writers, stale generations, unknown command outcomes, no automatic replay, reconnect ordering, and durable read state. Similar assertions at different trust boundaries are not automatically redundant.
- Read and run only tests relevant to the change. Do not audit, reorganize, expand matrices, or create new harnesses as routine feature work. Keep test maintenance scoped; do not target an arbitrary test count or coverage percentage.
- Use manual browser/device checks for presentation when practical. Add automated real-layout coverage only for a meaningful regression or risk, not every visual change. Mocked DOM tests do not verify layout; fake-native tests do not verify real-Pi integration.

## Dependencies

- Keep direct dependencies pinned to exact versions. Review package and lockfile changes as code.
- Use `npm install --ignore-scripts` for local dependency changes and `npm ci --ignore-scripts` for clean installs.
- For desktop setup, after installing dependencies, verify the Electron binary with `node_modules/electron/dist/electron --version`. If missing, run `node node_modules/electron/install.js` to download it, then verify again. This specific download script is permitted; keep other dependency lifecycle scripts disabled. A successful desktop build does not verify that Electron can launch.
- Refresh `package-lock.json` when dependency metadata changes. Do not run other lifecycle scripts without permission.
- Do not add a framework or dependency without a concrete need.

## Git

- Never commit unless asked.
- Check `git status` before staging. Stage explicit paths, never `git add .` or `git add -A`.
- Use concise, informative commit messages such as `feat: ...`, `fix: ...`, or `docs: ...`.
- Never run `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, or `git commit --no-verify`. Never force push.
- Do not overwrite another session's changes. Resolve conflicts only in files you modified; otherwise stop and ask.

## Documentation

- Keep the root `README.md` public-facing: features, prerequisites, installation, extension setup, high-level architecture, and essential safety limits. Link to detailed guides instead of embedding them.
- Keep configuration/API references, implementation details, repository maps, and contributor workflows in `docs/` or the relevant component documentation. Keep `AGENTS.md` focused on durable development rules.
- Do not add per-task implementation summaries, test-result histories, or machine-specific validation diaries to the root README.
- Update documentation only when those facts change. Do not maintain permanent task plans, implementation diaries, or per-task test histories.
- Distinguish verified behavior from unverified integration where it affects safe use.
- When using external reference instructions, adapt only relevant rules. Do not copy pi-monorepo paths or workflows that do not exist here.
