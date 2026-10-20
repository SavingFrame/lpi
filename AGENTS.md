# Development Rules

Adapted from https://github.com/earendil-works/pi/blob/main/AGENTS.md for this repository.

## Project

- Read `PLAN.md` before architectural changes. Native Pi is the only agent runtime and session-file writer.
- Pim is a single relay server. Extensions connect to it; do not run a web server per Pi instance.
- Use public Pi extension APIs and normal JSONL persistence. Do not introduce RPC, runtime handoff, Pi Durable, or experimental server/client packages without discussion.
- A lost connection never authorizes launching another writer. Saved-session discovery is read-only.
- Tmux launching is planned, not implemented. Keep documentation clear about this boundary.

## Communication

- Keep answers concise, direct, and technical. No emojis, fluff, or cheerful filler.
- Use simple language. Explain non-trivial problems with a concrete example and why the solution is necessary.
- Answer questions before running implementation commands. Do not implement or remove functionality unless asked.
- When responding to feedback, state whether you agree or disagree before describing changes.
- Do not use em dashes or spaced hyphens as sentence interrupters.

## Code Quality

- Read files in full before editing or making broad changes. Do not rely on search snippets.
- Use the read tool for file contents and `rg` for searches. Do not use `cat` or `sed` to read files.
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
- Do not run the full test suite or integration harness unless requested. When modifying a server test, build with `npm run build:server`, then run that specific file with `node --test tests/<file>.test.mjs`. Browser tests use `node --experimental-strip-types --test frontend/tests/live.test.mjs`. Iterate until the modified tests pass.
- `npm test` runs relay-server and browser unit tests. Native-Pi integration must be requested explicitly.
- Preserve test isolation: temporary HOME, agent directory, sessions, and settings. No real credentials, user configuration, or paid model calls.
- Never open one JSONL file in multiple Pi runtimes. Do not install the bridge globally without permission.
- Write ad-hoc scripts to temporary files, run them, and remove them afterward. Do not embed multiline scripts in shell commands.

## Dependencies

- Keep direct dependencies pinned to exact versions. Review package and lockfile changes as code.
- Use `npm install --ignore-scripts` for local dependency changes and `npm ci --ignore-scripts` for clean installs.
- Refresh `package-lock.json` when dependency metadata changes. Do not run lifecycle scripts without permission.
- Do not add a framework or dependency without a concrete need.

## Git

- Never commit unless asked. Only commit files changed in the current session.
- Check `git status` before staging. Stage explicit paths, never `git add .` or `git add -A`.
- Use concise, informative commit messages such as `feat: ...`, `fix: ...`, or `docs: ...`.
- Never run `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, or `git commit --no-verify`. Never force push.
- Do not overwrite another session's changes. Resolve conflicts only in files you modified; otherwise stop and ask.

## Documentation

- Keep `README.md` and `PLAN.md` consistent with what is actually implemented.
- Distinguish verified relay behavior from planned launching and remote-interaction capabilities.
- When using external reference instructions, adapt only relevant rules. Do not copy pi-monorepo paths or workflows that do not exist here.
