# TUI transcript text clicks

## Behavior

- A plain left click on transcript text offers `click.onText(handler)` a display-cell column, the session ID, the logical line when available, and any OSC 8 target under the pointer. A synchronous `true` claims the click before the ordinary row action; unclaimed clicks retain that action. Drags, selections and modified clicks are not offered.
- A renderable without logical-line metadata can supply a visible row marked `rowOnly: true`. If the row cannot be aligned with the native cells, OpenCode declines the hit. Vibeterm owns URI parsing and opening, including distinguishing a complete file URI from a visibly truncated fragment. The fork has no Vibeterm dependency and does not rewrite messages.

## Source changes

| Change | `dev-nowaker` (v1) | `v2-nowaker` (native v2) |
|---|---|---|
| Offer transcript clicks to TUI plugins, with logical-line and explicit href lookup | `7501798137e0666a4f0cf15e2c08e9bbe6ee1c14` | `53bc22b96390f8aa95ba7ba65be7af31df6845bd` |
| Mark incomplete rows, recover Unicode, check modifiers on press and release, dispose click handlers on activation end, and offer hits before Redo | `a9be0fb1addd049006b66679207272e52d137b50` | `3afa6391dbfa453f49ec61478e89fcd119b8b656` |
| Decline fallback hits when flattened graphemes disagree with native cell placement; regressions cover refolded regional indicators in v1 and soft-hyphen width in v2 | `c2e3ac71e6fbe41dd1da209f2786b5d9446e773d` | `2c000ae41b64d9c1d38bec666e7b082170fe9546` |

The owning seam is `packages/tui/src/ui/text-click.ts` and the session row handlers on both lines. v1 exposes the hook through `packages/plugin/src/tui.ts` and `packages/opencode/src/plugin/tui/runtime.ts`, and resolves hrefs from OpenTUI 0.4's cell link ID and Bun link pool. Native v2 exposes it through `packages/plugin/src/tui/context.ts` and `packages/tui/src/plugin/api.tsx`, and reads the href from `renderer.getLinkAt` before default link handling.

## Timeline and verification

- 2026-11-21 [Session record](../sessions/2026-11-21-tui-transcript-text-clicks.md), [`ses_dfed6cbf8ffeMc348W81QcJloM`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_dfed6cbf8ffeMc348W81QcJloM): source delivery and desktop verification, with later m4max install evidence distinguished from end-to-end coverage.
- 2026-11-25: carried the existing `master-nowaker` record `be62904314` forward under the same paths on `dev-nowaker` and indexed all six exact source SHAs. Documentation only; no source, build, configuration or runtime change.
