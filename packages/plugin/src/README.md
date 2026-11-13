# OpenCode V2 Promise Plugin API

The Promise plugin API at `@opencode/plugin` is the async/await equivalent of `@opencode/plugin/effect`. It grants plugins the same two in-process capabilities:

- `hook` installs behavior at an OpenCode extension point.
- `reload` reruns every transform hook for a stateful domain.

The Promise API uses Promises instead of Effects for setup, runtime hook
callbacks, hook registration, `reload`, and `Registration.dispose`. Transform
editor callbacks remain synchronous.

## Defining A Plugin

```ts
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "example",
  setup: async (ctx) => {
    await ctx.provider.transform((editor) => {
      editor.update("example", (provider) => {
        provider.name = "Example"
      })
    })
  },
})
```

Plugin setup registers hooks imperatively through each domain's `hook` method.
It may return a synchronous or asynchronous cleanup function. OpenCode awaits
the cleanup when the plugin is unloaded or replaced:

```ts
setup: async (ctx) => {
  const timer = setInterval(refresh, 60_000)
  return () => clearInterval(timer)
}
```

Configuration supplied for the plugin is available as `ctx.options`.

The fork advertises `ctx.app.capabilities?.pluginConfiguration` and `/api/info` `capabilities.pluginConfiguration` for the experimental configuration stage. Register during setup with `await ctx.config.configure(async (draft) => { draft.default_agent = "reviewer" })`. Registration does not invoke the callback: activation first finishes external setup, then awaits callbacks sequentially before native configuration consumers load. Every pass starts from resolved document values, so edits override loaded configuration without accumulating across reloads. The draft uses native fields such as `providers`, `agents`, `commands`, and the object-valued `model` selection; it does not include runtime catalog defaults or legacy v1 aliases. Changing `plugins` is rejected because that list determines activation itself.

The registration and any domain registrations made inside its callback belong to that activation. A new pass disposes the previous callback scope, unloading removes its edits, and a failed callback disables its owning plugin and discards its partial draft. Source reload commits the configured view and refreshes native consumers before activation readiness releases. Unchanged source-relative paths retain their document origin; paths supplied by a callback use the location directory. Deleting a configured command prevents an earlier declaration from reappearing, including one discovered from Markdown. Plugins using no configuration callbacks keep their ordinary loaded configuration.

A registration may be removed early through `dispose`:

```ts
const registration = await ctx.model.transform(applyModelPolicy)
await registration.dispose()
```

## Transform Hooks

Transform hooks contribute to stateful domains. The editor is synchronous,
so load asynchronous data before registering a transform or reloading its domain:

```ts
const description = await loadReviewerDescription()

await ctx.agent.transform((agent) => {
  agent.update("reviewer", (item) => {
    item.description = description
    item.mode = "subagent"
  })
})
```

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
await ctx.model.transform((editor) => {
  editor
    .list()
    .filter((model) => model.cost.some((tier) => tier.output > 20))
    .forEach((model) => {
      editor.remove(model.providerID, model.id)
    })
})
```

## Runtime Hooks

Runtime hooks intercept live operations:

```ts
await ctx.aisdk.hook("sdk", async (event) => {
  if (event.package !== "@ai-sdk/xai") return
  const mod = await import("@ai-sdk/xai")
  event.sdk = mod.createXai(event.options)
})

