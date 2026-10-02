# OpenAI Meridian provider clone

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/openai-meridian-provider`
- First local commit: `eea39ba935`
- Current local commit(s): `eea39ba935`, `67884b2f3f`, `e185addfe5`, `2475f7552b`
- Upstream base when introduced: `2406400f0` (upstream `dev`, contains `v1.18.32`)
- Last checked against upstream: `2fa3363c92` (upstream `dev`, contains `v1.18.33`)

## Original request

The code change was authored by coordinator session
`ses_fe8a27c6effe6KEx3TRNvOLgUo`. Its brief condenses the user's goal:

> First usability test: Meridian FOLLOWS the external oc-codex-multi-auth store
> (reads its accounts/access tokens, NEVER refreshes OAuth itself) and serves
> opencode's new `openai-meridian/` provider. `openai/` (oc-codex-multi-auth) and
> `openai2/` (plain API) must keep working untouched.

## Goals

- Expose `openai-meridian`, named "OpenAI (Meridian)", with the full OpenAI
  catalog under its own provider ID.
- Route it to a Meridian ChatGPT gateway through
  `provider["openai-meridian"].options.baseURL` while `openai/` stays on
  oc-codex-multi-auth and `openai2/` on the plain API.

## Non-goals

- No gateway logic inside OpenCode. Meridian owns ChatGPT authentication and
  request adaptation.
- No change to `openai2`, `anthropic`, or `anthropic2` behavior, nor to
  `openai` without a configured baseURL. Since `2475f7552b`, `openai` with a
  non-default `options.baseURL` takes this clone's gateway behaviour.

## Rationale and constraints

- oc-codex-multi-auth and the built-in Codex plugin bind to provider ID
  `openai`, so neither attaches to this clone even though both share
  `@ai-sdk/openai`. The clone therefore authenticates with a plain API key
  (`meridian-local`) and sends an unshaped Responses request.
- The clone extends the `alt-provider-clones` loop with a per-clone name
  suffix, reuses the Responses API `getModel` and the OpenAI header timeout,
  and applies the same `gpt-5-chat-latest` exclusion.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `eea39ba935` | 2026-09-27 | Register `openai-meridian` catalog clone and custom loader | provider catalog clone loop and `custom` provider map in `packages/opencode/src/provider/provider.ts`; `test/provider/provider.test.ts` |
| `67884b2f3f` | 2026-09-28 | Small model from family `gpt-luna` (base model, not `-fast` / `-pro`), because the Codex backend refuses every nano and mini for ChatGPT accounts | `CLONES[].smallFamilies` and `getSmallModel` in `provider.ts` |
| `e185addfe5` | 2026-09-29 | Offer exactly the OpenAI ids `<baseURL>/models` lists (1.5 s timeout), keeping their models.dev metadata and `-fast`/`-pro` aliases, adding served ids models.dev lacks with defaults; a failed read is logged and falls back to the configured whitelist, else models.dev; a whitelist/blacklist still narrows the result | `CLONES[].servedModels`, `fetchServedModels`, `applyServedModels`, and the pass before the whitelist/blacklist loop in `provider.ts`; `test/provider/provider.test.ts` |
| `2475f7552b` | 2026-10-02 | The built-in `openai` with a non-default `options.baseURL` gets the same `servedModels` + `smallFamilies` (`OPENAI_GATEWAY`) through `gatewayBehaviour()`; the Codex auth loader skips its chatgpt.com-rewriting OAuth fetch when a baseURL is configured | `OPENAI_GATEWAY`, `gatewayBehaviour` in `provider.ts`; `auth.loader` in `src/plugin/openai/codex.ts`; both test files |

## Verification

- Coordinator session, worktree: new provider test red without the change and
  green with it; `test/provider` 715 pass / 0 fail; `bun typecheck` exit 0.
- [Integration session](../sessions/2026-09-27-openai-meridian-provider.md):
  `bun test test/provider/provider.test.ts` 103 pass / 0 fail.
- Installed binary, new process: `opencode models openai-meridian` lists 55
  models; `opencode models openai` still lists the 19-model OAuth subset.
- Throwaway loopback server from the installed binary: the `openai` auth
  methods are oc-codex-multi-auth's four OAuth methods; `openai-meridian` has
  no auth hook and its effective `baseURL` is `http://127.0.0.1:3459/v1`.

