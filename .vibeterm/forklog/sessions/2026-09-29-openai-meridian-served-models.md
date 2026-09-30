# openai-meridian offers exactly what its gateway serves

## Identity

- Workday: 2026-09-29
- Session: `ses_f106b7eecffenW3xCMfi1WsXia`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `meridian-served-models` (worktree
  `~/projekty/webapps/opencode-meridian-served`)
- Upstream base: `2406400f0` (upstream `dev`, contains `v1.18.32`); unchanged
- Source result commit(s): `e185addfe5`
- Forklog commit: this file's introducing commit

## User requests

Spawned by Meridian coordinator `ses_fe8a27c6effe6KEx3TRNvOLgUo`. The user's
question, as quoted in the brief:

> where is the whitelist? does it need to be used?

The task, condensed from the brief:

> Make openai-meridian offer exactly what meridian-gpt serves: at provider
> load, read meridian-gpt's GET <baseURL>/v1/models and intersect it with the
> models.dev openai list [...] Then remove `whitelist` from
> provider["openai-meridian"] in ~/.config/opencode/opencode.jsonc

## Goals

- `opencode models openai-meridian` follows meridian-gpt's `/v1/models` with
  no config edit or restart when a model appears (gpt-6.1-sol, 2026-09-29).
- models.dev keeps supplying metadata and the `-fast`/`-pro` mode aliases.
- An unreachable or slow gateway degrades to the configured whitelist, else
  the models.dev catalog, and is logged.

## Constraints and non-goals

- `openai-meridian` only: `openai2` (plain API) keeps the full models.dev
  catalog; `anthropic2` must still match `anthropic`.
- No restart of the opencode serve units, vibeterm or meridian; no edits to
  the meridian repos; never print `opencode.jsonc`.
- Coordinator ruling: the gateway list is the truth, no union with models.dev.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `14679f5b44` | `e185addfe5` | fast-forward from `meridian-served-models`; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [OpenAI Meridian provider clone](../features/2026-09-27-openai-meridian-provider.md) | changed: served-model list replaces the config whitelist | 7 new provider tests; installed-binary `models`/`run` checks |
| [Alternate provider clones](../features/2026-05-30-alt-provider-clones.md) | changed: `CLONES[].servedModels` flag; `anthropic2`/`openai2` preserved | `openai2` test behind the same gateway; pre/post binary model lists identical |

## Other delivered work

- `~/.config/opencode/opencode.jsonc`: removed
  `provider["openai-meridian"].whitelist` (24 ids) with a jsonc-parser edit
  that verified the rest of the document is unchanged; backup
  `opencode.jsonc.bak-whitelist-drop-20260929` (byte-identical to the
  original). `opencode.json` has no `openai-meridian` entry.

## Verification

- `bun typecheck` (packages/opencode) - exit 0.
- `bun test test/provider/` - 726 pass / 0 fail. One earlier run failed the
  first test in the file on the 5 s timeout under load average ~25; it passed
  alone, and the file passes at baseline (107/107) and with the change
  (114/114).
- Installed binary, from `/dev/shm/ai`, with no whitelist in config:
  `opencode models openai-meridian` lists 24 models (9 served base ids plus
  their `-fast`/`-pro` aliases), including `gpt-6.1-sol`; `gpt-5.4-nano`
  absent.
- `opencode run -m openai-meridian/gpt-6.1-sol "Reply with the single word:
  pong"` and the same for `gpt-6-sol` - both replied `pong`.
- Pre-change binary `opencode.prev-1790727551` vs new: `openai` 21/21,
  `openai2` 60/60, `anthropic2` 19/19 model ids, zero diff lines;
  `anthropic` vs `anthropic2` zero diff lines.

## Build and install

- Build command: `~/projekty/webapps/opencode-build/build.sh`
- Installed artifact: `1.18.32`, inode 49968294 (previous 49968178 archived as
  `opencode.prev-1790727551`); new code present in the bundle (UTF-16
  string table).
- Running services: `opencode-serve-tailscale` 11579 and `opencode-serve-lan`
  11558 (both started 14:49:39) unchanged after the build. A later machine
  reboot restarted every unit at 19:30:50; this session restarted nothing.

## Commit provenance

- `e185addfe5` - feat(provider): offer openai-meridian exactly the models its gateway serves
- Required trailer: `AI-Session-ID: ses_f106b7eecffenW3xCMfi1WsXia`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-09-29-openai-meridian-served-models.md
```

## Historical evidence carried forward

- Before this session meridian-gpt's `/v1/models` listed only its static
  8-id `CHATGPT_MODELS`; gpt-6.1-sol appeared after the coordinator's
  catalog worker raised the Codex catalog client version and the host
  rebooted.

## Unknowns and blocked verification

- None.
