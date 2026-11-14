import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Effect } from "effect"

export const providerID = Provider.ID.make("selection-test")
export const fallbackID = Model.ID.make("preferred")
export const explicitID = Model.ID.make("explicit")
export const configuredAgent = Agent.ID.make("configured")
export const variant = Model.VariantID.make("careful")
export const configuredModel = Model.Ref.make({ providerID, id: explicitID, variant })

export const configure = Effect.gen(function* () {
  const providers = yield* Provider.Service
  const models = yield* Model.Service
  const agents = yield* Agent.Service
  yield* providers.transform((editor) => {
    editor.update(providerID, (provider) => {
      provider.activation = "enabled"
      provider.package = "@opencode/ai/providers/openai"
    })
    for (const id of [Model.ID.make("first"), fallbackID, explicitID])
      editor.models.update(providerID, id, (model) => {
        model.variants = [{ id: variant }]
      })
  })
  yield* models.transform((editor) => editor.default.set(providerID, fallbackID))
  yield* agents.transform((editor) => {
    editor.update(Agent.ID.make("build"), (agent) => {
      agent.mode = "primary"
    })
    editor.update(configuredAgent, (agent) => {
      agent.mode = "primary"
      agent.model = configuredModel
    })
    editor.default(configuredAgent)
  })
})

export const setup = Effect.gen(function* () {
  const plugins = yield* Plugin.Service
  const host = yield* PluginHost.make(plugins, "selection-test")
  const session = yield* host.session.create({ title: "Selection observer" })
  const locations = yield* LocationServiceMap.Service
  const target = yield* locations.contextEffect(session.location)
  yield* configure.pipe(Effect.provide(target))
  return { host, session, target, locations }
})
