# Alternate provider clones

## Identity

- Status: active
- Integration branch: `master-nowaker`
- Development branch(es): direct work on `master-nowaker`
- First local commit: `77e7572d5`
- Current local commit(s): `77e7572d5`
- Upstream base when introduced: `a85d8d23aa` (`v1.18.5`)
- Last checked against upstream: `10765ff2a` (`v1.18.25`)

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

The OpenAI clone applies the same `gpt-5-chat-latest` exclusion as the original
provider because its model resolver cannot serve that chat alias.

## Verification

- 2026-08-29 semantic gate: provider coverage passes inside
  388 pass / 3 skip / 0 fail.
- The effective OMO audit reads Anthropic and OpenAI model catalogs without
  requiring these alternates to appear as defaults.

## Session ledger

- 2026-05-30 `ses_188220dadffeb8GepIK8xraEoj` - add code-level
  `anthropic2` and `openai2` catalog clones. Confirmed by the exact session
  title, commit subject, and matching purpose. CWD:
  `~/projekty/nowaker/opencode-tools`; platform: OpenCode; development branch:
  `master-nowaker`.

## Current maintenance notes

- Preserve cloning immediately after the primary models.dev catalogs load.
- Audit new parent-specific filters for an equivalent alternate-provider case.

## Supersession or removal

- Not applicable; status is active.
