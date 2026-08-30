# Upstream integration

## Identity

- Status: active
- Integration branch: `master-nowaker`
- Development branch(es): direct merges on `master-nowaker`
- First local commit: `0ac3fad6f`
- Current local commit(s): `0ac3fad6f`, `421923926`, `8617f1049`,
  `9d78ca8c6`, `0a12138e8`, `ca4200381`
- Upstream base when introduced: `github/dev`
- Last checked against upstream: `10765ff2a` (`v1.18.25`)

## Original request

> our usual drill:
> - bump upstream opencode and re-integrate like previously.
>   master-nowaker can be pushed.

Earlier merge requests are recovered through their own session-ledger rows.

## Goals

- Keep `master-nowaker` current with `github/dev` without dropping local
  runtime, provider, command, diagnostics, retry, or TUI behavior.
- Rebuild and install through the host's canonical inode-swap script.
- Leave protected running OpenCode services untouched during installation.

## Non-goals

- Do not update or rebuild Meridian as part of the OpenCode/OMO drill.
- Do not restart protected OpenCode services.

## Rationale and constraints

- A conflict-free merge does not prove that a stable local seam still behaves
  correctly. Every bump therefore requires a semantic custom-diff audit.
- Generated SDK output is regenerated from the merged schemas instead of
  conflict-resolved by hand.
- The retry-header cap is reversed before the merge and reapplied afterward.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `0ac3fad6f` | 2026-07-28 | Merge `github/dev` | complete custom diff |
| `421923926` | 2026-08-04 | Merge upstream `v1.18.13` | complete custom diff |
| `8617f1049` | 2026-08-11 | Merge upstream `v1.18.16` | complete custom diff |
| `9d78ca8c6` | 2026-08-15 | Merge upstream `v1.18.18` | complete custom diff |
| `0a12138e8` | 2026-08-29 | Merge upstream `v1.18.25` | complete custom diff |
| `ca4200381` | 2026-08-29 | Join patch-equivalent remote history | ancestry only; tree unchanged |

## Verification

- 2026-08-29: 388 pass / 3 skip / 0 fail across the semantic gate;
  `packages/opencode` and `packages/tui` typechecks exit 0.
- The JavaScript SDK and client generators leave no second-run diff.
- Canonical build installs `1.18.26` on inode `49950833`, with the retry marker
  present and protected service PIDs `294094` and `293902` unchanged.
- PTY QA observes `--version`, `--help`, and a bad flag exiting 1.

## Session ledger

- 2026-07-28 no verified local coding-agent session found - merge `github/dev`
  in `0ac3fad6f`. Exact hash, subject, date-window, likely-workdir, and subagent
  searches across every indexed local agent platform returned no match.
- 2026-08-04 no verified local coding-agent session found - merge upstream
  `v1.18.13` in `421923926`; the same broad search found no direct transcript.
- 2026-08-11 no verified local coding-agent session found - merge upstream
  `v1.18.16` in `8617f1049`; exact version and merge terms returned no match.
- 2026-08-15 no verified local coding-agent session found - merge upstream
  `v1.18.18` in `9d78ca8c6`; exact version and merge terms returned no match.
- 2026-08-29 `ses_166c2c2b5ffe5Fr8aJwwuDgWT3` - merge upstream
  `v1.18.25`, preserve every seam, rebuild, reconcile the patch-equivalent
  remote fork history in `ca4200381`, audit OMO, and create the forklog.
  Inferred with high confidence from current-session continuity, merge
  `0a12138e8`, and the original bump request above.

## Current maintenance notes

- Treat `.vibeterm/forklog/` as the custom-seam inventory before every merge.
- Keep forklog commits unsquashed and rebased above the current source head.
- Remote `master-nowaker` may contain patch-equivalent custom commits under
  different hashes; prove stable patch-ID equivalence before a lease-protected
  history update.

## Supersession or removal

- Not applicable; status is active.
