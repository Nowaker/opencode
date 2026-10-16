# Prompt history scoped to the session

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `prompt-history-scope` (worktree off `dev-nowaker`);
  upstream branch `history-scope` (`Nowaker/opencode`), off `github/v1`
  `dfb56f76c7`
- First local commit: `59deec6f56`
- Current local commit(s): `59deec6f56`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `dfb56f76c7`
- Upstream: PR [#55902](https://github.com/anomalyco/opencode/pull/55902)
  against `v1`, refs issue #52154. The v2 counterpart is
  [#55261](https://github.com/anomalyco/opencode/pull/55261) by @asamarts
  against `dev`, with the same key and values. **Needs a v2 port later**
  (or adoption of #55261).

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 38), the user
verbatim:

> history up/down in opencode: in session - limit to THIS session only. it
> makes ZERO sense to show prompts that other sessions prompted. config
> override - they can have their shit, vibeterm default (not just here, set to
> enforce by default if vt doesn't have a value for that setting yet - settings
> should flag this clearly as following vt defaults - and AFFECTING user system
> - but without having a value set)

## Goals

- `prompt.history_scope` in tui.json: `global` (default, upstream behaviour) or
  `session`, where up / down in a session walk only that session's prompts.
- Shell-mode (`!`) entries, paste placeholders and cleared drafts come back as
  before.
- The home screen, which has no session yet, keeps walking every session's
  prompts; the prompt that starts a session is recorded with that session.

## Non-goals

- Deriving history from the session's user messages (see rationale).
- Recalling entries written before this change inside a session.

## Rationale and constraints

- Messages lose what history needs: shell commands are stored as tool parts,
  paste placeholders lose their sources, cleared drafts never become messages.
  So `prompt-history.jsonl` entries carry `sessionID` and recall filters at
  read time (`promptHistoryView`); switching the setting needs no migration.
- Retention follows the scope: `global` keeps 50 entries; `session` keeps 50
  per session for the 50 most recently used sessions, so a busy session cannot
  push a quiet one out. A trim rereads the file before rewriting it, so a
  long-open TUI does not drop entries other TUIs appended.
- Vibeterm sets `session` as its default through opencode-tools `7bc57a3d`
  (enforced while the user has no value in Vibeterm settings).

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `59deec6f56` | 2026-10-15 | `prompt.history_scope`; entries tagged with `sessionID`; scope-aware view and retention; docs | `promptHistoryView`, `retainPromptHistory`, `usePromptHistory` `move`/`append` in `packages/tui/src/prompt/history.tsx`; `history.move(..., props.sessionID)` and `history.append(..., sessionID)` in `component/prompt/index.tsx`; `Prompt.history_scope` in `config/index.tsx`; `Prompt history` in `tui.mdx` |

## Verification

Reported by `ses_ebdf069dbffeooZAqUSORaYd5z`; see its
[session record](../sessions/2026-10-15-prompt-history-scope.md).

## Timeline

- 2026-10-15 [`ses_ebdf069dbffeooZAqUSORaYd5z`](../sessions/2026-10-15-prompt-history-scope.md) -
  initial build, upstream PR #55902, vt-304 on both hosts, Vibeterm default
  `session` enforced on both. Evidence: `59deec6f56`; PTY two-process check.

## Current maintenance notes

- The upstream branch carries no AI trailers; the fork commit does.
- If upstream lands #55261 on v2, prefer its implementation on the v2 port; the
  key and values already match.
