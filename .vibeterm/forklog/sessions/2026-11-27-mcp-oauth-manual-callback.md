# MCP manual sign-ins finished by the browser callback

## Identity

- Workday: 2026-11-27
- Session: `ses_dea603fe9ffe5q6cdf0LWRqu4t`
- Agent/platform: opencode (anthropic/claude-opus-5-5) / macOS (The-Destroyer-Sawyer)
- Repository: `vibeterm/opencode` (GitLab) and `Nowaker/opencode` (GitHub)
- Integration branch: `dev-nowaker`
- Development branch: `oauth-manual-callback` (worktree `../opencode-wt-oauth-manual`)
- Upstream base: `006d837c50` (v1.19.5)
- Source result commit: `93993bfd5d`
- Forklog commit: this file's introducing commit

## User requests

> I thought we fixed this? The issue is still happening with dh panel context mcp

Answer to "Where did you start the dh-panel-context sign-in that failed": "Portal MCP modal" and "Portal manual flow".

## Goals

- A dh-panel-context sign-in started from Portal finishes, on either Portal path.

## Constraints and non-goals

- The user's LDAP credentials are entered only by the user; probes stopped at the provider's sign-in form.
- vibeterm-api's scoped owner selection (`opencode-tools` `_lib/vibeterm-api/mcp-external.ts`) is unchanged; see Unknowns.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `vibeterm/opencode`, `Nowaker/opencode` | `dev-nowaker` | `ef1c8cc45b` | `93993bfd5d` | fast-forward, pushed to both |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [MCP OAuth callbacks shared by every process on the machine](../features/2026-11-25-mcp-oauth-shared-callback.md) | extended | `test/mcp/oauth-callback-processes.test.ts`, `test/mcp/oauth-external.test.ts` |
| [Pending PKCE isolation and Portal-owned MCP callbacks](../README.md#portal-owned-mcp-oauth-callbacks) | changed: an external start replaces an unfinished manual flow instead of refusing | `test/mcp/oauth-external.test.ts` |

## Diagnosis

Replayed Portal's requests against this Mac's vibeterm-api with its configured credential (never printed):

- Manual flow: `POST /mcp/dh-panel-context/auth` returned an authorization URL redirecting to `127.0.0.1:19876`, with nothing listening and no registry entry, so the browser could only land on a dead or "Invalid or expired state" page. Pasting a code reached the starting tab and ran the real exchange (provider: "auth_code unknown or expired" for a dummy code).
- Default modal flow: an unscoped external start was refused by the owning tab (HTTP 400, "OAuth start was refused by the owning OpenCode tab") while that tab held a manual flow from the replay above, and succeeded once `DELETE /mcp/dh-panel-context/auth` cleared it. A start scoped to `directory=/Users/mark`, a directory no live tab reports, got HTTP 503 "No matching live MCP owner is available".
- The provider (`panel-context-new.mcp.dev.dh-int.com`) accepted both redirect URIs and served its LDAP sign-in form, carrying the state forward.

## Verification

- Reverting each of the three source changes in turn makes its new tests fail: no manual waiter (2 tests), connect overwriting the sign-in's transport (1), external start refusing a manual flow (1).
- `bun test test/mcp/` plus the three MCP HttpApi suites - 120 pass, 0 fail; `bun typecheck` clean; pre-push `bun turbo typecheck` 30/30 on both pushes.
- Manual surface, installed `vt-634`: a disposable `opencode serve` took a manual `POST /mcp/dh-panel-context/auth`, held `127.0.0.1:19876` with one registry entry, and the user signed in with LDAP in their browser. The browser showed "Authorization successful"; with no code pasted, `mcp-auth.json` then held dh-panel-context tokens and no code verifier, the port was free and the registry empty. A `POST /mcp/dh-panel-context/connect` through vibeterm-api then reported it `connected` in the tabs.

## Build and install

- Build command: `bash .vibeterm/build.sh` from the primary checkout at `93993bfd5d`; smoke test passed; v2 migration guard gate PASSED at 2026-11-27T13:45:40Z.
- Installed artifact: `1.19.5-vt-634-006d837c50` at `~/projects/opencode-build/bin/opencode`; previous archived as `opencode.prev-1795787582`.
- Running services: tabs pick up `vt-634` as they restart; no tab was restarted by this session.
- The primary checkout's `node_modules` lacked `re2js` (declared in `packages/opencode/package.json`), which failed the pre-push typecheck until `bun install --frozen-lockfile --ignore-scripts` ran there.

## Commit provenance

- `93993bfd5d` - manual sign-ins wait for their browser callback; external start replaces an unfinished manual flow; connect keeps a sign-in's transport
- Required trailer: `AI-Session-ID: ses_dea603fe9ffe5q6cdf0LWRqu4t`

## Unknowns and blocked verification

- A Portal modal start scoped to a session or directory with no live tab still gets 503 from vibeterm-api; that selection lives in opencode-tools and is not changed here.