await ctx.aisdk.hook("language", (event) => {
  if (event.model.providerID !== "xai") return
  event.language = event.sdk.responses(event.model.modelID)
})
```

Session context is mutable immediately before provider dispatch:

Hosts advertising `ctx.app.capabilities?.compactionSummary` and `/api/info` `capabilities.compactionSummary` support the experimental summary lifecycle. The existing `compaction` hook receives `event.compaction`: an attempt `generationID`, the foreground `messageID` (absent for speculative generation), reason, inclusive source `boundaryID`, replaced message IDs, `keepID`, exact serialized `retainedMessages`, conversation model and `native` flag. `event.model` identifies the summarizer. Set `previousSummary` to project the prior narrative without changing its stored history, `stopSequences` to suppress generated boundaries before deltas, and `metadata` to carry a frozen snapshot to completion. A stopped stream still drains final usage. Empty stopped output fails compaction.

`experimental.compaction.summary` is awaited once after textual generation or a supplied textual result, before `session.compaction.ended` and durable projection. It exposes the attempt ID, actual compaction message ID, generating model, source cutoff and current retained tail; mutate `text` and `metadata` to finalize the saved summary. A thrown or rejected callback fails the compaction with recorded usage retained. For precomputed summaries, preparation runs against the original cutoff and completion runs only on adoption with the adopting message ID and reason; use the frozen metadata rather than rereading newer history. Native encrypted replacement windows skip textual completion; a plugin requiring plaintext retention must reject `event.compaction.native` in preparation. Without registered compaction hooks, existing request shaping is unchanged.

`ctx.session.context({ sessionID })` reads the compacted model-visible window. `ctx.session.messages({ sessionID, type: "assistant", order: "desc", limit: 50 })` reads durable messages with the same input and output as `client.message.list`, including successful tool-result metadata retained before compaction. Follow `cursor.next` or `cursor.previous` with the same type filter and without `order`; the cursor carries the ordering. Reading messages does not admit input or wake the session. Hosts advertise this method with `ctx.app.capabilities?.sessionMessages` and `GET /api/info` `capabilities.sessionMessages`.

`ctx.session.fork({ sessionID, before? })` exposes the ordinary Session API fork operation. It copies settled history into an independent session, with `before` selecting an exclusive message boundary. This operation has the same errors and inheritance as the HTTP Session API; native subagent `fork: true` additionally retains child ownership and restricts copied history to the parent's current context. Detect native fork, notice and timed foreground handoff support with `ctx.app.capabilities?.subagentOptions`.

`await ctx.session.cancelChild({ parentID, sessionID })` uses the [experimental child cancellation contract](../../../README.md#installation). Check `ctx.app.capabilities?.childCancellation` before using it with an older host. Only `status: "cancelled"` confirms a settled stop; handle `terminal`, `requested`, and `unsupported` explicitly.

With `ctx.app.capabilities?.jobControl`, use `await ctx.job.list({ parentSessionID, descendants: true })` to read `{ data: Job.Info[] }`, or omit `descendants` for direct ownership. `await ctx.job.cancel({ parentID, jobID })` follows the [native Job cancellation contract](../../../README.md#installation) for directly owned shell and image Jobs. Subagents use `ctx.session.cancelChild`.

With `ctx.app.capabilities?.formControl`, `await ctx.form.list()` returns the current Location's pending native forms as a raw array; pass `{ sessionID }` to filter by owner. `await ctx.form.get({ sessionID, formID })` returns raw `Form.Detail`, including its native state. `await ctx.form.reply({ sessionID, formID, answer })` and `await ctx.form.cancel({ sessionID, formID, message })` return void; the cancellation message is optional. Use native `frm_` IDs and `Form.Answer` records keyed by field name, including `q0`, `q1` for native questions. Each get, reply and cancel verifies the form's actual session owner; mismatched owners and missing forms fail with `Form.NotFoundError`. Invalid answers leave the form pending and fail with `Form.InvalidAnswerError`; repeated settlement fails with `Form.AlreadySettledError`. Settled details remain readable for the native ten-minute retention period and leave pending lists immediately. `GET /api/info` advertises the same optional `formControl` capability.

With `ctx.app.capabilities?.jobResults`, `await ctx.job.result({ parentID, jobID, wait: true }, { signal })` returns the raw native Job identity/state plus available `output` and `error` strings. Omit `wait` for a current nonblocking read. Ownership is checked before capture or waiting; only a matching local execution supports waiting on a running Job. Aborting the read rejects with the normal Effect adapter interruption error while the Job continues. Results use native retention; a consumed/missing result is not found, and this read does not acknowledge completion notices. See the [native result contract](../../../README.md#installation).

```ts
await ctx.session.hook("context", (event) => {
  event.tools.read.description = "Read a file using narrow line ranges."
  delete event.tools.write
})

await ctx.session.hook("retry", (event) => {
  if (event.attempt >= 3) event.decision = { retry: false }
})
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
await ctx.session.hook("experimental.idle", async (event) => {
  if (event.background.some((work) => work.kind === "subagent" && work.sessionID === event.sessionID)) return
  await ctx.session.synthetic({ sessionID: event.sessionID, text: "Run the tests and fix any failures." })
})
```

A continuation runs inside the same execution, so a loop that is still going when the server restarts is resumed by
restart recovery and the hook keeps running. Persist your own state if the loop should come back paused. A hook that
fails, fails the execution like any other session hook, so handle errors from slow or remote work such as a judge model
call.

Promise tools use complete executable tool values with async executors:

```ts
import { Schema } from "effect"

await ctx.tool.transform((tools) => {
  tools.add({
    name: "echo",
    options: { codemode: false },
    description: "Echo text",
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: async ({ text }) => ({ output: { text }, content: text }),
  })
})
```

## Reloading A Domain

When data captured by a transform changes, reload the affected domain:

```ts
const source = { providers: await loadProviders() }

await ctx.provider.transform((editor) => {
  source.providers.forEach((provider) => editor.add(provider))
})

source.providers = await loadProviders()
await ctx.provider.reload()
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
