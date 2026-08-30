# Compaction decision tracing

## Identity

- Status: active
- Integration branch: `master-nowaker`
- Development branch(es): direct work on `master-nowaker`
- First local commit: `dd04c4f1b`
- Current local commit(s): `dd04c4f1b`
- Upstream base when introduced: `a85d8d23aa` (`v1.18.5`)
- Last checked against upstream: `10765ff2a` (`v1.18.25`)

## Original request

TBD - no surviving original prompt specific to this change was found. The
session's final report preserves the implementation request as a previously
dirty OpenCode source change.

## Goals

- Make compaction task boundaries, usable-budget inputs, overflow decisions,
  and automatic-compaction creation visible in a durable trace.
- Diagnose running source builds without taking over their process or session.

## Non-goals

- Do not change the compaction decision or token-budget formula.

## Rationale and constraints

- Overflow failures otherwise expose the result without the inputs that caused
  it, which makes threshold and context-limit regressions difficult to prove.
- Tracing writes outside the user transcript so it cannot consume model context
  or change the prompt.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `dd04c4f1b` | 2026-06-16 | Trace compaction boundaries and overflow decisions | `compactionDebug` calls in `session/prompt.ts` |

## Verification

- The introducing commit records the trace destination as
  `~/.local/share/opencode/log/compaction-debug.log`.
- 2026-08-29 semantic gate: prompt and compaction tests pass inside
  388 pass / 3 skip / 0 fail.

## Session ledger

- 2026-06-16 `ses_151d2dd79ffeEX3zcZ4QxoVsGF` - commit compaction overflow
  decision tracing. Confirmed by the final transcript statement, `Committed the
  previously dirty opencode source change as session: trace compaction overflow
  decisions.`, and commit `dd04c4f1b`. CWD: `~/projekty/nowaker/opencode-tools`;
  platform: OpenCode; development branch: `master-nowaker`.

## Current maintenance notes

- Keep trace writes observational; do not move them into decision control flow.
- Recheck every overflow call site when upstream changes compaction budgeting.

## Supersession or removal

- Not applicable; status is active.
