# MCP OAuth callbacks shared by every process on the machine

## Identity

- Workday: 2026-11-25
- Session: `ses_dea603fe9ffe5q6cdf0LWRqu4t`
- Agent/platform: opencode (anthropic/claude-opus-5-5) / macOS (The-Destroyer-Sawyer)
- Repository: `vibeterm/opencode` (GitLab) and `Nowaker/opencode` (GitHub)
- Integration branch: `dev-nowaker`
- Development branch: `oauth-callback-relay` (worktree `../opencode-wt-oauth-relay`)
- Upstream base: `006d837c50` (v1.19.5)
- Source result commit: `74e6e381562`
- Forklog commit: this file's introducing commit

## User requests

> I recently pulled in some changes for the shared repos like Portal and opencode-tools. Then I noticed some issues with my MCPs, maybe related, maybe not. But can you check at this Oauth for dh-panel context mcp

> investigate this further. run some tests and lets come up with a valid solution that will work for the shared repo and all users

Answer to the landing question: "Land fix + vibeterm-api".

## Goals

- dh-panel-context's sign-in, and every MCP sign-in, finish regardless of which opencode process holds `127.0.0.1:19876`.

## Constraints and non-goals

- Keep the redirect URI, so no authorization-server registration changes.
- Open no real browser and leave the user's credentials untouched while testing; installed-binary checks ran in an isolated HOME/XDG.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `vibeterm/opencode`, `Nowaker/opencode` | `dev-nowaker` | `bafac0a4ff7` | `74e6e381562` | fast-forward, pushed to both |
| `Nowaker/opencode-tools` | `master` | `72e3108c3` | `ba272b4ee` | claim `0d870b9fd`, then the vibeterm-api change |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [MCP OAuth callbacks shared by every process on the machine](../features/2026-11-25-mcp-oauth-shared-callback.md) | new | `test/mcp/oauth-callback-processes.test.ts`, installed-binary run below |
| [Pending PKCE isolation and Portal-owned MCP callbacks](../README.md#portal-owned-mcp-oauth-callbacks) | preserved | `test/mcp/` 117 pass including the external-callback suites |

## Other delivered work

- Live diagnosis: PID 32591, the Vibeterm warm spare `warm:ndn` with no session, held 19876 and rejected the state of a sign-in another process started. That spare was retired through `retireWarmWindow`, which freed the port.
- opencode-tools `ba272b4ee`: vibeterm-api's local listener joins the same registry. It forwards a tab's state while it holds the port and registers its own terminal flows so a tab holding the port forwards them. It takes the port over when a flow starts, or every second once the holder has exited. vibeterm-api was restarted on the Mac (PID 70819, healthy).

## Verification

- Before the fix (`bafac0a4ff7`): 4/4 new process tests fail, the first with exactly the reported page.
- After: 6/6 process tests; `test/mcp/` plus three MCP HttpApi suites 117 pass / 0 fail; `bun typecheck` and `bun turbo typecheck` (30/30) clean; prettier clean; no new oxlint warnings.
- Installed `vt-614`: two real `opencode mcp auth` processes. `alpha` held `127.0.0.1:18793` and kept waiting. `beta`'s browser received 200 "Authorization successful" through `alpha`, and `beta` stored its token. A waiting CLI lingers after SIGTERM equally on `vt-612` and `vt-614`, so that behavior predates this change.

## Build and install

- Build command: `bash .vibeterm/build.sh` from the primary checkout; v2 migration guard gate PASSED at 2026-11-26T02:48:02Z.
- Installed artifact: `1.19.5-vt-614-006d837c50` at `~/projects/opencode-build/bin/opencode`; previous archived as `opencode.prev-1795661725`.
- Running services: tabs pick up `vt-614` as they restart; no tab was restarted by this session.

## Commit provenance

- `74e6e381562` - fix and process tests
- Required trailer: `AI-Session-ID: ses_dea603fe9ffe5q6cdf0LWRqu4t`

## Unknowns and blocked verification

- Which request made the warm spare bind 19876 is not in the logs. vibeterm-api passes a desktop-mode `POST /mcp/:name/auth` to any one tab, warm spares included (opencode-tools `_lib/vibeterm-api/mcp-live.ts`), and that path bound the port with nothing awaiting it. This is the likely cause, but it is unproven.
- No sign-in against a real authorization server was run after the build; the user's own dh-panel-context retry is that check.
