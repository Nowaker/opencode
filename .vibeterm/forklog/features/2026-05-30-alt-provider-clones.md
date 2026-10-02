# Alternate provider clones

## Identity

- Status: active
- Integration branch: `dev-nowaker` (`master-nowaker` until 2026-09-22)
- Development branch(es): direct work on `master-nowaker`
- First local commit: `77e7572d5`
- Current local commit(s): `77e7572d5`, `eea39ba935`, `67884b2f3f`, `e185addfe5`, `2475f7552b`
- Upstream base when introduced: `a85d8d23aa` (`v1.18.5`)
- Last checked against upstream: `2fa3363c92` (upstream `dev`, contains `v1.18.33`)

## Original request

TBD - no surviving original prompt found. The recovered session title is:

> opencode: anthropic2 + openai2 code-level provider clones

## Goals

- Expose independent `anthropic2` and `openai2` provider IDs with the same
  model catalogs and provider-specific behavior as their parent providers.
- Allow a second credential or gateway path to coexist with the original
  provider and remain selectable in a model ID.

## Non-goals

- Do not duplicate provider SDK packages or model metadata by hand.
- Do not make an alternate provider visible without matching user config.

## Rationale and constraints

- Catalog cloning must rewrite every model's provider ID while retaining cost,
  capability, limit, SDK, and compatibility metadata.
- Provider-specific behavior still follows the parent implementation: Anthropic
  beta headers and OpenAI Responses API selection remain intact.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `77e7572d5` | 2026-05-30 | Register `anthropic2` and `openai2` catalog clones | provider catalog construction and `custom` provider map |
| `eea39ba935` | 2026-09-27 | Give each clone its own name suffix for the [`openai-meridian`](./2026-09-27-openai-meridian-provider.md) clone; `anthropic2` and `openai2` keep `(alt)` | provider catalog clone loop |
| `67884b2f3f` | 2026-09-28 | One module-level `CLONES` table drives catalog registration, loaders (a clone runs its source's `custom` loader instead of a pasted copy), the `gpt-5-chat-latest` filter, and an optional per-clone `smallFamilies` | `CLONES` and `custom` in `provider.ts` |
| `e185addfe5` | 2026-09-29 | Optional per-clone `servedModels` narrows the catalog to what `<baseURL>/models` lists; set only on `openai-meridian`, so `anthropic2` and `openai2` keep their source catalogs | `CLONES[].servedModels` in `provider.ts` |
| `2475f7552b` | 2026-10-02 | `gatewayBehaviour(provider)` resolves the clone flags (and, for `openai` with a non-default baseURL, `openai-meridian`'s); the served-models pass and `getSmallModel` read it instead of `CLONES` | `GatewayBehaviour`, `gatewayBehaviour` in `provider.ts` |

The OpenAI clone applies the same `gpt-5-chat-latest` exclusion as the original
provider because its model resolver cannot serve that chat alias.

## Verification

- 2026-08-29 semantic gate: provider coverage passes inside
  388 pass / 3 skip / 0 fail.
- The effective OMO audit reads Anthropic and OpenAI model catalogs without
  requiring these alternates to appear as defaults.

## Timeline

- 2026-05-30 `ses_188220dadffeb8GepIK8xraEoj` - add code-level
  `anthropic2` and `openai2` catalog clones. Confirmed by the exact session
  title, commit subject, and matching purpose. CWD:
  `~/projekty/nowaker/opencode-tools`; platform: OpenCode; development branch:
  `master-nowaker`.
- 2026-08-29
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-08-29-upstream-bump-and-forklog.md)
  - preserve both catalog clones through `v1.18.25`. Evidence: provider tests
  pass inside the 388-test semantic gate.
- 2026-09-02
  [`ses_166c2c2b5ffe5Fr8aJwwuDgWT3`](../sessions/2026-09-02-opencode-omo-refresh.md)
  - preserve both catalog clones through `v1.18.27`. Evidence: provider
  coverage passes in the focused semantic gate.
- 2026-09-04
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-04-opencode-omo-refresh.md)
  - preserve both catalog clones through `v1.18.28`. Evidence: the 3596-test
  package suite passes.

- 2026-09-08
  [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-08-opencode-dev-omo-refresh.md)
  - preserve both catalog clones through upstream dev `5cd8e68fd`, whose
  range edits `provider/provider.ts` and `provider/transform.ts`. Evidence:
  688 focused provider, transform, retry, and Codex tests pass.
- 2026-09-22 [`ses_fb9a784deffe7zkW0r8oo25Nkg`](../sessions/2026-09-22-dev-nowaker-rebuild.md) -
  replayed unchanged onto upstream `dev` `2406400f0` as `dev-nowaker`; tree equals
  the `master-nowaker` + `dev` merge tree. Evidence: that session's gates.
- 2026-09-27
  [`ses_f1b584ed7ffe6o2WMYwwpxohpL`](../sessions/2026-09-27-openai-meridian-provider.md)
  - extend the clone loop with a per-clone name suffix for the
  [`openai-meridian`](./2026-09-27-openai-meridian-provider.md) clone; both
  existing clones are unchanged. Evidence: `test/provider/provider.test.ts`
  103 pass / 0 fail on `dev-nowaker`.
- 2026-09-28
  [`ses_f14dc2d9effeJ663ftS9g8dVoS`](../sessions/2026-09-28-openai-meridian-small-model.md)
  - consolidate the clones into the `CLONES` table with inherited loaders;
  `anthropic2` and `openai2` keep their source's small model
  (`claude-haiku-4-5-20251001`, `gpt-5.4-nano`). Evidence: provider tests
  107 pass, including loader and small-model parity for all three clones.
- 2026-09-29
  [`ses_f106b7eecffenW3xCMfi1WsXia`](../sessions/2026-09-29-openai-meridian-served-models.md)
  - add the `servedModels` clone flag for `openai-meridian`; `openai2` and
  `anthropic2` unchanged. Evidence: a test keeps `openai2`'s full catalog
  behind the same gateway; pre/post installed binaries list identical
  `openai2` (60) and `anthropic2` (19) models, and `anthropic2` matches
  `anthropic`.
- 2026-09-30 [`ses_f0f108c6dffeMymgpAsLy9LESM`](../sessions/2026-09-30-upstream-1.18.33.md) -
  rebased unchanged onto upstream `dev`
  `2fa3363c92` (contains `v1.18.33`). Evidence: that session's gates.
- 2026-10-02
  [`ses_f01c05e81ffeH39PdmzetO2pyw`](../sessions/2026-10-02-openai-gateway-parity.md)
  - route clone flags through `gatewayBehaviour()`; `openai2` and
  `anthropic2` unchanged. Evidence: a test keeps `openai2`'s full catalog
  behind the same gateway that narrows `openai`.

## Current maintenance notes

- Preserve cloning immediately after the primary models.dev catalogs load.
- A clone inherits its source's `custom` loader automatically; do not add
  per-clone loader copies.
- Audit new parent-specific filters for an equivalent alternate-provider case.
  Known providerID-literal checks the clones do not match, all benign on
  2026-09-28: `transform.ts` message-level cache options (`anthropic`; the
  Anthropic SDK reads the same cache control from the last content part), the
  `store: false` checks (`openai`; also matched by `@ai-sdk/openai`), the
  built-in Codex plugin (`openai` only, by design), and the opt-in native LLM
  runtime (clones fall back to the AI SDK path).
- `~/.config/opencode/opencode.json` sets `limit.input` 870000 on five
  `anthropic` models; `anthropic2` has no such override, so its long-context
  models use the catalog limit. Config, not code.

## Supersession or removal

- Not applicable; status is active.
