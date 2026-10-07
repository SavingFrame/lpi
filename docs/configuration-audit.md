# Pi configuration and resource audit

Phase 2 deliberately uses the existing Pi configuration and process environment. It does not create an isolated agent directory, copy credentials, rewrite user settings, or silently disable discovered extensions.

## Discovery contract, Pi 1.0.4

| Resource | Source/behavior |
|---|---|
| Credentials | Normal environment API keys and agent-directory auth.json/OAuth state |
| Agent directory | PI_CODING_AGENT_DIR, otherwise ~/.pi/agent |
| Models | Agent models.json, provider configuration, normal model discovery |
| Settings | Global settings.json plus trusted project .pi/settings.json |
| Instructions | Agent, working directory and ancestor context files |
| Skills/templates | Agent and trusted project resources, configured paths and packages |
| Extensions | Discovered agent/trusted project extensions, package resources, built-ins |
| MCP | Normal built-in/configured extension behavior and trusted project MCP settings |
| Codemode | Normal tool selection and extension discovery; no forced tool override |
| Managed sessions | Explicit --session and --session-dir override normal session storage |

Project trust is unchanged. The backend does not pass --approve. Projects should be trusted deliberately through your normal Pi workflow if their local settings/resources are needed.

Setting a separate session directory **does not isolate global configuration**. Credential refresh, model catalog refresh, startup resource/package activity, extensions, and agent tools can still write outside managed storage.

## API write audit

The API exposes session-local model/thinking setters. Pi 1.0.4 RPC calls these without the persist option, so they append session changes without rewriting global defaults. Model selection can invoke trusted extension hooks. The API exposes no retry/compaction configuration setters, package management, session replacement, or arbitrary RPC passthrough. Skills/templates are expanded normally; extension slash commands are blocked.

This limits accidental application-level settings writes. It does not prevent a prompted agent, model-callable tool, or trusted extension from modifying settings or arbitrary PC files. Project directories are working directories, not a filesystem sandbox.

## Installed-resource static review

The local installation reviewed during implementation uses Pi 1.0.4, enables codemode through defaultTools, and loads global package resources for extension management, side conversations, document parsing, reviews, ask-user-question, model configuration/aliases, and web access. A disabled package entry is not assumed active.

Concrete findings:

- Local notify.ts emitted OSC notifications directly to stdout on agent_end, corrupting RPC framing. With permission, its local handler was guarded by ctx.mode === 'tui' and its imports updated to @earendil-works packages. A separate typecheck and stubbed mode test verified no output for RPC/JSON/print and preserved TUI output. This local fix is not distributed by this repository.
- Local auto-title.ts can make an additional model request at agent_end and append a custom entry. It also schedules title updates. Do not treat agent_end as settled or assume all model costs come from the main run.
- Local desk-gremlin-status.ts writes outside session storage and maintains a heartbeat. It has a session_shutdown cleanup handler, but broader background-process teardown is not proven.
- Local handoff.ts uses custom terminal UI and newSession. ctx.hasUI is true in RPC and is not a TUI-only guard. Its command is blocked by the managed API.
- Terminal file/diff and session-breakdown features remain terminal-only; their custom UI is not a remote interface.
- Installed rpiv-ask-user-question has an RPC dialog fallback, already verified by the earlier feasibility spike. The new backend does not yet answer those dialogs.

This is a bounded static review, **not certification of every installed extension**. Review/model-setting packages, subagent execution, MCP adapters, custom UI, stdout writers, shared-setting writes, and shutdown behavior need real integration coverage before unattended use. No paid model calls, login/credential reads, or real configuration writes were used for backend tests.

## Deployment checks still required

- Inventory the resources actually loaded for each trusted project.
- Check that all stdout writers are TUI-guarded and diagnostics use stderr.
- Verify shared-setting and credential-refresh side effects.
- Verify installed extension cleanup on shutdown, especially timers and child processes.
- Exercise questions, approvals, retries, compaction, and abort with the Phase 3 dialog adapter.
- Keep deterministic tests on temporary HOME, configuration, session directories, and fake processes. Run real-Pi integration only deliberately.

References: the installed Pi documentation for configuration, CLI, RPC commands, extension UI, extensions, and session format. The repository's Phase 1 prototype records verified public-API handoff behavior, not these deployment guarantees.
