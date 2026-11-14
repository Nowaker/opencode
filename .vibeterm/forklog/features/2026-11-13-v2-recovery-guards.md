# Atomic native v2 recovery guards

## Identity

- Status: active. Source integration: `v2-nowaker`; provenance: `dev-nowaker`. Development branch: `session-guards`.
- First source commit: `7f45073b8f`; contract documentation: `f22a3cca010ec09e59fce4aa3ff7b7f1fedf7ca9`.
- Upstream base when introduced: `v2.2.7`, `fedc6f208aa2bd54c1019227214568083f6380ad`. Last independent live-upstream comparison: TBD.

## Original request and goals

The exact original request is not recovered in this record. W14's reconstructed requirement is an atomic owner-issued observation for unchanged-idle recovery admission and compare-and-interrupt, so an old watcher cannot overwrite newer input or stop a replacement execution. The [delivery session](../sessions/2026-11-13-v2-plugin-controls.md#atomic-recovery-guards) owns the agreed contract and evidence.

## Rationale and constraints

- A suspended timestamp alone cannot identify a unique local execution. Checking history before a separate write also leaves an admission race; observing only pending input misses admit-then-cancel.
- Reuse native Execution identity, immediate database transactions, aggregate locking, projected KV and native inbox reconciliation. No migration, parallel execution registry, remote cancellation lease or watcher policy is introduced.
- Guard omission preserves existing APIs. The native atomic-refusal guarantee excludes arbitrary prompt-hook/attachment preparation side effects outside admission.

## Changes and stable seams

- `7f45073b8f`, 2026-11-13: project a monotonic input revision and observe native local ownership plus message watermarks. Stable seams: `packages/core/src/session/{input-revision,recovery,projector,execution}.ts`, `packages/schema/src/session-recovery.ts`.
- `7f45073b8f`, 2026-11-13: compare stop ownership and durable predicates atomically; protect accepted continuation from caller cancellation. Stable seams: `Session.interrupt`, public `packages/core/src/session.ts`, `SessionRunCoordinator`, `Execution.Started` identity.
- `7f45073b8f`, 2026-11-13: check unchanged idle inside existing prepared prompt publication, after exact retry reconciliation. Stable seams: `SessionInbox`, native prompt admission, canonical guarded errors and HTTP routes.
- `f22a3cca01`, 2026-11-13: document raw snapshots, typed refusal fields, nullable legacy observation and process-local limits. Stable seams: Promise/Effect plugin session contracts and generated clients.

## API contract

- `ctx.session.recovery({ sessionID })` returns `{ assistantMessageID, idleMessageID, throughSeq, executionID, executionClaim, localActive, inputRevision, pendingInput }`; HTTP `GET /api/experimental/session/:sessionID/recovery` wraps it as `{ data }`. IDs/claim/revision can be null; `throughSeq` is the latest projected message sequence or -1. Rename/metadata-only events do not change it.
- Local Execution reserves one unique ID before starting and reuses it as the existing Started event ID through stop/settlement. Transactional `inputRevision: { seq, eventID } | null` advances on create/fork and inbox enqueue/deliver/cancel/delivery-change/revert commit. Legacy null means untracked; it does not assert no historical input.
- Interrupt's `experimental.expected` requires `executionID` and `inputRevision`, with optional `messageID` and `executionClaim` (explicit null supported). Refusal is typed `Session.InterruptGuardError`, HTTP 409, `{ accepted: false, interrupted: false, reason: "message-changed" | "execution-changed" | "input-changed", sessionID }`. It does not resume or stop newer work. Bodyless interrupt and `{}` remain valid; resume stays a query parameter.
- Prompt's `experimental.expected` requires `idleMessageID`, `throughSeq` and `inputRevision`. Admission requires no local execution, durable claim, pending input or staged revert. Typed `Session.PromptGuardError`, HTTP 409, returns `{ accepted: false, reason: "not-idle" | "input-changed" | "idle-changed", sessionID }`; refusal creates no native admission/event/ID/wake and deletes no revert. Exact pending/promoted retries reconcile first and keep the first admitted payload.
- Capabilities are `sessionCompareAndInterrupt` and `sessionConditionalPrompt`, on app and info. Ownership remains process-local; older/bypassing writers without revision participation are outside the guarantee.

## Verification and timeline

- 2026-11-13 [W1 delivery](../sessions/2026-11-13-v2-plugin-controls.md#atomic-recovery-guards), [ses_e3832b1b0ffe6q98OeUzhgqhjQ](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ), closes the source review after a public interrupt cancellation regression: the unmasked facade fails two cases, the full public uninterruptible wrapper passes them without moving cleanup under the transaction.
- Worker gate: 154 focused tests, six package typechecks, diagnostics on all 40 changed files, six behavioral owner mutations red/restored and repeated no-op generation. Parent combined gate after correction: 188 tests/679 assertions; workspace checks 34/34, including after rebasing above W4's published source. The linked session retains commands/log paths and distinguishes source-only review from executed checks.
- Both hosts independently build exact f22 source as vt-30 with 12 pass/0 fail/0 skip. Each actual installed guard driver passes four scenarios over native RPC/HTTP and a loopback provider: unchanged idle across metadata, first-ID reconciliation, admit-then-cancel stale refusal, matching stop with parked input, and stale owner refusal while replacement execution finishes.

## Current maintenance notes

- Preserve transaction/aggregate boundaries, retry-before-guard ordering and public interrupt cancellation masking. Do not await execution cleanup or Bus publication inside the atomic comparison transaction.
- Run native recovery, interrupt-mask, execution/coordinator/prompt, plugin and HTTP recovery tests with isolated storage. Regenerate canonical clients twice after Schema/Protocol edits, retaining all sibling capabilities.
