# openai/ behind a gateway baseURL behaves like openai-meridian/

## Identity

- Workday: 2026-10-02
- Session: `ses_f01c05e81ffeH39PdmzetO2pyw`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `openai-gateway-parity` (worktree
  `.vibeterm/worktrees/openai-gateway-parity`)
- Upstream base: `2fa3363c92` (upstream `dev`, contains `v1.18.33`); unchanged
- Source result commit(s): `2475f7552b`
- Forklog commit: this file's introducing commit

## User requests

Spawned by Meridian coordinator `ses_fe8a27c6effe6KEx3TRNvOLgUo`. The task,
condensed from the brief:

> Give the built-in `openai` provider the same behaviour our `openai-meridian`
> clone has, whenever openai's baseURL is configured to point at a Meridian
> (or any non-default baseURL). [...] Share the code path with the clone; do
> not duplicate it. [...] Check whether codex.ts's "auth.json has an openai
> OAuth entry -> go straight to chatgpt.com" path takes precedence over a
> configured baseURL.

## Goals

- With `provider.openai.options.baseURL` set, `opencode models openai` lists
  only what the gateway serves, and a top-level `openai/` session gets a real
  title from a model the gateway serves.
- A configured baseURL routes requests even when auth.json holds an openai
  OAuth entry.

## Constraints and non-goals

- Without a baseURL (or with `https://api.openai.com/v1`) `openai` keeps its
  upstream catalog, nano small model and Codex OAuth path.
- `openai2` and `anthropic2` unchanged. No opencode process restarted: the
  desktop migration worker `ses_f0208e022ffeevyOIccgK4uWoR` owns the restart.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `7f96412db7` | `2475f7552b` | fast-forward from `openai-gateway-parity`; pushed to `origin` and `nowaker-github` |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [OpenAI Meridian provider clone](../features/2026-09-27-openai-meridian-provider.md) | changed: its gateway flags are shared with `openai` behind a baseURL | 5 new provider tests; isolated-XDG installed-binary check |
| [Alternate provider clones](../features/2026-05-30-alt-provider-clones.md) | changed: `gatewayBehaviour()` replaces direct `CLONES` lookups; `anthropic2`/`openai2` preserved | `openai2` keeps the full catalog behind the same gateway in the new test |

## Other delivered work

- `src/plugin/openai/codex.ts`: the auth loader skips its chatgpt.com
  rewriting OAuth fetch when the provider has a configured baseURL; test in
  `test/plugin/codex.test.ts`.

## Verification

- `bun test test/provider/provider.test.ts test/plugin/codex.test.ts` - 164
  pass / 1 fail; the failure is the file's first test timing out at 5 s cold.
  It passes alone in the worktree and fails alone on unmodified
  `dev-nowaker`, so it is pre-existing.
- `bun typecheck` (packages/opencode) - exit 0; the pre-push turbo typecheck
  passed 30/30.
- Installed binary, isolated `XDG_{CONFIG,DATA,STATE,CACHE}_HOME`, config
  `provider.openai.options.baseURL = http://127.0.0.1:3459/v1`, no auth.json:
  `opencode models openai` lists the 9 meridian-gpt ids plus their
  `-fast`/`-pro`/`-ultrafast` aliases (25 lines), no nano. The same binary
  with no baseURL and `OPENAI_API_KEY` lists 79, 4 of them nano.
- `opencode run --model openai/gpt-6-luna "Reply with exactly: pong"` -
  replied `pong`; session titled "Exact pong reply request"; the isolated log
  shows the title request on `gpt-6-luna` and no `nano`.

## Build and install

- Build command: `.vibeterm/build.sh` in the primary checkout (at
  `2475f7552b` plus the uncommitted retry-header cap; a worktree build would
  drop that patch).
- Installed artifact: `1.18.33-vt-53-2fa3363c92`, inode 49977636 (previous
  49960363 archived as `opencode.prev-1790973269`); retry marker present.
- Running services: none restarted by this session.
- m4max: not built. Its checkout is on `dev-nowaker` at `7f96412db7` with
  uncommitted `.gitignore` and retry-patch changes whose diff differs from
  desktop's, and `git fetch origin` there leaves `origin/dev-nowaker` at
  `7f96412db7` (only FETCH_HEAD updates).

## Commit provenance

- `2475f7552b` - feat(provider): give openai behind a gateway baseURL openai-meridian's behaviour
- Required trailer: `AI-Session-ID: ses_f01c05e81ffeH39PdmzetO2pyw`

```sh
git log --format='%H %(trailers:key=AI-Session-ID,valueonly)' -- \
  .vibeterm/forklog/sessions/2026-10-02-openai-gateway-parity.md
```

## Historical evidence carried forward

- None.

## Unknowns and blocked verification

- The desktop `openai/` live path through the user's real config waits on
  the migration worker's restart round.
