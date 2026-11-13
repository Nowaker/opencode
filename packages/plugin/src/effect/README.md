# OpenCode V2 Effect Plugin API

The Effect plugin API grants plugins two in-process capabilities:

- `hook` installs behavior at an OpenCode extension point.
- `reload` reruns every transform hook for a stateful domain.

## Defining A Plugin

```ts
import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "example",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((editor) => {
      editor.update("example", (provider) => {
        provider.name = "Example"
      })
    })
  }),
})
```

Plugin setup registers hooks imperatively through each domain's `hook` method.

Configuration supplied for the plugin is available as `ctx.options`.

The fork advertises `ctx.app.capabilities?.pluginConfiguration` and `/api/info` `capabilities.pluginConfiguration` for the experimental configuration stage. Register during setup with `yield* ctx.config.configure((draft) => Effect.sync(() => { draft.default_agent = "reviewer" }))`. Activation finishes external setup before running these callbacks sequentially and awaiting their Effects, then loads the native configuration consumers. The mutable draft contains resolved document values in native fields such as `providers`, `agents`, `commands`, and the object-valued `model` selection. Each pass starts fresh, edits override loaded configuration, and `plugins` cannot be changed from this stage.

Each callback runs in a child of its activation scope. A new pass disposes the previous callback scope, unloading removes its edits, and callback failure disables the owning plugin without committing partial draft changes. Source reload commits the configured view and refreshes native consumers before readiness releases. Unchanged document paths keep their original resolution base; callback-supplied paths resolve from the location directory. Deletion removes a configured command across source layers and discovered Markdown declarations. Registrations may also be removed early through `dispose`.

Registrations are owned by the plugin scope. Closing the scope removes them automatically; a registration may also be removed early through `dispose`.

## Transform Hooks

Transform hooks contribute to stateful domains. Their editor callbacks are
synchronous, so load effectful data before registering a transform or reloading
its domain:

```ts
yield *
  ctx.agent.transform((agent) => {
    agent.update("reviewer", (item) => {
      item.description = "Reviews code for regressions"
      item.mode = "subagent"
    })
  })
```

Registry reads rebuild synchronously when registrations changed, applying every transform in registration order to a fresh value; unchanged registries return the previous value. Values read earlier are never mutated. Notifications and resource reconciliation run separately from that materialization.

Available transform hooks are namespaced by domain:

```ts
ctx.agent.transform
ctx.command.transform
ctx.integration.transform
ctx.mcp.transform
ctx.model.transform
ctx.provider.transform
ctx.reference.transform
ctx.skill.transform
ctx.tool.transform
ctx.vcs.transform
ctx.websearch.transform
```

Provider transforms contribute provider settings and immutable model definitions. After provider availability is resolved,
model transforms edit the complete active-provider candidate collection in order. Use `ctx.model.transform` for runtime
model restrictions; `editor.provider.get()` reads source templates even when their provider is inactive.

```ts
Effect.gen(function* () {
  yield* ctx.model.transform((editor) => {
    editor
      .list()
      .filter((model) => model.cost.some((tier) => tier.output > 20))
      .forEach((model) => {
        editor.remove(model.providerID, model.id)
      })
  })
})
```

## Runtime Hooks

Runtime hooks intercept live operations rather than rebuilding domain state:

```ts
yield *
  ctx.aisdk.hook(
    "sdk",
    Effect.fn(function* (event) {
      if (event.package !== "@ai-sdk/xai") return
      const mod = yield* Effect.promise(() => import("@ai-sdk/xai"))
      event.sdk = mod.createXai(event.options)
    }),
  )

yield *
  ctx.aisdk.hook("language", (event) =>
    Effect.sync(() => {
      if (event.model.providerID !== "xai") return
      event.language = event.sdk.responses(event.model.modelID)
    }),
  )
```

Hooks run sequentially in registration order. Later hooks observe mutations made by earlier hooks.

