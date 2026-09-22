# Retry-header delay cap

## Identity

- Status: active
- Integration branch: `dev-nowaker` (`master-nowaker` until 2026-09-22)
- Development branch(es): deliberate uncommitted OpenCode divergence;
  canonical patch history on `opencode-tools/master`
- First local commit: `opencode-tools:824532a2b`
- Current local commit(s): `opencode-tools:824532a2b`, `2dfe1da2f`,
  `a88ab4589`, `1f16a2b66`; OpenCode source diff remains uncommitted
- Upstream base when introduced: `aefaf140c1` (`v1.18.13`)
- Last checked against upstream: `2406400f0` (upstream `dev`, contains `v1.18.32`)

## Original request

> Evaluate the upstream delay cap FIRST - the plan's "Do the cheap upstream
> fix FIRST" section. It may dissolve most of the risk, and it changes how big
> the rescuer needs to be. Measure it against a real capped build rather than
> reasoning about it.

## Goals

- Limit a provider-directed retry wait to five minutes by default so an early
  capacity return or credential rotation is detected.
- Preserve upstream's retryability classification and five-attempt ceiling.
- Allow literal header waits through an explicit environment override.

## Non-goals

- Do not make retries unlimited.
- Do not change AI SDK retry behavior; it remains disabled with `maxRetries: 0`.

## Rationale and constraints

- Providers have returned `retry-after` values of eight hours. A literal sleep
  makes every early recovery invisible until the whole wait expires.
- Since upstream `c78986831`, the schedule stops at
  `RETRY_MAX_RETRIES = 5`. The local cap changes delay length, not attempts.
- `OPENCODE_RETRY_MAX_HEADER_DELAY_MS=0` restores upstream's literal wait.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `824532a2b` | 2026-08-06 | Add `RETRY_MAX_HEADER_DELAY` and cap header-derived delays | `session/retry.ts`, `session/retry.test.ts` |
| `2dfe1da2f` | 2026-08-11 | Rebase the cap onto `v1.18.16` and include tests | canonical external patch |
| `a88ab4589` | 2026-08-15 | Rebase onto `v1.18.18` jitter changes | canonical external patch |
| `1f16a2b66` | 2026-08-29 | Refresh blob IDs and hunk offsets for `v1.18.25` | canonical external patch |

The canonical patch is
`~/projekty/nowaker/opencode-tools/docs/opencode-patches/`
`retry-header-delay-cap.patch`. The OpenCode source tree intentionally carries
that exact two-file diff uncommitted.

## Verification

- 2026-08-29 semantic gate: all retry tests pass inside
  388 pass / 3 skip / 0 fail.
- Installed `1.18.26` contains one
  `OPENCODE_RETRY_MAX_HEADER_DELAY_MS` marker.
- Protected service PIDs and start timestamps did not change during the build.
- 2026-09-02: the unchanged canonical patch applies to `v1.18.27` byte for
  byte; both installed `1.18.28` binaries contain one marker.

## Timeline

- 2026-08-06 no verified local coding-agent session found - introduce the cap
  and canonical patch in `opencode-tools:824532a2b`. Searches covered the exact
  original request above, patch symbol, measured `28800` header, commit hash and
  subject, likely workdirs, every indexed platform, and subagents.
- 2026-08-11 no verified local coding-agent session found - rebase the patch
  onto `v1.18.16` in `opencode-tools:2dfe1da2f`; exact hash and subject searches
  across the relevant date window returned no match.
- 2026-08-15 no verified local coding-agent session found - rebase the patch
  onto `v1.18.18` in `opencode-tools:a88ab4589`; exact hash and subject searches
  across the relevant date window returned no match.
- 2026-08-29
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-08-29-upstream-bump-and-forklog.md)
  - reverse the patch, merge
  `v1.18.25`, reapply and test it, then refresh the canonical patch in
  `opencode-tools:1f16a2b66`. Confirmed by current-session continuity and the
  exact byte-for-byte comparison against the dirty source diff.
- 2026-09-02
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-09-02-opencode-omo-refresh.md)
  - reverse the patch, merge `v1.18.27`, then reapply it unchanged on Linux
  and macOS. Evidence: retry tests, bytewise comparison, and both binary marker
  checks pass.
- 2026-09-04
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-04-opencode-omo-refresh.md)
  - reverse the patch, merge `v1.18.28`, and reapply it unchanged on macOS.
  Evidence: 102 focused tests, bytewise comparison, and the binary marker pass.

- 2026-09-08
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-08-opencode-dev-omo-refresh.md)
  - reverse the patch, merge upstream dev `5cd8e68fd`, and reapply it
  unchanged. Upstream left `session/retry.ts` untouched across the range.
  Evidence: 688 focused tests, byte-identical comparison against both canonical
  copies, and one binary marker in the installed build.
- 2026-09-22 [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-22-dev-nowaker-rebuild.md) -
  replayed unchanged onto upstream `dev` `2406400f0` as `dev-nowaker`; tree equals
  the `master-nowaker` + `dev` merge tree. Evidence: that session's gates.

## Current maintenance notes

- Verify the dirty diff matches the canonical patch before every merge.
- Reverse the patch before merging upstream and reapply it afterward.
- For an eight-hour header, upstream waits eight hours per attempt and then
  fails; the local build retries five times over about 25 minutes and then
  fails. Its benefit is detecting an early lift, not running forever.

## Supersession or removal

- Not applicable; status is active.
