# `@opencode/plugin`

Authoring interfaces and runtime loader support for OpenCode V2 plugins:

- `@opencode/plugin` — [Promise plugin API](./src/README.md)
- `@opencode/plugin/effect` — [Effect plugin API](./src/effect/README.md)
- `@opencode/plugin/rpc` — portable RPC contract definitions
- `@opencode/plugin/tui` — terminal UI plugin API

## TUI composer observation

`ctx.ui.composer` optionally exposes the selected, mounted final native composer. `current()` is reactive in Solid and `subscribe(listener)` synchronously emits current state, then changes. Its returned disposer is idempotent; component cleanup, plugin deactivation and TUI teardown end subscriptions. The API only observes input.

`ComposerObservation` is either `{ status: "ready", kind: "final", sessionID, draft }` or `{ status: "unavailable", reason }`. A ready `sessionID: null` means the final Home composer. Reasons are `unsupported` (an older host lacks the domain), `not-selected` (the route has no composer), `not-mounted` (the selected final composer is absent or still adopting startup input) and `disposed` (the API's lifetime ended). The early startup editor and focused form/question inputs never replace the selected final composer.

`ComposerDraft` retains exact `text`, optional native `files` (including local `path`), `agents`, `skills`, `pasted`, `mode`, `caret` and directional `selection: { anchor, focus }`. Snapshots are detached and deeply readonly. Caret, selection, mention and pasted-source ranges use native edit-buffer display offsets: cells measured with the renderer's width method, tab width and control notation, plus one per line break. These are not UTF-16 indices or UTF-8 byte offsets; wide graphemes, tabs and controls may span several cells. A collapsed selection has `anchor === focus === caret`.

```ts
import type { ComposerObservation } from "@opencode/plugin/tui"

const observation: ComposerObservation = ctx.ui.composer?.current() ?? {
  status: "unavailable",
  reason: "unsupported",
}
```

## Packaging And Runtime `effect`

When the OpenCode CLI loads server or TUI plugins, it resolves imports of `effect`, exported `effect/*` subpaths, and `@opencode/plugin` entrypoints (including imports from dependencies inside a plugin's `node_modules`) to the host's runtime module instances so fibers, loggers, and `Schema` parsers share one copy.

- Declare `"effect": "^4.0.0"` as a `peerDependency` (and `devDependency` for local type-checking and testing) rather than a bundled runtime dependency.
- Do not bundle `effect` into published plugin files; if you build with a bundler, keep `effect` and `effect/*` external. Two copies of `effect` do not share fiber, logger, or `Schema` internals.
- Plugins and their `node_modules` dependencies always receive OpenCode's host `effect` instance. Use `effect` APIs and module paths compatible with the OpenCode release you target; dependencies built on another `effect` major (such as Effect 3) are not supported.
- Only public `effect` subpaths are provided. A plugin that imports one of Effect's private `internal` modules fails to load with an error naming the path.
- The compiled OpenCode binary does not include the Scalar and Swagger UI assets used by Effect's HTTP API docs pages; serving those pages from a plugin shows a notice instead.