The experimental [compaction summary lifecycle](../README.md#runtime-hooks) applies to both SDKs. Register `ctx.session.hook("compaction", callback)` to freeze metadata, project `previousSummary` or set `stopSequences`; register `ctx.session.hook("experimental.compaction.summary", callback)` to finalize mutable `text` and `metadata` before durable publication. Effect callbacks are awaited and defects fail compaction while preserving recorded generation usage. Test `ctx.app.capabilities?.compactionSummary` before relying on this contract.

Session context is mutable immediately before provider dispatch:

`ctx.session.context({ sessionID })` reads the compacted model-visible window. `ctx.session.messages({ sessionID, type: "assistant", order: "desc", limit: 50 })` reads durable messages with the same input and output as `client.message.list`, including successful tool-result metadata retained before compaction. Follow `cursor.next` or `cursor.previous` with the same type filter and without `order`; the cursor carries the ordering. Reading messages does not admit input or wake the session. Hosts advertise this method with `ctx.app.capabilities?.sessionMessages` and `GET /api/info` `capabilities.sessionMessages`.

`yield* ctx.session.fork({ sessionID, before? })` exposes the ordinary Session API fork operation. It copies settled history into an independent session, with `before` selecting an exclusive message boundary. This operation has the same errors and inheritance as the HTTP Session API; native subagent `fork: true` additionally retains child ownership and restricts copied history to the parent's current context. Detect native fork, notice and timed foreground handoff support with `ctx.app.capabilities?.subagentOptions`.

`yield* ctx.session.cancelChild({ parentID, sessionID })` uses the [experimental child cancellation contract](../../../../README.md#installation). Check `ctx.app.capabilities?.childCancellation` before using it with an older host. Only `status: "cancelled"` confirms a settled stop; handle `terminal`, `requested`, and `unsupported` explicitly.

With `ctx.app.capabilities?.jobControl`, use `yield* ctx.job.list({ parentSessionID, descendants: true })` to read `{ data: Job.Info[] }`, or omit `descendants` for direct ownership. `yield* ctx.job.cancel({ parentID, jobID })` follows the [native Job cancellation contract](../../../../README.md#installation) for directly owned shell and image Jobs. Subagents use `ctx.session.cancelChild`.

The [native form controls](../README.md#runtime-hooks) apply to both SDKs. When `ctx.app.capabilities?.formControl` is true, use `yield* ctx.form.list({ sessionID })`, `yield* ctx.form.get({ sessionID, formID })`, `yield* ctx.form.reply({ sessionID, formID, answer })` or `yield* ctx.form.cancel({ sessionID, formID, message })`. Omit list's input to read every pending form in the current Location. Effect results retain the canonical native Form types and raw result shapes.

With `ctx.app.capabilities?.jobResults`, `yield* ctx.job.result({ parentID, jobID, wait: true })` returns the raw native Job identity/state plus available `output` and `error` strings. Omit `wait` for a current nonblocking read. The persisted parent/recovery owner is checked first. Interrupting this Effect stops only the reader, leaving the independent Job running. Native retention and unsupported local waiting follow the [result contract](../../../../README.md#installation); reading does not acknowledge completion notices.

```ts
yield *
  ctx.session.hook("context", (event) =>
    Effect.sync(() => {
      event.tools.read.description = "Read a file using narrow line ranges."
      delete event.tools.write
    }),
  )

yield *
  ctx.session.hook("retry", (event) =>
    Effect.sync(() => {
      if (event.attempt >= 3) event.decision = { retry: false }
    }),
  )
```

When a Session finishes model work with no pending input, the `experimental.idle` hook runs just before it goes idle.
It is experimental: its name and shape may still change. It does not run after interruption, failure, or control-only
work such as a manual compaction. Input the hook admits runs in the same execution instead of the Session going idle,
so a plugin that always admits input must bound its own loop.

`event.background` lists background shells and subagents still running for the Session or its descendants. When one of
the Session's own shells or subagents finishes, its notice wakes the Session and the hook runs again, so a plugin that
waits for that work can return. Work a descendant owns, such as a shell a subagent left running, wakes that
descendant instead, so it is listed for information only. Notices admitted with `resume: false`, such as those
recovered after a restart, wait for the next wake instead:

```ts
yield *
  ctx.session.hook("experimental.idle", (event) =>
    event.background.some((work) => work.kind === "subagent" && work.sessionID === event.sessionID)
      ? Effect.void
      : ctx.session
          .synthetic({ sessionID: event.sessionID, text: "Run the tests and fix any failures." })
          .pipe(Effect.ignore),
  )
```

A continuation runs inside the same execution, so a loop that is still going when the server restarts is resumed by
restart recovery and the hook keeps running. Persist your own state if the loop should come back paused. A hook that
fails, fails the execution like any other session hook, so handle errors from slow or remote work such as a judge model
call.

## Reloading A Domain

When data captured by a transform changes, reload the affected domain:

```ts
Effect.gen(function* () {
  const source = { providers: yield* loadProviders() }

  yield* ctx.provider.transform((editor) => {
    source.providers.forEach((provider) => editor.add(provider))
  })

  source.providers = yield* loadProviders()
  yield* ctx.provider.reload()
})
```

`loadProviders()` returns entries shaped as `{ info: Provider.Info, models: readonly Model.Info[] }`. Provider reloads
also invalidate the active model result, so every model transform runs again with the refreshed definitions. Model
callbacks edit raw overrides; provider defaults are merged once when the result is committed.

Available reload operations are:

```ts
ctx.agent.reload()
ctx.command.reload()
ctx.integration.reload()
ctx.mcp.reload()
ctx.model.reload()
ctx.provider.reload()
ctx.reference.reload()
ctx.skill.reload()
ctx.tool.reload()
ctx.vcs.reload()
ctx.websearch.reload()
```
