# TUI transcript text clicks

## Identity

- Workday: 2026-11-21
- Session: [`ses_dfed6cbf8ffeMc348W81QcJloM`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_dfed6cbf8ffeMc348W81QcJloM)
- Agent/platform: OpenCode `openai/gpt-6.2-sol` / Linux
- Repository: `~/projekty/webapps/opencode`
- Forklog branch: `master-nowaker`

## Request

> Own OpenCode fork portion of user's request: literal ile:///Users/nowaker/Downloads/t13-nextcloud-mac-restore.md should be clickable in live Vibeterm OpenCode chat (user, assistant markdown, tool text wherever link clicks exist). Read repo rules, both deployed engine lines as applicable; only work in own managed worktree, no touching other dirty edits.

The parent session owns the Vibeterm consumer and explicitly selected synchronous `api.click.onText(handler)` over modifying terminal transport. No upstream PR was requested.

## Branch and upstream movement

| Source integration branch | Worktree branch | Before | After | Action |
|---|---|---|---|---|
| `dev-nowaker` | `chat-text-click-v1` | `2404423cda` | `c2e3ac71e6` | Fast-forwarded and pushed to GitLab and GitHub |
| `v2-nowaker` | `chat-text-click-v2` | `f16dced8fc` | `2c000ae41b` | Fast-forwarded and pushed to GitLab and GitHub |

## Feature touched

- [TUI transcript text clicks](../features/2026-11-21-tui-transcript-text-clicks.md) - expose display text, cell column, and explicit hyperlink target to loaded plugins before normal transcript actions.

## Verification

- From `packages/tui`, render-and-click regressions: 30/30 on each engine. Removing logical-line recovery makes the wrapped URI test fail on both. Removing native cell checks makes the independently reproduced shifted-row regressions fail.
- v1 nearby ID, user-text and tool-output tests: 20/20. Native v2 ordinary link, group-view and plugin tests: 12/12.
- `bun typecheck` passed for `packages/tui` and `packages/plugin` on both lines and for `packages/opencode` on v1.
- Existing v1 real PTY ID-click regression passed on the before/after binaries; its first run after installation timed out, and that failure did not recur on immediate comparison.

## Build and install

- Desktop v1: `opencode-build/build.sh` from `chat-text-click-v1` installed `1.19.5-vt-586-006d837c50` (inode `49938618`); v2 migration guard passed, the retry-header marker is present, and the previous binary was archived.
- Desktop v2: `opencode-build/build.sh --v2` from `chat-text-click-v2` installed `2.2.7-vt-55-5f76acb125` (inode `49938617`); all 13 native probes passed and the previous binary was archived. An earlier candidate was refused after a transient plugin-path engine exit; rerunning that same candidate passed all 13, and the final install used the unmodified gate.
- Protected services remained inactive and no active TUI tabs were restarted.
- m4max: Tailscale alternated between briefly reachable and offline. Direct tailnet and LAN SSH and a native rollout spawn did not reach the host, so no Mac worktree, binary, or configuration was changed.
