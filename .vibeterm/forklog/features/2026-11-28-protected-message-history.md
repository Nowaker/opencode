# Message-only undo/redo for Portal (protected message history)

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `protected-message-history` (reviewed on `b37f07343f`), `protected-message-history-rebased`
- First local commit: `23c5913d6d`
- Current local commit(s): `89b91a788d`, `d5dd59fb97`, `760c2f9421`, `04ee6d672f`; merge `c638a0543e`
- Upstream base when introduced: `006d837c50` (v1.19.5)
- Last checked against upstream: `006d837c50`

## Original request

TBD - Portal's approved /undo and /redo (Portal parent ses_e22346b8effeLgWnxER51U90Zf, Vibeterm backend ses_de02b387dffe5CV3Su6RR2xzfa). Assigned by ses_ef8235798ffejGr4sa22eXmVNv; built by ses_de01f2467ffeVY9d7r4hck5sJf.

## Goals

- A protected, message-only history boundary in `session.metadata.messageHistory` = `{version:1, sessionID, revision, generation, boundaryMessageID, boundaryCreatedAt, historyFingerprint, conflict?}`; the final redo persists a null tombstone; `conflict` is sticky and fails closed.
- Optional plugin input `PluginInput.messageHistory {version:1, execute(request, isHumanTurn)}`: read, or `{action:'undo'|'redo', expectedRevision}` with an opaque expiring owner/state compare-and-set inside a short owner-exclusive immediate transaction. The human-turn predicate comes from Vibeterm.
- While a cut exists, continuations and native cleanup get 409 `protected-message-history`; native session deletion revalidates the whole forest inside its write transaction; metadata writers take the publication lock before SQLite.
- Message IDs outside `^msg_[A-Za-z0-9]+$` (max 256) are refused before the classifier or CAS.

## Non-goals

- Native `session.revert`, snapshots, file changes or transcript mutation. Native v2 snapshot revert is not used.

## Rationale and constraints

- Stored apart from native revert so an older binary or another host never reads the cut as a deletable revert.
- Rebased onto `c3c660b9a7`: create() strips incoming `messageHistory` before `withoutRoutingJournals`; `setMetadata` preserves both `messageHistory` and `cybersecPreservation`. The SDK baseline `1cc3f77d3c` was dropped (same tree as `78aca81723`).

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `89b91a788d` | 2026-11-27 | Docs: Portal undo versus native revert | `web/src/content/docs/tui.mdx` |
| `d5dd59fb97` | 2026-11-27 | Protected history in the v1 owner | `session/message-history*.ts`, `plugin/src/message-history.ts`, `session/prompt.ts` |
| `760c2f9421` | 2026-11-28 | Serialize with native deletion and lock order | `session/session.ts`, `control-plane/workspace.ts` |
| `04ee6d672f` | 2026-11-28 | Refuse history Portal cannot project | `session/message-history.ts` |

## Verification

- hania-arch, MemoryMax 6G, rebased tip: 95 tests, 0 failures (history 94 assertions, raw ID 17, Session 11, lock 1, native revert 15, pause 48, admission 5, cybersec preservation 7, wire 2, HTTP 4); opencode/plugin/client/TUI typechecks pass; SDK regeneration byte-identical.
- Paired with Vibeterm `3f579fec239`: 178 tests / 654 assertions including both HTTP-to-owner cases (ses_de02b387dffe). Reviewed by ses_ef8235798ffejGr4sa22eXmVNv.
