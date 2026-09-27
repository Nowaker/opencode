# OpenAI Meridian provider integration

## Identity

- Workday: 2026-09-27
- Session: `ses_f1b584ed7ffe6o2WMYwwpxohpL`
- Agent/platform: Sisyphus (`anthropic/claude-opus-5-5`) / Linux
- Repository: `/home/nowaker/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/openai-meridian-provider` (worktree
  `/home/nowaker/projekty/webapps/opencode-openai-meridian`)
- Upstream base: `2406400f0` (upstream `dev`, contains `v1.18.32`); no upstream
  upgrade
- Source result commit(s): `eea39ba935` (fast-forward)
- Forklog commit: this file's introducing commit

## User requests

Spawned by Meridian coordinator `ses_fe8a27c6effe6KEx3TRNvOLgUo`:

> TASK: land the already-committed `openai-meridian` provider clone and make it
> usable.

## Goals

- `dev-nowaker` contains `eea39ba935`, pushed to `origin` and `nowaker-github`.
- The installed binary exposes `openai-meridian/`, configured for the Meridian
  ChatGPT gateway on `127.0.0.1:3459`.

## Constraints and non-goals

- The uncommitted retry-header patch stays untouched.
- No restart of `opencode-serve-tailscale`, `opencode-serve-lan`, or any
  vibeterm tab. No prompts sent through `openai/`.
- Config files holding provider keys were never printed; only changed key
  paths were reported.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `1a295828f0` | `eea39ba935` | fast-forward merge (branch already based on the tip) |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [OpenAI Meridian provider clone](../features/2026-09-27-openai-meridian-provider.md) | introduced | provider test, installed `models` listing |
| [Alternate provider clones](../features/2026-05-30-alt-provider-clones.md) | extended (shared clone loop, name suffix) | provider test 103 pass |

## Other delivered work

- `~/.config/opencode/opencode.jsonc` (last in the global load order, merged
  with `remeda.mergeDeep`): set `provider.openai-meridian.options.baseURL` and
  `provider.openai-meridian.options.apiKey` with jsonc-parser `modify`. Backup
  `opencode.jsonc.bak-openai-meridian-20260927` (mode 600). `opencode.json`
  has no `openai-meridian` entry, so nothing shadows it.
- `AGENTS.local.md` (local, excluded from git) lists `openai-meridian` among
  the custom seams to preserve.

## Verification

- `bun test test/provider/provider.test.ts --timeout 60000` from
  `packages/opencode` on `dev-nowaker`: 103 pass, 0 fail, 252 assertions.
- New process `opencode models openai-meridian`: exit 0, 55 models.
- New process `opencode models openai`: exit 0, 19 models (OAuth-filtered
  Codex subset); `opencode providers list` reports `OpenAI oauth`.
- Throwaway loopback `opencode serve` from the installed binary, with a random
  server password and the vibeterm environment stripped; its process group
  was reaped afterwards:
  - `GET /provider/auth`: `openai` offers exactly the four oc-codex-multi-auth
    OAuth methods (its `AUTH_LABELS`, e.g. `Codex OAuth (ChatGPT Plus/Pro)`)
    rather than the built-in Codex plugin's labels; `openai2` and
    `openai-meridian` have no auth hook.
  - `GET /config`: effective `provider.openai-meridian.options.baseURL` is
    `http://127.0.0.1:3459/v1`; the oc-codex-multi-auth plugin entry is
    present.
- Structural config check: `opencode.jsonc` minus `provider.openai-meridian`
  deep-equals the pre-edit backup; `opencode.json` was not modified.
- The installed binary contains the `openai-meridian` string.
- Pre-build binary `opencode.prev-1790543498`, new process, edited config:
  `models openai` exit 0, 19 models; `models openai-meridian` exit 1,
  `Provider not found: openai-meridian`. The new entry does not break a
  binary without the clone.
- No prompt was sent through `openai/` or `openai-meridian/`.

## Build and install

- Build command: `OPENCODE_VERSION=1.18.32
  /home/nowaker/projekty/webapps/opencode-build/build.sh`, exit 0; `bun.lock`
  restored clean.
- Installed artifact: `1.18.32`, inode `49966977` -> `49967040`, SHA-256
  `1b3da3d28487abf51076c9e0d44f2f22e50d2e73a9dbc2400626dba99ad267ab`.
  It carries the uncommitted retry-header cap (one
  `OPENCODE_RETRY_MAX_HEADER_DELAY_MS` occurrence).
- Running services unchanged before the build, after it, and after the
  throwaway server check:
  - tailscale PID `3879113`, start `Sat Sep 26 22:41:11 2026`.
  - LAN PID `3878683`, start `Sat Sep 26 22:41:10 2026`.
- Both units and this session's TUI still execute the pre-build binary, which
  the installer kept as `bin/opencode.prev-1790543498` (inode `49966977`).
  Existing processes see `openai-meridian` only after an operator-controlled
  restart; newly started processes use the installed binary.

## Preserved local state

Dirty files kept their SHA-256 values across merge and build:

- `.gitignore`: `943797ef9f8c3664...`
- `packages/opencode/src/session/retry.ts`: `63fb966dbae2dce1...`
- `packages/opencode/test/session/retry.test.ts`: `3949c623924c2afc...`

## Commit provenance

- `eea39ba935` - feature commit (authored by `ses_fe8a27c6effe6KEx3TRNvOLgUo`).
- Required trailer: `AI-Session-ID: ses_f1b584ed7ffe6o2WMYwwpxohpL`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-09-27-openai-meridian-provider.md
```

## Unknowns and blocked verification

- End-to-end `openai-meridian/` requests were not tested. They depend on the
  Meridian ChatGPT gateway on `:3459` (`meridian-gpt.service`), which another
  worker deploys.
