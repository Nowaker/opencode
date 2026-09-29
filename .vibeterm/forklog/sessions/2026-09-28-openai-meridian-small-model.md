# OpenAI Meridian small model and clone table

## Identity

- Workday: 2026-09-28
- Session: `ses_f14dc2d9effeJ663ftS9g8dVoS`
- Agent/platform: Sisyphus (`anthropic/claude-opus-5-5`) / Linux
- Repository: `/home/nowaker/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): direct commit on `dev-nowaker`
- Upstream base: `2406400f0` (upstream `dev`, contains `v1.18.32`); no upstream
  upgrade
- Source result commit(s): `67884b2f3f`
- Forklog commit: this file's introducing commit

## User requests

Spawned by Meridian coordinator `ses_fe8a27c6effe6KEx3TRNvOLgUo`:

> TASK: make openai-meridian's small model one the Codex backend actually
> serves (the cheapest one that works), without changing the small model of
> any other provider and without a global small_model override.

Follow-up from the coordinator: whoever changes `openai-meridian` owns the
sibling clones too, so the shared clone seam must stay correct for
`anthropic2` and `openai2`, with tests for both.

## Goals

- `openai-meridian` title and summary requests stop failing with HTTP 400.
- `anthropic2` and `openai2` keep their source's small model and behavior.

## Constraints and non-goals

- No global `small_model`; no change to any non-clone provider's small model.
- The uncommitted retry-header patch stays untouched.
- No restart of protected serve units. Config files holding provider keys were
  never printed; only the edited key and masked views were shown.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `561aa97ef3` | `67884b2f3f` | direct commit, pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [OpenAI Meridian provider clone](../features/2026-09-27-openai-meridian-provider.md) | changed: gpt-luna small model, served-model whitelist | provider tests, live title request |
| [Alternate provider clones](../features/2026-05-30-alt-provider-clones.md) | changed: one `CLONES` table, inherited loaders | provider tests 107 pass |

## Diagnosis

- Upstream `getSmallModel` walks the families `gemini-flash`, `gpt-nano`,
  `claude-haiku`; for `openai-meridian` it picked `gpt-5.4-nano`.
- Direct Responses probes through `meridian-gpt` (`127.0.0.1:3459`), all 24
  gateway-advertised models plus `gpt-5.6`, `gpt-5`, `o3`, `gpt-5.5-pro`,
  `gpt-4.1`: only `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`,
  `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5` return 200. Every other model,
  including every nano and mini, gets HTTP 400 "not supported when using Codex
  with a ChatGPT account". `service_tier: priority` on `gpt-6-luna` is served.
- Cheapest served model by catalog price: `gpt-6-luna` ($0.10 / $0.50 per
  million input / output tokens), family `gpt-luna`.
- No config key expresses a per-provider small model, so the lever is code.

## Other delivered work

- `~/.config/opencode/opencode.jsonc`: added
  `provider.openai-meridian.whitelist` (20 IDs: the seven served API IDs plus
  their `-fast` / `-pro` aliases) with a comment naming the probe, via
  jsonc-parser `modify`. Backup `opencode.jsonc.bak-meridian-whitelist-20260928`.
  The diff against the backup contains only that key and its comment.

## Verification

- `bun test test/provider/provider.test.ts` from `packages/opencode`: 107 pass,
  0 fail. The two new `openai-meridian` tests fail against `561aa97ef3`'s
  `provider.ts`; the loader and `anthropic2` / `openai2` parity tests pass on
  both, as regression guards.
- `bun typecheck` in `packages/opencode`: exit 0.
- New process `opencode models openai-meridian`: exactly the 20 whitelisted
  models.
- `opencode run -m openai-meridian/gpt-6-luna "Reply with exactly: pong"`:
  replied `pong`; session `ses_f14c7b996ffeTifG1IYmMpMWw0` titled
  "Pong reply request".
- `opencode run -m openai-meridian/gpt-6-sol ...`: meridian-gpt telemetry
  shows the title request `gpt-6-luna` 200 on adapter `chatgpt` at
  03:33:26Z and the turn `gpt-6-sol` 200 at 03:34:00Z; session
  `ses_f14c6a153ffenGX1UjyZGqaV7G` titled "Pong response request".
- Resolved small models from the installed catalog, no API calls: `openai2`
  `gpt-5.4-nano`; `anthropic` and `anthropic2` `claude-haiku-4-5-20251001`.

## Build and install

- Build command: `/home/nowaker/projekty/webapps/opencode-build/build.sh`,
  exit 0; smoke test `1.18.32`.
- Installed artifact: `1.18.32`, inode `49950962` -> `49968178`, SHA-256
  `5d95cce957391cb390cdc6f3088370674f27a1c1185b4872c6f3de114bcfcd12`;
  previous binary kept as `bin/opencode.prev-1790652694`. It carries the
  uncommitted retry-header cap (one `OPENCODE_RETRY_MAX_HEADER_DELAY_MS`
  occurrence) and the `smallFamilies` table.
- Protected units unchanged before and after the build:
  `opencode-sandbox-local` PID `18762`, `opencode-serve-lan` PID `18777`,
  `opencode-serve-tailscale` PID `18796`, `opencode-tailscale-dev` PID
  `18824`, all started 2026-09-28 18:40:17-18 CDT.

## Preserved local state

Dirty files kept their SHA-256 values across commit and build:

- `.gitignore`: `943797ef9f8c3664...`
- `packages/opencode/src/session/retry.ts`: `63fb966dbae2dce1...`
- `packages/opencode/test/session/retry.test.ts`: `3949c623924c2afc...`

## Commit provenance

- `67884b2f3f` - source commit.
- Required trailer: `AI-Session-ID: ses_f14dc2d9effeJ663ftS9g8dVoS`

## Unknowns and blocked verification

- The served-model set was probed through one gateway seat; other ChatGPT
  plans may serve a different set. The whitelist is config and easy to change.
- `-pro` aliases (`reasoningMode: pro`) were not probed end to end.
