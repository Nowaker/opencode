# TUI transcript text clicks

## Identity

- Status: active
- Source integration branches: `dev-nowaker` (v1), `v2-nowaker` (native v2)
- Development branches: `chat-text-click-v1`, `chat-text-click-v2`
- First local commits: `7501798137` (v1), `53bc22b963` (v2)
- Current local commits: `c2e3ac71e6` (v1), `2c000ae41b` (v2)
- Fork bases: `2404423cda` (v1), `f16dced8fc` (v2)

## Behavior

- `api.click.onText(handler)` offers a plain left click on a session transcript, before ordinary row actions. Only a synchronous `true` takes the click. Plugins receive `{ text, column, href?, sessionID? }`, with `column` measured in display cells.
- Where OpenTUI exposes logical-line metadata, a wrapped visual row resolves to its full logical line and the corresponding column. Custom renderables fall back to a rendered row bounded by the hit renderable and marked `rowOnly: true`; ambiguous native cell positions decline instead of reporting a shifted column. An explicit OSC 8 href comes from the clicked cell independently of its display label.
- The hook does not scan or open paths. Vibeterm owns URI parsing, validation, and destination routing. A declined click still reaches OpenCode's usual action; a drag, modified click or selection is not offered as a plain click.

## Stable seams

| Engine | Plugin surface | Pointer and renderer seam |
|---|---|---|
| v1 | `packages/plugin/src/tui.ts` and `packages/opencode/src/plugin/tui/runtime.ts` | `packages/tui/src/ui/text-click.ts`, session row handlers, and the OpenTUI 0.4 rendered cell's link ID and Bun link pool |
| native v2 | `packages/plugin/src/tui/context.ts` and `packages/tui/src/plugin/api.tsx` | `packages/tui/src/ui/text-click.ts`, session row handlers, and `renderer.getLinkAt` before the app's ordinary link opener |

## Timeline

- 2026-11-21 [Session record](../sessions/2026-11-21-tui-transcript-text-clicks.md) ([`ses_dfed6cbf8ffeMc348W81QcJloM`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_dfed6cbf8ffeMc348W81QcJloM)) - introduced matching transcript hooks on both engines. The rendered regressions cover a wrapped bare URI, a wide-character prefix, an explicit href, decline, drag and modifier behavior.
