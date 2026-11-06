# Leave plugin serverUrl undefined without an HTTP listener

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `serverurl-honest` (upstreamable, on `github/v1`, local only; PR not opened, coordinator decides)
- First local commit: `c333ffb3cc`
- Current local commit(s): `c333ffb3cc`, merge `628e9bb9ee`
- Upstream base when introduced: `006d837c50` (`v1.19.5`, `github/v1`)
- Last checked against upstream: `006d837c50`

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (its decision, from the m4max lost-wake incident); no verbatim user prompt in this session:

> When `Server.url` is undefined, `serverUrl` returns `undefined`. Widen the type in `packages/plugin/src/index.ts` [...] and document it in the field's doc comment: "undefined when this process has no HTTP listener; use `client`, which is in-process then".

## Goals

- `PluginInput.serverUrl` mirrors `Server.url`: the listener URL when the process listens, `undefined` otherwise (every TUI started without `--port`, i.e. every Vibeterm tab).
- Plugins never get a fabricated `http://localhost:4096` that may belong to another process.

## Non-goals

- `serve --port 0` still tries 4096 first; test-rig hygiene is handled in opencode-tools (`.vibeterm/smoke.sh` uses an explicit free port).
- The SDK `client` handed to plugins is unchanged: it was already in-process without a listener.

## Rationale and constraints

- On m4max 2026-11-05 an orphaned `opencode serve --port 0` from a smoke rig held 127.0.0.1:4096. OMO's live-server-route trusted `serverUrl`, probed the stranger (`/global/health` 200), posted a background-task parent wake there (`prompt_async` 204), and the wake was lost (bg_167ffa87, parent `ses_e52ba815bffeefQfr4Iq9ROmr6`).
- `serverUrl?: URL` (optional) rather than `URL | undefined`: plugin tests and helpers that build a `PluginInput` literal keep compiling whether or not they set it; readers that dereference it unconditionally get a type error at exactly the case they mishandled.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `c333ffb3cc` | 2026-11-05 | `serverUrl` getter returns `Server.url` | `get serverUrl()` in `Plugin.layer` state, `packages/opencode/src/plugin/index.ts` |
| `c333ffb3cc` | 2026-11-05 | Type widened and documented | `PluginInput.serverUrl?` in `packages/plugin/src/index.ts` |
| `c333ffb3cc` | 2026-11-05 | Tests | `packages/opencode/test/plugin/server-url.test.ts` |
| `628e9bb9ee` | 2026-11-05 | Fork merge, no conflicts | - |

## Verification

See [the session record](../sessions/2026-11-05-honest-plugin-server-url.md#verification).

## Timeline

- 2026-11-05 [`ses_e51bbad20ffeGYfUME3WmE9Lnz`](../sessions/2026-11-05-honest-plugin-server-url.md) - initial build on `github/v1`, merge into `dev-nowaker`, install on desktop and m4max. Evidence: `c333ffb3cc`, `628e9bb9ee`.

## Current maintenance notes

- Focused test, from `packages/opencode`: `bun test test/plugin/server-url.test.ts` (2 pass). The no-listener case fails on the old getter with `http://localhost:4096/`.
- Known consumer that dereferences unconditionally: opencode-tools `opencode-stuck-detector/plugin-runtime.ts` (`input.serverUrl.toString()`); that plugin is not in the live plugin lists on desktop or m4max.
- Upstream PR body (not submitted): `.vibeterm/tmp/opencode/pr-body-serverurl.md`.
