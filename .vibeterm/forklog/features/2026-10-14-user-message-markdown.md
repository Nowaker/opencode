# Markdown in submitted user messages and plugin-defined message blocks

## Identity

- Status: active
- Integration branch: `dev-nowaker`
- Development branch(es): `message-syntax` (worktree off `dev-nowaker`);
  upstream branches `message-markdown` (`9de106cb26`, stacked on
  `tool-output-syntax`) and `message-blocks` (`2c659ccfe6`, stacked on
  `message-markdown`), off `github/v1` `dfb56f76c7`
- First local commit: `5e5994b93a`
- Current local commit(s): `5e5994b93a`, `748601cc2b`
- Upstream base when introduced: `dfb56f76c7` (upstream `v1`, `v1.19.0`)
- Last checked against upstream: `dfb56f76c7`
- Upstream: issues [#55439](https://github.com/anomalyco/opencode/issues/55439),
  [#55440](https://github.com/anomalyco/opencode/issues/55440); PRs
  [#55441](https://github.com/anomalyco/opencode/pull/55441) (markdown, stacked
  on #54968) and [#55442](https://github.com/anomalyco/opencode/pull/55442)
  (blocks, stacked on #55441), both against `v1`. **Needs a v2 port later.**

## Original request

Relayed by coordinator `ses_ef8235798ffejGr4sa22eXmVNv` (item 37), the user
verbatim:

> i want syntax coloring of user already submitted messafges. it doesn't (and
> can't) be as good as ai messages because we humans type botched syntax, but we
> can probably fire opencode's md colorizer at it, to colorize: 1. ble 2. blah
> (or - bullet points) wherever they show up. or colorize `content in ticks`. or
> colorize #headers of various level. maybe even try tables?
> and for vibeterm specicially needed real bad, and to be proposed as separate PR
> with hopes they wil accept, we'd like to define custom formatters, or whatever
> to call it (if not possible today, who knows?) - speciafaclly, i need us to
> catch any
> [vibterm_*]
> ...
> [/vibeterm_*]
> and render it with our standard yaml colors/formatting.

## Goals

- `syntax.user_messages` (default `false`, as upstream) colors the markdown in a
  submitted user message: headings, lists, inline and fenced code, emphasis,
  links, quotes, tables.
- Only colors change: text as typed, wraps as plain, nothing concealed, no red.
- Accidental markdown stays plain: setext headings, indented code, lazy quote
  continuation, intra-word emphasis.
- A plugin (`api.blocks.register`) or `syntax.blocks` defines a delimited block
  and its format; `yaml` uses the tool input block's colors.
- Vibeterm's `[vibeterm_*]` blocks draw as YAML through the `vibeterm.route`
  plugin, with no tui.json entry.

## Non-goals

- Assistant text: it goes through `<markdown>`, which has no per-range hook.
- Rendering markdown (concealment, reflow) in user messages.

## Rationale and constraints

- The tree-sitter markdown grammar already in opentui gives highlights on the
  raw text; setting them as chunks on one text renderable (`StyledOutput`, from
  #54968) keeps layout identical, where `<markdown>` would reflow and conceal.
- Upstream PR B does not depend on #54707: it keeps its own `YamlKind` and
  `yamlColors`; the fork shares one `toolInputColors` between the tool input
  block and YAML blocks.

## Changes

| Commit | Workday | Change | Stable seam |
|---|---|---|---|
| `5e5994b93a` | 2026-10-14 | `syntax.user_messages`; forgiving markdown highlights over user text; markdown slots in the non-red palette | `UserText` in `routes/session/index.tsx`; `util/user-markdown.ts` `forgivingMarkdown`; `ALTERNATIVES` in `theme/tool-code.ts`; `Syntax` in `config/index.tsx` |
| `748601cc2b` | 2026-10-14 | `syntax.blocks`, `api.blocks.register`, yaml formatter; `toolInputColors` shared with `GenericTool` | `util/message-blocks.ts` `messageSegments`, `yamlSegments`; `messageChunks` in `routes/session/index.tsx`; `TuiMessageBlock` in `packages/plugin/src/tui.ts`; `registerBlock` in `plugin/runtime.tsx`; `blocks` in `opencode/src/plugin/tui/runtime.ts` |

opencode-tools `0497c41`: `opencode-vibeterm-route-plugin/message-blocks.ts`
registers `[vibeterm_*]` / `[/vibeterm_*]` / `yaml`.

Docs: `user_messages` and `blocks` under `Syntax highlighting` in
`packages/web/src/content/docs/tui.mdx`.

## Verification

Reported by `ses_ec57be11affe3kxXJ4WyM3OwOY`; see its
[session record](../sessions/2026-10-14-user-message-markdown.md).

## Timeline

- 2026-10-14 [`ses_ec57be11affe3kxXJ4WyM3OwOY`](../sessions/2026-10-14-user-message-markdown.md) -
  initial build of both parts, Vibeterm route plugin rule, upstream issues and
  PRs, install on both hosts, `syntax.user_messages` enforced on both hosts.
  Evidence: `5e5994b93a`, `748601cc2b`; PTY at 80/160.

## Current maintenance notes

- The upstream branches carry no AI trailers; the fork commits do.
- Fork vs upstream B: `toolInputColors` + `ToolInputKind` (fork, from #54707)
  vs `yamlColors` + `YamlKind` (upstream). Whichever of #54707 and #55442 lands
  second merges them.
- `syntax.blocks` is an array of objects, so the opencode-tools knob catalog
  does not list it; `syntax.user_messages` is a global-only knob there
  (opencode-tools `a42e4c6`).
