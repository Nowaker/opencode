import assert from "node:assert/strict"
import path from "node:path"
import { CliRenderEvents, TextareaRenderable } from "@opentui/core"
import { createEffect } from "solid-js"
import { takeDraft } from "../../src/component/prompt/draft-stash"
import { useData } from "../../src/context/data"
import { useLocal } from "../../src/context/local"
import { useLocation } from "../../src/context/location"
import { usePromptRef } from "../../src/context/prompt"
import { modelPreferenceKey } from "../../src/model-preference"
import { awaitSignal, catalogClient, type CatalogDefault, type CatalogOutcome } from "./catalog-client"
import { mountComposer } from "./composer"
import { tmpdir } from "./fixture"

export const draftText = "catalog draft"
export const waitingForModels = /wait(?:ing|s)? .*model (?:list|catalog)|model (?:list|catalog) .*load/i
export const catalogError =
  /failed to send prompt|connect an integration to send prompts|(?:fail|error|unavailable).*?(?:model|agent|catalog)|(?:model|agent|catalog).*?(?:fail|error|unavailable|not found|not available)|\bno (?:usable )?(?:models?|agents?)\b/i
export const homeBoundSelection = /\bBuild\b.*\bintended\b.*\blow\b/i
export const frameText = (frame: string) => frame.replace(/\s+/g, " ").trim()
const preferenceOrder: Readonly<Record<CatalogDefault, readonly string[]>> = {
  cli: ["alternate", "intended"],
  configured: ["alternate", "intended"],
  recent: ["intended", "alternate"],
}

export async function mountCatalogSubmit(
  input: {
    readonly home?: boolean
    readonly source?: CatalogDefault
    readonly rejectPrompt?: boolean
    readonly width?: number
    readonly gate?: "models" | "metadata"
    readonly prompt?: string
  } = {},
) {
  takeDraft(undefined)
  const root = await tmpdir()
  const wire = catalogClient(input)
  const owned: { app?: Awaited<ReturnType<typeof mountComposer>> } = {}
  async function dispose() {
    if (owned.app && !owned.app.renderer.isDestroyed) owned.app.renderer.destroy()
    wire.release()
    try {
      await owned.app?.[Symbol.asyncDispose]()
    } finally {
      await root[Symbol.asyncDispose]()
    }
  }
  try {
    await Bun.write(
      path.join(root.path, "model.json"),
      JSON.stringify({
        recent: preferenceOrder[input.source ?? "recent"].map((modelID) => ({ providerID: "provider", modelID })),
        variant: { [modelPreferenceKey({ providerID: "provider", modelID: "intended" })]: "low" },
      }),
    )
    const setup = await mountComposer({
      state: root.path,
      args: {
        ...(input.home
          ? input.source === "cli"
            ? { model: "provider/intended" }
            : {}
          : { sessionID: "ses_observation_a" }),
        prompt: input.prompt,
      },
      config: { animations: false, tabs: { mode: "off" } },
      fetch: wire.fetch,
    })
    owned.app = setup
    wire.capture(() => frameText(setup.captureCharFrame()))
    const mounted = Promise.withResolvers<{
      readonly local: ReturnType<typeof useLocal>
      readonly data: ReturnType<typeof useData>
      readonly location: ReturnType<typeof useLocation>
      readonly prompt: ReturnType<typeof usePromptRef>
    }>()
    const preferences = Promise.withResolvers<void>()
    setup.context.ui.slot({
      append: "app",
      render: () => {
        const local = useLocal()
        mounted.resolve({ local, data: useData(), location: useLocation(), prompt: usePromptRef() })
        createEffect(() => {
          if (local.model.ready) preferences.resolve()
        })
        return null
      },
    })
    const observed = await awaitSignal(mounted.promise)
    await awaitSignal(preferences.promise)
    await awaitSignal(wire.requested)
    if (input.width) setup.resize(input.width, 35)
    await setup.waitForFrame(() => {
      const editor = setup.renderer.currentFocusedEditor
      return (
        setup.composer.current().status === "ready" &&
        editor instanceof TextareaRenderable &&
        editor.focused &&
        editor.width > 0 &&
        editor.height > 0
      )
    })
    return {
      ...setup,
      ...observed,
      wire,
      draft() {
        const current = setup.composer.current()
        assert.equal(current.status, "ready")
        return current.draft
      },
      async arm(text = draftText) {
        setup.renderer.stdin.emit("data", Buffer.from(`${text}\r`))
        await setup.waitForFrame((frame) => waitingForModels.test(frameText(frame)))
      },
      cleared() {
        return setup.waitForFrame(() => {
          const current = setup.composer.current()
          return current.status === "ready" && current.draft.text === ""
        })
      },
      bound(action?: () => void) {
        const published = Promise.withResolvers<void>()
        const inspect = () => {
          if (!observed.local.model.catalogReady || observed.local.agent.list().length === 0) return
          const visible = frameText(setup.captureCharFrame())
          if (!waitingForModels.test(visible)) return
          if (!(input.home ? homeBoundSelection : /\bPlan\b.*\bintended\b.*\blow\b/i).test(visible)) return
          setup.renderer.off(CliRenderEvents.FRAME, inspect)
          try {
            action?.()
            published.resolve()
          } catch (error) {
            published.reject(error instanceof Error ? error : new Error(String(error)))
          }
        }
        // User choices in the published frame must run before the intent's consumption callback.
        setup.renderer.prependListener(CliRenderEvents.FRAME, inspect)
        return awaitSignal(published.promise).finally(() => setup.renderer.off(CliRenderEvents.FRAME, inspect))
      },
      async release(outcome: CatalogOutcome = "ready") {
        wire.release(outcome)
        return Promise.allSettled([
          setup.context.data.location.agent.sync(observed.location.ref),
          setup.context.data.location.model.sync(observed.location.ref),
        ])
      },
      async refresh(outcome: CatalogOutcome = "ready") {
        wire.release(outcome)
        setup.context.data.location.agent.invalidate(observed.location.ref)
        setup.context.data.location.model.invalidate(observed.location.ref)
        return Promise.allSettled([
          setup.context.data.location.agent.sync(observed.location.ref),
          setup.context.data.location.model.sync(observed.location.ref),
        ])
      },
      [Symbol.asyncDispose]: dispose,
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
