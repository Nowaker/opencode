# openai/ behind a gateway baseURL behaves like openai-meridian/

## Identity

- Workday: 2026-10-02
- Session: `ses_f01c05e81ffeH39PdmzetO2pyw`
- Agent/platform: `Sisyphus - ultraworker` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `openai-gateway-parity`, `fork-install-method`
  (worktrees under `.vibeterm/worktrees/`)
- Upstream base: `2fa3363c92` (upstream `dev`, contains `v1.18.33`); unchanged
- Source result commit(s): `2475f7552b`, `c8ce109f25`
- Forklog commit(s): `a7275d4b61` and the commit that adds the follow-up below;
  the first was already pushed, so the follow-up is a separate commit

## User requests

Spawned by Meridian coordinator `ses_fe8a27c6effe6KEx3TRNvOLgUo`. The task,
condensed from the brief:

> Give the built-in `openai` provider the same behaviour our `openai-meridian`
> clone has, whenever openai's baseURL is configured to point at a Meridian
> (or any non-default baseURL). [...] Share the code path with the clone; do
> not duplicate it. [...] Check whether codex.ts's "auth.json has an openai
> OAuth entry -> go straight to chatgpt.com" path takes precedence over a
> configured baseURL.

Follow-ups from the coordinator, condensed: bring m4max to the same build
(diagnose its fetch refspec and uncommitted diff, back the diff up first),
and make `.vibeterm/build.sh` binaries report install method `unknown`. The
user's comment on the latter, verbatim:

> vibeterm should not care about any other opencode binaries other than the one it is configured to use.

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
| `opencode` | `dev-nowaker` | `a7275d4b61` | `c8ce109f25` | fast-forward from `fork-install-method`; pushed to both remotes |
| `opencode` (m4max) | `dev-nowaker` | `7f96412db7` | `c8ce109f25` | fast-forward after fixing its fetch refspec |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [OpenAI Meridian provider clone](../features/2026-09-27-openai-meridian-provider.md) | changed: its gateway flags are shared with `openai` behind a baseURL | 5 new provider tests; isolated-XDG installed-binary check |
| [Alternate provider clones](../features/2026-05-30-alt-provider-clones.md) | changed: `gatewayBehaviour()` replaces direct `CLONES` lookups; `anthropic2`/`openai2` preserved | `openai2` keeps the full catalog behind the same gateway in the new test |
| [Unmanaged install method for fork builds](../features/2026-10-02-unmanaged-install-method.md) | introduced | installation test; m4max TUI probe with logging package-manager stubs |

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
- `bun test test/installation/installation.test.ts` - 13 pass; the new test
  fails (`bun`) with `src/installation/index.ts` reverted. `bun typecheck`
  exit 0.
- m4max, fresh XDG config without `autoupdate`, logging npm/brew/bun/yarn/pnpm
  stubs first on PATH, TUI left 40 s: `vt-55` - no modal, 0 package-manager
  calls, also with `OPENCODE_ALWAYS_NOTIFY_UPDATE=1`; previous `vt-54` with
  that flag - 7 calls and "A new release v2.0.20" from Homebrew's formula.

## Build and install

- Build command: `.vibeterm/build.sh` in the primary checkout (at
  `2475f7552b` plus the uncommitted retry-header cap; a worktree build would
  drop that patch).
- Installed artifact: `1.18.33-vt-53-2fa3363c92`, inode 49977636 (previous
  49960363 archived as `opencode.prev-1790973269`); retry marker present.
- Running services: none restarted by this session.
- Desktop rebuild at `c8ce109f25` plus the retry cap: `1.18.33-vt-55-2fa3363c92`,
  inode 49977644, retry marker present.
- m4max: `remote.origin.fetch` was the narrowed
  `+refs/heads/master-nowaker:refs/remotes/origin/master-nowaker`, so
  `git fetch origin` never moved `origin/dev-nowaker`; set to
  `+refs/heads/*:refs/remotes/origin/*` in the repo's `.git/config`. Its
  uncommitted diff (`.gitignore` `.opencode/` plus the retry cap) equals
  desktop's and the canonical patch once `index` lines are normalized; the
  earlier sha mismatch was only abbreviated blob-hash length. Backup before
  any change: `~/projects/webapps/opencode-m4max-uncommitted-20261002.patch`.
  Built with its own `build.sh` (bun needs `~/.bun/bin` on PATH in a
  non-interactive ssh shell): `vt-54` at `a7275d4b61`, then
  `1.18.33-vt-55-2fa3363c92` at `c8ce109f25`, inode 20630605, retry marker
  present, diff sha256 `d59b769a...` identical to desktop's.

## Commit provenance

- `2475f7552b` - feat(provider): give openai behind a gateway baseURL openai-meridian's behaviour
- `c8ce109f25` - feat(installation): stamp .vibeterm/build.sh binaries as an unmanaged install
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
