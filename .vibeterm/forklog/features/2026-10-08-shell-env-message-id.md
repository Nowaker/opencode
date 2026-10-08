# Pass messageID to the shell.env hook

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `shell-env-message-id`; upstream `shell-env-message`
- First local commit: `6c3472125a`
- Current local commit(s): `6c3472125a`
- Upstream base when introduced: `907b3bc518` (upstream `dev`, contains `v1.18.34`)
- Last checked against upstream: `388406238b` (upstream `dev`)
- Upstream PR: [anomalyco/opencode#54032](https://github.com/anomalyco/opencode/pull/54032)
  (branch `shell-env-message`, `b005b94a86`, no AI trailers)

## Original request

From coordinator `ses_ef8235798ffejGr4sa22eXmVNv`'s brief:

> The sudo backend needs, in every shell tool call's environment, the
> AUTHORITATIVE ids of that call. It validates the message against the session
> in the DB and never falls back to "latest message".

> add `messageID` to the `shell.env` input everywhere a message exists: the
> shell tool (ctx.messageID) and the `!` path.

## Goals

- `shell.env` input carries `messageID` beside `sessionID` and `callID` for the
  shell tool and the `!` command, so a plugin can export the exact tool call's
  ids to the command.

## Non-goals

- The PTY path, which has no session or message: it still passes `cwd` only.
- `agent` in the hook input (asked for in upstream #21767, not needed here).

## Rationale and constraints

- Without the message id a consumer (the Vibeterm sudo prompt) could only guess
  "latest message", which is wrong when turns overlap.
- `shell.env` is not part of the HTTP API, so no SDK or client regeneration.
- v2 has no equivalent: its bash tool does not call `shell.env` yet
  (`packages/core/src/tool/bash.ts` TODO, upstream #41117).

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `6c3472125a` | 2026-10-08 | `messageID` in `shell.env` input; plugin type; docs | `ShellTool.shellEnv` (`src/tool/shell.ts`), `SessionPrompt.shellImpl` `shell.env` trigger (`src/session/prompt.ts`), `Hooks["shell.env"]` (`packages/plugin/src/index.ts`), `plugins.mdx` "Inject environment variables" |

## Verification

- `bun test --timeout 180000 test/tool/shell.test.ts -t shell.env` - 1 pass
  (fork and upstream-based branch).
- `bun test --timeout 180000 test/session/prompt.test.ts -t "shell (passes|captures|completes)"` -
  4 pass; on the upstream branch `-t "shell passes"` 1 pass.
- `bun typecheck` in `packages/opencode` and `packages/plugin` - clean.
- opencode-tools `opencode-vibeterm-spawn-plugin/tests/shell-env.runtime.test.ts`
  against installed `1.18.34-vt-187-907b3bc518` - 1 pass: root and subagent bash
  calls see their own session, message and call ids.

## Timeline

- 2026-10-08 [`ses_ee26f677effe6fzY9wzepyBf13`](../sessions/2026-10-08-shell-env-message-id.md) -
  initial build and upstream PR #54032. Evidence: `6c3472125a`, tests above.

## Current maintenance notes

- Consumer: opencode-tools spawn plugin `shell.env` hook
  (`opencode-vibeterm-spawn-plugin/src/shell-env.ts`) exports
  `VIBETERM_MESSAGE_ID`; it is empty on a build without this change.
- Keep PR #54032's branch and body current when this changes.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree; drop this feature if
  upstream passes `messageID` itself.
- Run the two focused tests above and `bun typecheck` in `packages/opencode`.
- Link a new timeline row to the current session record.
