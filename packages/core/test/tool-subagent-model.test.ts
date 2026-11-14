import { expect } from "bun:test"
import { Effect } from "effect"
import { Agent } from "@opencode/core/agent"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { SessionSelection } from "@opencode/core/session/selection"
import { childID, it, setup } from "./fixture/subagent-options"

for (const variants of [false, true])
  for (const mode of ["create", "fork", "resume"] as const)
    it.live(`roundtrips a persisted default model through native subagent ${mode} (variants=${variants})`, () =>
      Effect.gen(function* () {
        const s = yield* setup
        const locations = yield* LocationServiceMap.Service
        const providers = yield* Provider.Service.pipe(Effect.provide(locations.get(s.parent.location)))
        yield* providers.transform((editor) => {
          editor.models.update(s.model.providerID, s.model.id, (model) => {
            model.variants = variants ? [{ id: Model.VariantID.make("fast") }] : []
          })
        })
        const persisted = (yield* s.sessions.get(s.parent.id)).model
        const expected = { ...s.model, variant: Model.VariantID.make("default") }
        expect(persisted).toEqual(expected)
        if (!persisted) return yield* Effect.die("Missing persisted parent model")
        yield* s.sessions.synthetic({ sessionID: s.parent.id, ignored: true, text: "parent context" })
        const existing =
          mode === "resume"
            ? yield* s.sessions.create({
                parentID: s.parent.id,
                agent: Agent.ID.make("reviewer"),
                model: Model.Ref.parse("test/child"),
              })
            : undefined

        const result = yield* s.call({
          model: `${persisted.providerID}/${persisted.id}#${persisted.variant}`,
          fork: mode === "fork",
          ...(existing ? { sessionID: existing.id } : {}),
        })

        expect(result).toMatchObject({ status: "completed", metadata: { status: "completed" } })
        const id = childID(result.metadata)
        expect((yield* s.sessions.get(id)).model).toEqual(expected)
        const select = yield* SessionSelection.make
        expect((yield* select({ sessionID: id })).model).toEqual(expected)
      }),
    )
