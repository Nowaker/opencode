# Native tool commands

## Identity

- Status: active
- Integration branch: `dev-nowaker` (`master-nowaker` until 2026-09-22)
- Development branch(es): `feat/native-slash-commands`,
  `feat/native-tool-commands`, `feat/tool-command-prefix`,
  `feat/friendly-tool-args`, macOS `master-nowaker`
- First local commit: `f39c4abf8`
- Current local commit(s): `f39c4abf8`, `32457b6d1`, `615d27bad`,
  `dd5bc77d1`, `a209a8289`, `daab8893a`, `24326cf48`, `6630dbc2c`
- Upstream base when introduced: `aefaf140c1` (`v1.18.13`)
- Last checked against upstream: `907b3bc518` (upstream `dev`, contains `v1.18.34`)

## Original request

> native commands B: native:true opencode patch

> native slash commands: run a tool from /command with no LLM turn

> i'm telling you that it, and ANY tool, should accept positional arguments for
> required parameters.

The first prompt belongs to the source-worktree session that introduced the
`native` command flag. The second belongs to the longer orchestration session
that extended native commands to the whole tool catalog. The source-worktree
session authored the paired SDK regeneration too. The third drove the macOS
extension imported during this workday.

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
| `24326cf48` | 2026-08-31 | Isolate the native argument parser below the module size ceiling | `command/tool-args.ts`, `command/tool-params.ts` |
| `6630dbc2c` | 2026-08-31 | Bind every required parameter positionally in schema order | `parseToolArguments`, positional command tests |

## Verification

- 2026-08-29 semantic gate includes `tool-command.test.ts` and passes inside
  388 pass / 3 skip / 0 fail.
- `packages/opencode` typecheck exits 0.
- Both generators leave no second-run diff after the `v1.18.27` merge.
- 2026-09-02: the OpenCode command coverage passes in the 339-test focused
  gate; the shared native-command suite passes 385 tests.

## Timeline

- 2026-10-06 [`ses_eeda1d251ffel81U5Y42j4kb33`](../sessions/fork-audit.md) -
  add real dispatch/persistence/no-model and ordinary-command control coverage;
  exact new tests and behavioral red/green evidence are in the linked inventory.

- 2026-08-08 `ses_01bbb0b5affeZ1mADldfa0VF1D` - introduce native slash
  commands on `feat/native-slash-commands` and author the paired SDK
  regeneration in `32457b6d1`. Confirmed by the exact prompt above, source
  checkout, branch containment, `f39c4abf8`, and the originating session's
  2026-10-06 read-only provenance report.
- 2026-08-08 `ses_01bd110d8ffes7Zs71QSnn0HHJ` - drive the native-command
  workstream from `opencode-tools` and spawn the source-worktree author.
  The SDK commit is attributed to the spawned session above, not to this
  orchestrator; the author's 2026-10-06 report resolves the earlier inference.
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
- 2026-08-29
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-08-29-upstream-bump-and-forklog.md)
  - preserve native and `/tool-*` commands through `v1.18.25` and regenerate
  both SDK surfaces. Evidence: command tests and typecheck pass.
- 2026-08-31 `ses_faf0eb9eeffetWvwBHm3DEkcse` - accept positional values for
  every required parameter, skip parameters already supplied by name, and let
  the final positional value consume remaining text. Evidence: original macOS
  commits `a544c70d8` and `97940fdbe`, 42 fork tests, and installed-TUI QA.
- 2026-09-02
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-09-02-opencode-omo-refresh.md)
  - rebase the macOS work as `24326cf48` and `6630dbc2c`, preserve it through
  the `v1.18.27` integration, and build it for both hosts. Evidence: command
  tests, 385 shared tests, typecheck, and generator no-op checks pass.
- 2026-09-04
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-04-opencode-omo-refresh.md)
  - preserve native builtin and MCP tool commands through `v1.18.28`.
  Evidence: 102 focused tests, the full package suite, and typecheck pass.

- 2026-09-08
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-08-opencode-dev-omo-refresh.md)
  - preserve native builtin and MCP tool commands through upstream dev
  `5cd8e68fd`. Evidence: 45 command and message-shape tests plus typecheck pass.
- 2026-09-22 [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-22-dev-nowaker-rebuild.md) -
  replayed unchanged onto upstream `dev` `2406400f0` as `dev-nowaker`; tree equals
  the `master-nowaker` + `dev` merge tree. Evidence: that session's gates.
- 2026-09-30 [`ses_f0f108c6dffeMymgpAsLy9LESM`](../sessions/2026-09-30-upstream-1.18.33.md) -
  rebased unchanged onto upstream `dev`
  `2fa3363c92` (contains `v1.18.33`). Evidence: that session's gates.
- 2026-10-04 [`ses_ef81db9cdffe5vRz7Y2HqCmvNs`](../sessions/2026-10-04-upstream-1.18.34.md) -
  rebased unchanged onto upstream `dev`
  `907b3bc518` (contains `v1.18.34`). Evidence: that session's gates.
- 2026-10-06 [`ses_eeda1d251ffel81U5Y42j4kb33`](../sessions/fork-audit.md) -
  reconcile the originating author's report. `f39c4abf8` and `08cc0c56a4`
  have patch-id `aa40c175abf0e2c847d8a691cda0487f54fbd590`; `32457b6d1`
  and `2c566d1c67` have patch-id `a1a1703260f8dc71b877b57eb2f62fdf3659f32e`.
  The feature landed despite changed ancestry. No upstream PR or stranded
  source was found. Parser tests did not cover the native flag's no-model
  command dispatch or native/subtask refusal; current regression audit covers
  those gaps separately in the linked Vibeterm inventory.

## Current maintenance notes

- Keep command naming and argument parsing mirrored with
  `~/projekty/nowaker/opencode-tools/_lib/native-command/`.
- Resolve a tool before parsing its arguments so parameter names and types are
  available.
- Regenerate the v2 SDK after command schema changes.

## Supersession or removal

- Not applicable; status is active.
