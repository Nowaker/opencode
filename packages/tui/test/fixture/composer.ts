import assert from "node:assert/strict"
import type { ComposerObservation, Context } from "@opencode/plugin/tui/context"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createAppFixture } from "./app"
import { copyPlugin } from "./fixture"
import { directory, json } from "./tui-client"
import { useStorage } from "../../src/context/storage"
import { takeDraft } from "../../src/component/prompt/draft-stash"

export async function mountComposer(input: Parameters<typeof createAppFixture>[0] = {}) {
  takeDraft("ses_observation_a")
  takeDraft("ses_observation_b")
  const plugin = await copyPlugin("composer-observation")
  const setup = input.setup ?? (await createTestRenderer({ width: 100, height: 35, kittyKeyboard: true }))
  if (!input.setup) await setup.renderer.setupTerminal()
  const context = Promise.withResolvers<Context>()
  const changes: ComposerObservation[] = []
  setup.renderer.on("fixture.composer-change", (value: ComposerObservation) => changes.push(value))
  setup.renderer.once("fixture.composer-observation", context.resolve)
  const app = await createAppFixture({
    ...input,
    setup,
    config: { animations: false, ...input.config, plugins: [plugin.directory] },
    fetch: async (url, request) => {
      const overridden = await input.fetch?.(url, request)
      if (overridden) return overridden
      const sessionID = url.pathname.match(/^\/api\/session\/(ses_observation_[ab])$/)?.[1]
      if (sessionID)
        return json({
          data: {
            id: sessionID,
            title: sessionID,
            projectID: "proj_test",
            location: { directory },
            time: { created: 0, updated: 0 },
          },
        })
      if (/^\/api\/session\/ses_observation_[ab]\/(message|inbox)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
    },
  })
  await app.ready
  const ctx = await context.promise
  const composer = ctx.ui.composer
  if (!composer) {
    await app[Symbol.asyncDispose]()
    await plugin[Symbol.asyncDispose]()
  }
  assert.ok(composer, "the loaded plugin must receive the native composer observation domain")
  let storage: ReturnType<typeof useStorage> | undefined
  ctx.ui.slot({
    append: "app",
    render: () => {
      storage = useStorage()
      return null
    },
  })
  await app.waitFor(() => storage !== undefined)
  assert.ok(storage)
  const ownedStorage = storage
  return {
    ...app,
    context: ctx,
    composer,
    changes,
    async [Symbol.asyncDispose]() {
      await ownedStorage.flush()
      await app[Symbol.asyncDispose]()
      await plugin[Symbol.asyncDispose]()
    },
  }
}

export function composerEditor(setup: Awaited<ReturnType<typeof mountComposer>>) {
  const editor = setup.renderer.currentFocusedEditor
  assert.ok(editor instanceof TextareaRenderable)
  return editor
}
