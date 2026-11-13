# Anthropic Meridian provider clone

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/anthropic-meridian-clone`
- First local commit: `b1edf16248`
- Current local commit(s): `b1edf16248`
- Upstream base when introduced: `006d837c50` (upstream `v1`)
- Last checked against upstream: `006d837c50`

## Original request

Relayed by the Meridian coordinator `ses_fe8a27c6effe6KEx3TRNvOLgUo` from the user:

> Ask opencode-tools meridian coordinator to build a new provider like this in our opencode fork, similar to how anthropic2/ and openai2/ exist. We want anthropic-meridian/ and openai-.../ like this, with profiles

## Goals

- Expose `anthropic-meridian`, named "Anthropic (Meridian)", with the full Anthropic catalog under its own provider ID, so Vibeterm can declare models keyed `<profile>/<model>` whose `id` names a catalog model and inherit its price, limits and variants.

## Non-goals

- No profile logic in OpenCode. Vibeterm generates the `<profile>/<model>` entries and their `x-meridian-profile` header from settings; Meridian pins the request.
- No change to `anthropic`, `anthropic2`, `openai2` or `openai-meridian`.

## Rationale and constraints

- A plain config provider would have to restate price, limits and variants for every model; a catalog clone inherits them from the entry the config model's `id` names.
- No `smallFamilies`: Vibeterm gives its generated entries an empty `family`, so the small-model pick finds none and a pinned session titles itself on its own model and profile.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `b1edf16248` | 2026-11-12 | Register the `anthropic-meridian` catalog clone | `CLONES` in `packages/opencode/src/provider/provider.ts`; `test/provider/clone-routing.test.ts` |

## Verification

- `bun test test/provider/clone-routing.test.ts`: 5 pass; 2 of them fail with the `CLONES` row removed.
- Scratch-XDG opencode built from the branch with the Vibeterm plugin: `opencode models anthropic-meridian` lists 52 `<profile>/<model>` ids; `opencode run -m anthropic-meridian/d-dh-c2/claude-haiku-5-5` is served by Meridian profile `d-dh-c2` (Meridian telemetry) with cost $0.0016667 from the inherited catalog price.

## Timeline

- 2026-11-12 [`ses_e2d132177ffek3mT6E6W6BGWHa`](../sessions/2026-11-12-anthropic-meridian-provider.md) - author `b1edf16248` on `feat/anthropic-meridian-clone`.
