# Anthropic Meridian provider clone

## Identity

- Workday: 2026-11-12
- Session: [`ses_e2d132177ffek3mT6E6W6BGWHa`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e2d132177ffek3mT6E6W6BGWHa)
- Agent/platform: `opencode` with `anthropic/claude-opus-5-5` / `linux`
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/anthropic-meridian-clone`
- Upstream base: `006d837c50` (upstream `v1`)
- Source result commit(s): `b1edf16248`
- Forklog commit: this file's introducing commit

## User requests

> let's measure speed (time taken) (from begin to end) and equivalent api cost (numbers are $ but it's subscription), and how much % of a subscription that job took (interface with meridian about it, we should force requests through a non default provider in opencode, meridian could expose profiles as model names eg anthropic-meridian/profile-name-here/opus-5-5. [...] Ask opencode-tools meridian coordinator to build a new provider like this in our opencode fork, similar to how anthropic2/ and openai2/ exist.

## Goals

- `anthropic-meridian` catalog clone, so Vibeterm's profile-pinned models inherit catalog prices and variants.

## Constraints and non-goals

- Profile generation, model lists and the hold out of rotation live in opencode-tools (`_lib/meridian-profile-models`) and Meridian, not here.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| `opencode` | `dev-nowaker` | `df9bd8fc41` | `b1edf16248` | fast-forward |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Anthropic Meridian provider clone](../features/2026-11-12-anthropic-meridian-provider.md) | added | `test/provider/clone-routing.test.ts` |

## Other delivered work

- opencode-tools `feat/meridian-profile-providers`: `anthropic-meridian/<profile>/<model>` and `openai-meridian/<profile>/<model>` generation, `meridian.profileModels`, `meridian.heldProfiles`, `vibeterm-meridian hold|release|held|usage`.

## Verification

- `bun test test/provider/clone-routing.test.ts` - 5 pass; without the `CLONES` row 3 pass, 2 fail.
- `bun typecheck` in `packages/opencode` - exit 0.
- Manual surface, scratch XDG dirs: `opencode models anthropic-meridian` lists 52 ids; a run pinned to `d-dh-c2` and its title request are both served by `d-dh-c2` per Meridian telemetry.

## Build and install

- Build command: `.vibeterm/build.sh` on `dev-nowaker`.
- Installed artifact: recorded in the commit that installs it; TBD at the time of writing.
- Running services: not restarted; tabs pick the binary up on their next restart.

## Commit provenance

- `b1edf16248` - the clone.
- Required trailer: `AI-Session-ID: ses_e2d132177ffek3mT6E6W6BGWHa`

## Unknowns and blocked verification

- None.
