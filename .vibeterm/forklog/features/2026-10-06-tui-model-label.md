# Show the provider and model id in message footers

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `tui-model-id` (also the upstream PR head); landing branch `model-id-land`
- First local commit: `66ce641060` (cherry-pick of `8c2d0bde91` on `tui-model-id`)
- Current local commit(s): `66ce641060`
- Upstream base when introduced: `ecc4916b5a` (upstream `dev`, `tui-model-id`); `dev-nowaker` stays on `907b3bc518`
- Last checked against upstream: `ecc4916b5a` (upstream `dev`)
- Upstream: issue [#53638](https://github.com/anomalyco/opencode/issues/53638), PR [#53639](https://github.com/anomalyco/opencode/pull/53639)

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, quoting the user:

> show anthropic/opus-5.5 (whatever the internal name is) instead of nice
> label, so user can actually see the provider used. i have openai/,
> openai-meridian/ and openai2/ for example. default: off, here: on.

## Goals

- `model_label: "id"` in `tui.json` shows `providerID/modelID` in every
  assistant message footer and in the prompt's model indicator.
- `"name"` (default) keeps upstream's display names.

## Non-goals

- No runtime toggle or slash command; the setting is read from `tui.json`.
- The `/models` picker, `/export` transcript and subagent footer keep display
  names.

## Rationale and constraints

- The fork serves one model through several provider clones (`openai`,
  `openai-meridian`, `openai2`, `anthropic2`); their footers read
  identically.
- The footer uses the IDs stored on the message, so it names the provider the
  turn ran on, not the current selection.
- In the prompt indicator `id` replaces both the model name and the provider
  name, since the ID already names the provider.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `66ce641060` | 2026-10-06 | `model_label` setting; footer and prompt labels | `ModelLabel` / `Info.model_label` in `packages/tui/src/config/index.tsx`; `label` in `packages/tui/src/util/model.ts`; the `model` memo in `AssistantMessage` in `packages/tui/src/routes/session/index.tsx`; `currentModelID` in `packages/tui/src/component/prompt/index.tsx`; `test/util/model.test.ts` |

## Verification

- `bun typecheck` and `bun test` in `packages/tui` on `model-id-land`:
  277 pass, 1 skip, 0 fail. `test/util/model.test.ts` covers both labels and
  nested model IDs; `test/config.test.tsx` covers decoding.
- Full-repo pre-push typecheck: 30/30 on `tui-model-id` and `dev-nowaker`
  with the ambient `~/node_modules` masked (see the session record).
- Manual surface: isolated `XDG_*` and tool/plugin data dirs, throwaway tmux
  socket `oc-tui-model-id`, two OpenAI-compatible providers `qa-alpha` and
  `qa-beta` serving "QA Model" with streamed reasoning. Vanilla and
  `"name"`: both footers `▣  Build · QA Model`, prompt
  `Build · QA Model QA Beta · high`. `"id"`: footers
  `▣  Build · qa-alpha/qa-model · 4.9s` and `▣  Build · qa-beta/qa-model ·
  148ms`, prompt `Build · qa-beta/qa-model · high`. On `model-id-land` with
  `turn_timing` on: `▣  Build · qa-beta/qa-model · 8:05 PM · 467ms · 507ms
  total`.

## Timeline

- 2026-10-07
  [`ses_ee68aab01ffei41gwUGJ5ESj6W`](../sessions/2026-10-07-tui-footer-elements.md)
  - `1ca196f2b2`: tui.mdx gains the missing `model_label` entry; the model is the `model` entry of `details()`. Re-verified with `model_label: "id"` captures.

- 2026-10-06
  [`ses_eec44cf7effeFCqQefM0NkWLaW`](../sessions/2026-10-06-tui-model-label.md)
  - `66ce641060`: introduce; upstream issue #53638 and PR #53639; build and
    install on desktop and m4max, `"id"` set in their `tui.json`.

## Current maintenance notes

- Drop the fork commit once PR #53639 (or an equivalent) is in upstream `dev`.
- Host setting: `"model_label": "id"` in `~/.config/opencode/tui.json` on
  desktop and m4max.

### Upstream integration checklist

- Confirm the `AssistantMessage` footer and the prompt model indicator still
  go through `Model.label` / `currentModelID`, and look for any new place that
  shows a model's display name.
- Run `test/util/model.test.ts`, `test/config.test.tsx` and `bun typecheck`
  in `packages/tui`.
- Build through `.vibeterm/build.sh`; footers read `provider/model`.
- Link a new timeline row to the current session record.

## Supersession or removal

- Not applicable; status is active.
