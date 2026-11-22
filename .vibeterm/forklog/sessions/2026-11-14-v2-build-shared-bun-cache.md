# build.sh --v2: share the caller's Bun cache in the isolated install

## Identity

- Workday: 2026-11-14
- Session: [`ses_e253782a5ffez6LfRkjLK0bav8`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e253782a5ffez6LfRkjLK0bav8), for coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv)
- Agent/platform: opencode Sisyphus, `anthropic/claude-opus-5-5` / linux (desktop)
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch: `fix/v2-build-shared-bun-cache`, cut from `dev-nowaker` at `94e59452d3`
- Source result commit: `4cd4357861c7e2e6d1004e54e795153c8a97bafb` - fix(build): share the caller's bun cache in the isolated v2 install
- Forklog commit: this file's introducing commit (written 2026-11-18 at the fork audit's request)

## User requests

> Build your proposed fix; I own the opencode fork and this is my go. [...] In .vibeterm/build.sh run_v2, give the install step BUN_INSTALL_CACHE_DIR set to the caller's real bun cache (resolve it before `env -i`: `$BUN_INSTALL_CACHE_DIR`, else `$HOME/.bun/install/cache`). Keep HOME, XDG config/data/state and everything else isolated [...]

## Problem

`build.sh --v2` runs `bun install --frozen-lockfile` through `run_v2`, which is `env -i` with `HOME` and `XDG_CACHE_HOME` inside the per-build scratch `.vibeterm/tmp/build-v2.*`. Bun therefore used an empty private package cache there, downloaded every package again and hardlinked `node_modules` to it; `restore_lockfile` removes the scratch on exit, which left the tree's `node_modules` as the only copy. On desktop on 2026-11-14 one W1 build of `v2-nowaker` (unit `w1-desktop-startup-build`, 19:33-19:42 CST) wrote 12.4 GB of `node_modules` with link count 1, about 14 GB of the `/home` free-space drop that evening. Other v2 worktrees installed outside `build.sh` shared `~/.bun/install/cache` (link count 9).

The cache isolation was not deliberate: `ee1e5815cf` ("build and install opencode2 in isolation") isolates HOME, XDG, database, config and plugin stores and never mentions the Bun cache, and the same W1 session set `BUN_INSTALL_CACHE_DIR=/home/nowaker/.bun/install/cache` in its own isolated check wrappers on 2026-11-13/14.

## Change

- `.vibeterm/build.sh`: `BUN_CACHE="${BUN_INSTALL_CACHE_DIR:-$HOME/.bun/install/cache}"` is resolved before `env -i`, and only the install step receives it: `run_v2 env BUN_INSTALL_CACHE_DIR="$BUN_CACHE" bun install --frozen-lockfile`. HOME, XDG, database, config, tool and plugin roots stay isolated; the build step gets no cache variable. Bun's cache is content-addressed by integrity and holds nothing user-specific.
- `.vibeterm/build.test.sh`: the fake `bun` records `BUN_INSTALL_CACHE_DIR` at install and fails if the build step sees one; a new case asserts the default (`$HOME/.bun/install/cache` of the caller) and an explicit override.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Guarded v2 foundation and separate installer](../features/2026-11-10-v2-foundation.md) | changed: v2 install shares the caller's Bun cache | `build.test.sh`, scratch install below |

## Verification

- `bash .vibeterm/build.test.sh` - failed before the fix (`FAIL: unset != .../live-home/.bun/install/cache`); BUILD SCRIPT TESTS PASSED after it, and again after rebasing onto `94e59452d3` (a forklog-only commit).
- Scratch install: `git archive` of `v2-nowaker`'s HEAD into a scratch tree, then the same `env -i` isolation (scratch HOME, XDG, TMPDIR) plus `BUN_INSTALL_CACHE_DIR=$HOME/.bun/install/cache` and `bun install --frozen-lockfile` - 1,826 packages in 4 s; `~/.bun/install/cache` stayed at 5,910 entries and 24,308 MB (nothing downloaded); no private cache appeared in the scratch HOME or XDG cache; all 119,282 `node_modules` files had link count 7 or more (0 bytes at link count 1). The scratch tree was deleted.

## Build and install

- Build command: not run. A real `build.sh --v2` needed a build slot from the v2 sub-coordinator; the scratch install exercises exactly the changed install step.
- Installed artifact: not installed by this session.
- Running services: not applicable.

## Commit provenance

- `4cd4357861` - fast-forwarded onto `dev-nowaker` and pushed to `origin` and `nowaker-github`; both tips verified with `git ls-remote`.
- Required trailer: `AI-Session-ID: ses_e253782a5ffez6LfRkjLK0bav8`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-11-14-v2-build-shared-bun-cache.md
```

## Follow-up 2026-11-22: the build step too

- Problem: `packages/cli/script/build.ts:74` runs `bun install --os="*" --cpu="*" --libc="*"` for every platform's native packages inside the build step, which still ran with the private scratch cache. Each v2 build tree kept 8.96 GB (3,876 files) of platform binaries shared with nothing; on desktop on 2026-11-22 `chat-text-click-v2` got it from one build (02:53-03:25Z), and `v2-nowaker` and `subagent-default` hold identical copies.
- Change: `fix(build): share the caller's bun cache in the isolated v2 build step too` gives `run_v2 ... bun ./script/build.ts --single` the same `BUN_INSTALL_CACHE_DIR` as the install step; the installed binary's probe run stays fully isolated.
- Verification: `build.test.sh` records the cache each step sees and asserts both; it failed (`unset`) before the change and passes after. An all-platform `bun install --os=* --cpu=* --libc=* @opentui/core@0.8.1` in a scratch tree under the same isolated environment installed all 8 platform packages hardlinked to `~/.bun/install/cache` (every file link count 2+) and created no private cache.
- Not run: a full `build.sh --v2`.

## Unknowns and blocked verification

- No end-to-end `build.sh --v2` run by this session; the next W1 build is the first full confirmation. `v2-nowaker`'s existing 12.4 GB of unshared `node_modules` was left to W1 to relink.
