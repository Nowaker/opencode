# OpenAI Meridian provider clone

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `feat/openai-meridian-provider`
- First local commit: `eea39ba935`
- Current local commit(s): `eea39ba935`, `67884b2f3f`
- Upstream base when introduced: `2406400f0` (upstream `dev`, contains `v1.18.32`)
- Last checked against upstream: `2406400f0`

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
- No change to `openai`, `openai2`, `anthropic`, or `anthropic2` behavior.

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

## Current maintenance notes

- Configuration lives in `~/.config/opencode/opencode.jsonc` as
  `provider["openai-meridian"].options.{baseURL,apiKey}`, pointing at
  `meridian-gpt.service` on `127.0.0.1:3459`, plus
  `provider["openai-meridian"].whitelist` listing only the models the Codex
  backend serves (probed 2026-09-28 on one seat; plan-dependent). If the
  backend stops serving `gpt-luna`, change `smallFamilies` in `CLONES`.
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
