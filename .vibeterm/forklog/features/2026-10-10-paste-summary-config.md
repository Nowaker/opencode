# Configure when a paste is summarized and what its placeholder says

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `prompt-paste-undo` (fork); `paste-summary-config` (upstream PR head `adefc0be51` on `v1` `dfb56f76c7`)
- First local commit: `1db2260dee`
- Current local commit(s): `1db2260dee`, `460027c707` (adds `pasteLabel`)
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Upstream: PR [#54458](https://github.com/anomalyco/opencode/pull/54458) against `v1`; comment on [#15767](https://github.com/anomalyco/opencode/issues/15767#issuecomment-6105872750). **Needs a v2 port later.**

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 28), quoting the user:

> allow [ pasted content ~5 lines ] to have lines/bytes/excerpts configurable

## Goals

- `prompt.paste_summary` in `tui.json`: `lines` (default 3), `characters` (default 150), `format` (default `[Pasted ~{lines} lines]`, tokens `{lines}`, `{characters}`, `{bytes}`, `{excerpt}`), `excerpt` (default 30). Defaults reproduce upstream exactly.

## Non-goals

- The global toggle (**Disable paste summary**) is unchanged.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `1db2260dee` | 2026-10-10 | thresholds and placeholder format | `PasteSummary`, `PasteSummaryDefaults`, `Prompt.paste_summary` in `packages/tui/src/config/index.tsx`; `pasteSummary` in `packages/tui/src/prompt/paste.ts`; `pasteInputText` in `component/prompt/index.tsx`; `test/prompt/paste.test.ts`; tui.mdx "Paste summary" |

## Verification

- `test/prompt/paste.test.ts` 5 pass; `test/config.test.tsx` schema case.

## Timeline

- 2026-10-10 [`ses_ed7634c31ffeH84yR0S99Ty8Nd`](../sessions/2026-10-10-prompt-paste-undo.md) - introduced. Evidence: commit above.
