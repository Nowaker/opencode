# Native tool commands

## Identity

- Status: active
- Integration branch: `master-nowaker`
- Development branch(es): `feat/native-slash-commands`,
  `feat/native-tool-commands`, `feat/tool-command-prefix`,
  `feat/friendly-tool-args`
- First local commit: `f39c4abf8`
- Current local commit(s): `f39c4abf8`, `32457b6d1`, `615d27bad`,
  `dd5bc77d1`, `a209a8289`, `daab8893a`
- Upstream base when introduced: `aefaf140c1` (`v1.18.13`)
- Last checked against upstream: `10765ff2a` (`v1.18.25`)

## Original request

> native commands B: native:true opencode patch

> native slash commands: run a tool from /command with no LLM turn

The first prompt belongs to the source-worktree session that introduced the
`native` command flag. The second belongs to the longer orchestration session
that regenerated the SDK and extended native commands to the whole tool
catalog.

## Goals

- Let a slash command persist its result without starting an LLM turn.
- Expose built-in and MCP tools under generated `/tool-*` commands.
- Accept arguments in forms a person can type while retaining JSON support.
- Keep schemas and generated SDK types aligned with the runtime command model.

## Non-goals

- Do not auto-register a duplicate for a tool already exposed by a plugin or
  user-defined command.
- Do not apply model/agent permission filtering to an explicit human command.

## Rationale and constraints

- `native: true` reuses the existing no-reply persistence path; it does not
  duplicate prompt storage.
- MCP tools are resolved separately from `ToolRegistry` and return a different
  result shape, so generated commands must support both catalogs.
- Argument meaning comes from the tool's JSON Schema, never text heuristics.
- Ambiguous positional input and malformed leading JSON are refused.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `f39c4abf8` | 2026-08-08 | Add `native` commands | command schemas and `SessionPrompt.command` |
| `32457b6d1` | 2026-08-08 | Regenerate v2 SDK | generated command/global-memory types |
| `615d27bad` | 2026-08-11 | Execute any built-in or MCP tool | tool catalog resolution and execution |
| `dd5bc77d1` | 2026-08-12 | Put generated commands under `/tool-` | tool-command naming and dedup |
| `a209a8289` | 2026-08-13 | Parse schema-driven human arguments | tool argument parser and schema lookup |
| `daab8893a` | 2026-08-15 | Regenerate missing tool-command SDK fields | generated v2 command type |

## Verification

- 2026-08-29 semantic gate includes `tool-command.test.ts` and passes inside
  388 pass / 3 skip / 0 fail.
- `packages/opencode` typecheck exits 0.
- Both generators leave no second-run diff after the `v1.18.25` merge.

## Session ledger

- 2026-08-08 `ses_01bbb0b5affeZ1mADldfa0VF1D` - introduce native slash
  commands on `feat/native-slash-commands`. Confirmed by the exact prompt above,
  source checkout, branch containment, and commit `f39c4abf8`.
- 2026-08-08 `ses_01bd110d8ffes7Zs71QSnn0HHJ` - drive the native-command
  workstream from `opencode-tools` and regenerate the paired SDK in
  `32457b6d1`. Inferred with high confidence from the exact prompt, activity
  window, and branch containment.
- 2026-08-11 `ses_01bd110d8ffes7Zs71QSnn0HHJ` - resolve and execute built-in
  and MCP tools on `feat/native-tool-commands`. Inferred with high confidence
  from the session's tool-registry subagent evidence and `615d27bad`.
- 2026-08-12 `ses_01bd110d8ffes7Zs71QSnn0HHJ` - move generated commands under
  `/tool-` on `feat/tool-command-prefix`. Inferred with high confidence from
  `/tool-` transcript matches and commit `dd5bc77d1`.
- 2026-08-13 `ses_01bd110d8ffes7Zs71QSnn0HHJ` - add schema-driven friendly
  arguments on `feat/friendly-tool-args`. Inferred with high confidence from
  the same continuing session, its activity window, and commit `a209a8289`.
- 2026-08-15 no verified local coding-agent session found - regenerate the
  missing SDK fields in `daab8893a`. Exact hash, SDK, version, date-window,
  likely-workdir, and subagent searches across all indexed platforms returned
  no direct transcript match.

## Current maintenance notes

- Keep command naming and argument parsing mirrored with
  `~/projekty/nowaker/opencode-tools/_lib/native-command/`.
- Resolve a tool before parsing its arguments so parameter names and types are
  available.
- Regenerate the v2 SDK after command schema changes.

## Supersession or removal

- Not applicable; status is active.
