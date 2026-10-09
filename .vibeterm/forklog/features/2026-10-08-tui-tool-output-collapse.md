# Choose how much tool output shows before "Click to expand"

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `footer-elements` (worktree off `dev-nowaker`); upstream branch `tui-tool-collapse` (`50803d8078`, stacked on `tui-footer-elements` `09ff703f7a`)
- First local commit: `9799e18401`
- Current local commit(s): `9799e18401`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `663fbd7573` (upstream `dev`)
- Upstream: PR [#54039](https://github.com/anomalyco/opencode/pull/54039), closed by opencode-agent[bot] (v1 takes critical fixes only); kept current for others. Comments on [#40096](https://github.com/anomalyco/opencode/issues/40096#issuecomment-6071873304), [#45538](https://github.com/anomalyco/opencode/issues/45538#issuecomment-6071873910), [#51229](https://github.com/anomalyco/opencode/issues/51229#issuecomment-6071874402). **Needs a v2 port later.**

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` on 2026-10-08, with
the shape the user approved:

> `tool_output: { collapse: { bash: 10, generic: 3, write: "never", edit:
> "never", apply_patch: "never", "<tool name>": N } }` in tui.json.

> default values should match current opencode's rules; mine are set for me

The user's setting: `bash: 0, generic: 0, write: 0, edit: 0, apply_patch: 0`.

## Goals

- `tool_output.collapse` takes a number of lines or `"never"` per group
  (`bash`, `generic`, `write`, `edit`, `apply_patch`) or per tool name; a
  tool name wins over its group.
- `0` collapses a block to its title, a blank line and the hint with the
  footer (`Click to expand · 18:30:50 · 1.2s`); clicking expands it.
- The character cap stays at that many lines' worth.
- `write`, `edit` and `apply_patch` gain an expand toggle.
- Unset keys keep upstream's limits; the default transcript is unchanged.

## Non-goals

- No slash command or keybind for a global collapse switch.
- `execute`'s 4-line error preview is unchanged.

## Rationale and constraints

- Upstream fixes 10 lines for bash and 3 for generic tools and never folds
  write, edit or apply_patch.
- Code and diff blocks are components, not text, so they collapse by rendered
  rows: `ClippedRows` caps the height with `overflow="hidden"` and reports
  through `onSizeChange` whether rows are hidden. A side-by-side diff
  collapses to that many rows. A deleted file in a patch never collapses.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `9799e18401` | 2026-10-08 | `tool_output.collapse`; `0` case; write/edit/apply_patch toggles; tui.mdx `Tool output` section | `ToolOutput`, `ToolOutputCollapseDefaults`, `toolOutputLimit` in `packages/tui/src/config/index.tsx`; `collapseToolOutput` `maxLines === 0` in `util/collapse-tool-output.ts`; `collapseOutput`, `useBlockCollapse`, `ClippedRows` and their use in `GenericTool`, `Shell`, `Write`, `Edit`, `ApplyPatch` in `routes/session/index.tsx`; `test/config.test.tsx`, `test/cli/tui/inline-tool-wrap-snapshot.test.tsx` |

## Verification

- `bun typecheck` in `packages/tui` exit 0; full suite 380 pass, 1 skip,
  0 fail; upstream branch 108 focused tests pass; pre-push hook 30/30.
- Manual surface: isolated `XDG_*`, `OPENCODE_DB`, tool/plugin data dirs,
  tmux socket `oc-footer-qa`, fake OpenAI-compatible provider driving bash,
  write, edit, a plugin tool `vtps` and apply_patch (on model `gpt-qa`):
  - every group at `0`: `$ seq 1 15` / blank / `Click to expand · 18:30:50 ·
    1.2s`; the same for `# Wrote notes.txt`, `← Edit notes.txt`, `# vtps
    [...]` and `# Created .../added.txt`.
  - clicking a collapsed edit expanded it to its diff; a second click
    collapsed it.
  - write, edit and bash at `3`: the first 3 rows, then `Click to expand`.
  - `{}`: a full bash/write/edit/vtps transcript diffed against the build
    without this change is identical once times and IDs are masked.

## Timeline

- 2026-10-08
  [`ses_ee68aab01ffei41gwUGJ5ESj6W`](../sessions/2026-10-08-tui-footer-datetime-format.md)
  - `9799e18401`: build, docs, PR #54039; installed on desktop and m4max;
  every group `0` in both hosts' `tui.json`.

## Current maintenance notes

- Port to v2 once Vibeterm core runs on v2. Keep PR #54039's branch and body
  current when this feature changes (force-with-lease both remotes).
- Host setting: `"tool_output": {"collapse": {"bash": 0, "generic": 0,
  "write": 0, "edit": 0, "apply_patch": 0}}` in `~/.config/opencode/tui.json`
  on desktop and m4max.

### Upstream integration checklist

- Confirm `GenericTool` and `Shell` still use `collapseToolOutput` and that
  `Write`, `Edit` and `ApplyPatch` still render through `BlockTool`.
- Run `test/config.test.tsx`, `test/cli/tui/inline-tool-wrap-snapshot.test.tsx`
  and `bun typecheck` in `packages/tui`.
- With every group `0`, a bash call shows only its command and
  `Click to expand`; with `{}` the transcript matches upstream.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
