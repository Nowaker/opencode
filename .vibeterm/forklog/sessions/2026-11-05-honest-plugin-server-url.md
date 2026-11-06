# Leave plugin serverUrl undefined without an HTTP listener

## Identity

- Workday: 2026-11-05
- Session: `ses_e51bbad20ffeGYfUME3WmE9Lnz`
- Agent/platform: opencode (anthropic/claude-opus-5-5) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode` (desktop), `~/projects/webapps/opencode` (m4max)
- Integration branch: `dev-nowaker`
- Development branch(es): `serverurl-honest` (worktree `.vibeterm/worktrees/serverurl-honest`, off `github/v1`)
- Upstream base: `006d837c50` (`v1.19.5`)
- Source result commit(s): `c333ffb3cc`, merge `628e9bb9ee`
- Forklog commit: this file's introducing commit

## User requests

Spawned by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`:

> Fix in our opencode fork (dev-nowaker), decided by the coordinator ses_ef8235798ffejGr4sa22eXmVNv. [...] When `Server.url` is undefined, `serverUrl` returns `undefined`. Widen the type in `packages/plugin/src/index.ts` [...] Audit every consumer before changing [...] Do NOT change `serve --port 0` behaviour

## Goals

- Plugins see `serverUrl` undefined in a portless process; the in-process client keeps working.
- Consumer audit across opencode, the OMO fork and opencode-tools.

## Constraints and non-goals

- Upstream branch commit without AI trailers; no PR opened.
- No restarts of user tabs, Vibeterm tmux, Meridian or serve units.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| opencode | `serverurl-honest` | `006d837c50` | `c333ffb3cc` | commit |
| opencode | `dev-nowaker` | `c596ebcada` | `628e9bb9ee` | merge `--no-ff` |
| opencode | `dev-nowaker` | `628e9bb9ee` | `18835d09bd` | coordinator's `.vibeterm/smoke.sh` fast-forward, pushed with this session's push |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Leave plugin serverUrl undefined without an HTTP listener](../features/2026-11-05-honest-plugin-server-url.md) | new | `server-url.test.ts`, isolated TUI check |

## Consumer audit

- opencode `packages/`: no internal reader of `PluginInput.serverUrl`; the four plugin tests that build a `PluginInput` set a URL and still compile. Other `serverUrl` hits are MCP OAuth and test-local helpers, unrelated.
- OMO fork (`~/projekty/forks/oh-my-openagent` `83f4e774be`): undefined-safe. `createGlobalSessionSdkClient` returns undefined without a URL; `initLiveServerRoute` takes `URL | undefined` and stays in-process; `create-managers.ts` creates the tmux manager only when `ctx.serverUrl` is set; the tmux manager reads `ctx.serverUrl?.toString()`.
- opencode-tools: `opencode-stuck-detector/plugin-runtime.ts:33` calls `input.serverUrl.toString()` and would throw on undefined. It is not in the live plugin lists on desktop or m4max (only in old config backups). Handed to the coordinator. `test-utils/load-smoke.ts` and plugin tests set their own URLs.

## Verification

- `bun test test/plugin/server-url.test.ts` in the worktree - 2 pass; with the old getter restored - 1 fail, received `http://localhost:4096/`.
- `bun test test/plugin` - 212 pass, 0 fail.
- `bun test test/server` - 292 pass, 2 skip, 6 fail. The same files fail on the unpatched base (5 fail, 18 pass in those six files either way); the failures come from this host's environment (user-config plugins such as `opencode-vibeterm-spawn-plugin` refusing to run in tests), not from this change.
- `bun typecheck` in `packages/opencode`, `packages/plugin`, `packages/sdk/js`, `packages/tui` - clean; re-run in `opencode` and `plugin` after the merge - clean.
- Manual surface (desktop, installed `1.19.5-vt-404-006d837c50`): an opencode TUI under a throwaway tmux socket (`-L serverurl-check`), scratch HOME/XDG, `OPENCODE_TOOLS_DATA_DIR`/`OPENCODE_PLUGINS_DATA_DIR`, a probe plugin from `OPENCODE_CONFIG_CONTENT`, and a dummy Bun HTTP server on 127.0.0.1:4096 logging every request. The probe recorded `serverUrl=undefined`; the dummy logged no requests. The probe's `client.project.current()` called during plugin init did not return within 30s: an init-time call back into the instance that is still bootstrapping it. The in-process client was the same before this change; the unit test covers the in-process client from a hook.
- `.vibeterm/smoke.sh` on the installed binary - SMOKE OK on desktop and m4max.

## Build and install

- Build command: `VIBETERM_V2_GUARD=<opencode-tools>/vibeterm-opencode-client/bin/vibeterm-v2-guard .vibeterm/build.sh` (desktop; the first run without it stopped before install), `.vibeterm/build.sh` with the guard on PATH (m4max).
- Installed artifact: `1.19.5-vt-404-006d837c50` on both hosts; desktop inode 49945427, m4max inode 55202182. v2 migration guard gate PASSED on both (m4max used cached opencode-ai 1.19.0 and @opencode/cli 2.0.29: disk reserve refused the download).
- Running services: none restarted.

## Commit provenance

- `c333ffb3cc` - upstreamable fix, no AI trailers.
- `628e9bb9ee` - merge into `dev-nowaker`.
- Required trailer: `AI-Session-ID: ses_e51bbad20ffeGYfUME3WmE9Lnz`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-05-honest-plugin-server-url.md
```

## Unknowns and blocked verification

- The upstream PR is not opened; PR body at `.vibeterm/tmp/opencode/pr-body-serverurl.md`.
