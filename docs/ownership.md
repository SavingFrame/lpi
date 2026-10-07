# Managed ownership and recovery

## Authority

Exactly one coordinator holds an exclusive directory lock at `<dataDirectory>/coordinator.lock`. Atomic directory creation prevents competing coordinators for the same storage root. The lock is retained through uncertain shutdown and never stolen using a PID check, timeout, or lost connection.

Use local filesystem storage with atomic mkdir/rename and fsync semantics. Shared/network filesystems and independent catalogs pointing at the same JSONL files are unsupported.

The coordinator is the only writer of the catalog. Ownership changes are persisted via a temporary file, file fsync, atomic rename, and directory fsync before publication or runtime spawn. A storage failure blocks future coordination, while supervised children are still stopped.

Every ownership change increments the generation. Commands must carry the active generation; generations reject stale requests, but are not filesystem fencing tokens.

## States

| State | Meaning | May open another runtime? |
|---|---|---|
| unowned | No participating runtime, confirmed release | Yes, after atomic claim |
| starting | Durable claim, RPC startup in progress | No |
| rpc | One server-owned runtime | No |
| stopping | Mutations blocked, exit awaited | No |
| unknown | Process/transport ownership unavailable or unconfirmed | No |

RPC startup must return the exact managed session path and ID before ownership becomes rpc. Startup failures trigger supervised cleanup. Protocol failures become unknown while the existing child is retained. Explicit stop can terminate that known child from unknown; otherwise an unknown session requires operator confirmation.

Only the child close callback confirms process exit. Unexpected exits preserve normal JSONL history and mark interrupted work. No command or tool is transparently replayed. The interrupted flag is a historical warning and remains set after later reopening.

After a server crash, previous starting/rpc/stopping records become unknown on the next catalog load. Existing unknown records stay unknown. PID metadata is diagnostic only, not authority to release or terminate a potentially reused PID.

## Operator recovery

Recovery is intentionally offline and explicit:

1. Confirm the old coordinator has stopped. Inspect its lock metadata and the actual processes, not just PID liveness.
2. Identify every runtime associated with the affected managed files, including orphaned Pi children. Stop them and verify process exit. Check for retained extension/tool subprocesses that can still write.
3. Only after confirming the old coordinator cannot return, remove its stale `coordinator.lock` directory manually. Removing this lock does not release any session.
4. Start the server to inspect unknown sessions and their current generations, then stop it cleanly. No unknown session is opened.
5. With the server stopped, record your confirmed release:

```sh
npm run recover -- pim.config.json SESSION_ID GENERATION --confirmed-no-writer
```

The command acquires the same exclusive coordinator lock, requires unknown ownership and the exact generation, and records unowned plus interrupted. The flag is an operator assertion, not an automated proof. Never use it when release remains uncertain. If a previously active record is first loaded by recovery, it transitions to unknown and reports its new generation; inspect that generation before repeating the confirmation.

## Existing Pi files

Existing-session discovery is read-only and separate from the durable ownership catalog. A discovered file has unknown ownership, not confirmed release. Pim does not copy or rewrite it, open an RPC child for it, or let offline recovery mark it unowned. Reading persisted history does not establish runtime ownership. Coordinated adoption into this catalog must accompany a pre-open launcher/bridge protocol before continuing an original Pi file.

## Future managed launcher/bridge contract

Phase 2 provides no native CLI launch endpoint, TUI registration, or production handoff. Directly opening a managed JSONL file is unsupported even when the catalog currently says unowned.

Before enabling CLI access:

1. The launcher identifies a registered project/session without opening Pi.
2. It asks the owning coordinator for an atomic claim with the expected generation.
3. The coordinator persists a starting claim and issues a single-use launch capability tied to session, project, launcher identity, and generation.
4. Only the supervised launcher spawns Pi, with the bridge installed before the managed file is opened. Post-start bridge registration alone is too late.
5. Readiness binds that capability to the actual process and exact managed file. Failed or lost startup remains blocked until confirmed exit.
6. Bridge mutations and release receipts carry matching owner identity and generation. Disconnect never releases ownership.
7. Native handoff uses confirmed parking/replacement receipts; RPC handoff awaits confirmed process exit. Ambiguous replacement remains unknown.
8. On restart, an unreconciled live TUI remains blocked. No second writer is launched.

The prototype's authority file is not reused as a production lock. Its public-API parking experiment remains separate until Phase 3 integrates the lifecycle with the coordinator.

This is cooperative protection, not a sandbox. An uncoordinated CLI, arbitrary extension, direct file write, or retained background subprocess can bypass it. Configuration and extension audits are therefore part of deployment, not optional security claims.