## Timeline

- 2026-09-27 `ses_fe8a27c6effe6KEx3TRNvOLgUo` - author `eea39ba935` on
  `feat/openai-meridian-provider`. Evidence: commit trailer and worktree tests.
- 2026-09-27
  [`ses_f1b584ed7ffe6o2WMYwwpxohpL`](../sessions/2026-09-27-openai-meridian-provider.md)
  - fast-forward into `dev-nowaker`, build, install, configure the global
  provider entry, and verify from a new process.
- 2026-09-28
  [`ses_f14dc2d9effeJ663ftS9g8dVoS`](../sessions/2026-09-28-openai-meridian-small-model.md)
  - `67884b2f3f`: small model `gpt-6-luna` instead of the refused
  `gpt-5.4-nano`; config whitelist of the served models. Evidence: title
  request `gpt-6-luna` 200 on meridian-gpt, sessions titled.
- 2026-09-29
  [`ses_f106b7eecffenW3xCMfi1WsXia`](../sessions/2026-09-29-openai-meridian-served-models.md)
  - `e185addfe5`: the model list follows meridian-gpt's `/v1/models`; the
  config whitelist is removed. Evidence: `test/provider` 726 pass;
  installed binary lists `gpt-6.1-sol`, not `gpt-5.4-nano`, and `run`
  against `gpt-6.1-sol` and `gpt-6-sol` replies.
- 2026-09-30 [`ses_f0f108c6dffeMymgpAsLy9LESM`](../sessions/2026-09-30-upstream-1.18.33.md) -
  rebased unchanged onto upstream `dev`
  `2fa3363c92` (contains `v1.18.33`). Evidence: that session's gates.
- 2026-10-02
  [`ses_f01c05e81ffeH39PdmzetO2pyw`](../sessions/2026-10-02-openai-gateway-parity.md)
  - `2475f7552b`: `openai` behind a gateway baseURL shares this clone's
  served-models and small-model behaviour; a configured baseURL beats an
  auth.json OAuth entry. Evidence: provider and codex tests; isolated-XDG
  `opencode models openai` lists only meridian-gpt's served set and a
  session is titled via `gpt-6-luna`.

## Current maintenance notes

- Configuration lives in `~/.config/opencode/opencode.jsonc` as
  `provider["openai-meridian"].options.{baseURL,apiKey}`, pointing at
  `meridian-gpt.service` on `127.0.0.1:3459`. No whitelist: the offered
  models are whatever meridian-gpt's `/v1/models` lists at provider load
  (meridian reads the Codex backend's own catalog). An optional
  `whitelist`/`blacklist` still narrows that and is the fallback when the
  gateway is down. If the backend stops serving `gpt-luna`, change
  `smallFamilies` in `CLONES`.
- Audit new `openai`-specific filters for an equivalent `openai-meridian` case,
  as with `openai2`.
- A binary without this clone still loads that config: it reports
  `Provider not found: openai-meridian` only when the provider is requested.

### Upstream integration checklist

- Locate each stable seam in the new upstream tree.
- Classify the customization as preserved, conflicted, superseded, or removed.
- Run `test/provider/provider.test.ts` and `bun typecheck` in `packages/opencode`.
- Build through the host's canonical installer and verify the installed binary.
- Confirm protected services kept the same PID and start timestamp.
- Link a new timeline row to the current session record.
- Update `Last checked against upstream`.

## Supersession or removal

- Not applicable; status is active.
