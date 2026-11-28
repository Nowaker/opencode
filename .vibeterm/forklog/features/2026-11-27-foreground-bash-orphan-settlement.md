# Foreground Bash settles when its child is gone or never started

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tool-orphan-guard`
- First local commit: `ac69c6c3f3`
- Current local commit(s): `ac69c6c3f3`; merge `f3b9a310e2`
- Upstream base when introduced: `006d837c50` (v1.19.5, from the `vt-644` build stamp)
- Last checked against upstream: `006d837c50`

## Original request

TBD - the report came from the Vibeterm setup coordinator (ses_f018f02fdffeRMgHyFr1qOP8YU, 2026-11-27): tool calls stayed `running` under desktop load after their process had exited or never ran, and only an abort plus re-prompt recovered the session.

## Goals

- A foreground `bash` call whose spawn failed, was never acknowledged, or whose exact child is gone without a completion receipt ends with a tool error at its deadline, so the turn continues.
- A real exit still wins over the deadline, with its bounded output drain.

## Non-goals

- Explicit background jobs and live timeout promotion are unchanged.
- No direct database repair of stuck parts; the guard lives where the shell handle and registry identity are owned.

## Rationale and constraints

- The reported desktop hangs ran on vt-627 (pre snapshot-wait bound); the vt-644 reproduction showed separate false successes on spawn failure and lost exit receipts.
- Initial preview persistence blocked exit observation; it is forked so a real exit is never mistaken for `missing-exit`.
- A cancellation receipt fences the job but does not prove reaping when a native callback is wedged.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `ac69c6c3f3` | 2026-11-27 | Settle foreground Bash without a live child; startup failure as tool error | `ShellTool` timeout path, `tool/shell/foreground.ts` |

## Verification

- hania-arch, reported by ses_de3bc20f4ffef42eT1d1dK6NI0: vt-644 red (three false successes; prompt persisted `completed` on EACCES), then 7 focused / 84 broader pass, typecheck, native Linux build. Real `BEGIN IMMEDIATE` contention on the terminal part write delayed but committed exactly one terminal event.
- Coordinator review (ses_ef8235798ffejGr4sa22eXmVNv) of the `shell.ts` and `foreground.ts` diff.

## Timeline

| Workday | Event |
|---|---|
| 2026-11-27 | Reported, classified, fixed and merged as `f3b9a310e2` |
