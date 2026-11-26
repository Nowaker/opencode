# MCP OAuth callbacks shared by every process on the machine

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch: `oauth-callback-relay`
- First local commit: `74e6e381562`
- Current local commit: `74e6e381562`
- Upstream base when introduced: `006d837c50` (v1.19.5, from the `vt-614` build stamp)
- Last checked against upstream: `006d837c50`

## Original request

> I recently pulled in some changes for the shared repos like Portal and opencode-tools. Then I noticed some issues with my MCPs, maybe related, maybe not. But can you check at this Oauth for dh-panel context mcp

The screenshot showed `127.0.0.1:19876/mcp/oauth/callback` answering "Invalid or expired state parameter - potential CSRF attack". Follow-up:

> investigate this further. run some tests and lets come up with a valid solution that will work for the shared repo and all users

## Goals

- A desktop MCP sign-in finishes whichever opencode process holds the redirect port, with any number of TUIs, warm spares, servers and `opencode mcp auth` running.
- No process holds the redirect port unless a sign-in is waiting for it.

## Non-goals

- Changing the redirect URI. Clients registered with authorization servers (dynamic or static `clientId`) keep `127.0.0.1:19876`.
- Upstream's v2 design (a private ephemeral-port listener per login): it depends on the authorization server accepting any loopback port or on a fresh registration per login, and breaks static clients registered for 19876.

## Rationale and constraints

- `ensureRunning` treated a busy port as its own and continued, and the holder refused every state it had not started. A sign-in's state and PKCE verifier live only in the starting process (`1cdfe76abb`), so the holder cannot finish it itself.
- `startAuth` bound the port for flows nobody awaited (the HTTP start route without `callbackMode: "external"`, and `authenticate` on a server that needed no sign-in). Seen on 2026-11-25: a Vibeterm warm spare held 19876 and every other tab's sign-in failed.
- The registry holds no secret: the state is hashed, entries are 0600 in a 0700 directory, and a holder forwards only to `127.0.0.1` relays of live PIDs.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `74e6e381562` | 2026-11-25 | Per-process loopback relay plus `$XDG_STATE_HOME/opencode/mcp-oauth-callback/<sha256(state)>.json` registry; the holder forwards other processes' states, keeps the port while any process waits, and a waiter takes it over when the holder exits; `authenticate` listens through `listenFor` just before opening the browser, `startAuth` binds nothing | `packages/opencode/src/mcp/oauth-callback.ts` (`listenFor`, `checkPort`), `MCP.authenticate` / `MCP.startAuth` in `packages/opencode/src/mcp/index.ts`, `test/mcp/oauth-callback-processes.test.ts` |

vibeterm-api speaks the same registry format (`opencode-tools` `ba272b4ee`, `_lib/mcp-oauth-callback/registry.ts`). Change both together.

## Verification

- `bun test test/mcp/oauth-callback-processes.test.ts` - the four tests for the reported behavior fail on `bafac0a4ff7` (400 "Invalid or expired state parameter", ECONNREFUSED after the holder's own sign-in, two leaked listeners); all six pass on `74e6e381562`. Removing the loopback check or the takeover makes those tests fail.
- `bun test test/mcp/` plus the three MCP HttpApi suites - 117 pass, 0 fail; `bun typecheck` clean; `bun turbo typecheck` 30/30.
- Installed `1.19.5-vt-614-006d837c50`, isolated HOME/XDG, fixture OAuth server, a fake `open` on PATH: `opencode mcp auth alpha` held the port and kept waiting; `opencode mcp auth beta`'s browser got 200 "Authorization successful" through it and beta stored its token.
- Cross-repository: the fork's holder forwarded to an opencode-tools registry waiter, and an opencode-tools registry holder forwarded to the fork's `listenFor` waiter.

## Timeline

- 2026-11-25 [`ses_dea603fe9ffe5q6cdf0LWRqu4t`](../sessions/2026-11-25-mcp-oauth-shared-callback.md) - diagnosis, fix, build and install.

## Current maintenance notes

- A process on an older build neither registers nor forwards; it behaves as before until restarted.
- Upstream dev (v2 core) replaced this listener with per-login ephemeral ports; an upstream bump onto v1 must re-check `oauth-callback.ts` and `MCP.authenticate`.
