import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Model } from "@opencode/core/model"
import { Location } from "@opencode/core/location"
import { Session } from "@opencode/core/session"
import { AbsolutePath } from "@opencode/core/schema"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { tmpdirScoped } from "../fixture/tmpdir"
import { PluginTestLayer } from "./fixture"
import {
  configure,
  configuredAgent,
  configuredModel,
  explicitID,
  fallbackID,
  providerID,
  setup,
} from "./selection-fixture"

const it = testEffect(PluginTestLayer)

for (const api of ["Effect", "Promise"] as const) {
  for (const choice of ["omitted", "agent", "model", "explicit", "fallback"] as const) {
    it.live(`${api} reads ${choice} selection without changing the Session`, () =>
      Effect.gen(function* () {
        const state = yield* setup
        const model = Model.Ref.make({
          providerID,
          id: Model.ID.make("first"),
          variant: Model.VariantID.make("default"),
        })
        const explicitAgent = Agent.ID.make("build")
        if (choice === "agent" || choice === "explicit")
          yield* state.host.session.switchAgent({ sessionID: state.session.id, agent: explicitAgent })
        if (choice === "fallback")
          yield* Effect.gen(function* () {
            const agents = yield* Agent.Service
            yield* agents.transform((editor) =>
              editor.update(configuredAgent, (agent) => {
                agent.model = undefined
              }),
            )
          }).pipe(Effect.provide(state.target))
        if (choice === "model" || choice === "explicit")
          yield* state.host.session.switchModel({ sessionID: state.session.id, model })
        const before = yield* state.host.session.get({ sessionID: state.session.id })
        const history = yield* state.host.session.messages({ sessionID: state.session.id })
        const expected = {
          agent: choice === "agent" || choice === "explicit" ? explicitAgent : configuredAgent,
          model:
            choice === "omitted"
              ? configuredModel
              : choice === "agent" || choice === "fallback"
                ? { providerID, id: fallbackID }
                : model,
        }
        expect(state.host.app.capabilities?.sessionSelection).toBe(true)
        if (api === "Effect")
          expect(yield* state.host.session.selection({ sessionID: state.session.id })).toEqual(expected)
        if (api === "Promise")
          yield* PluginPromise.fromPromise({
            id: "selection-test.promise",
            async setup(ctx) {
              expect(await ctx.session.selection({ sessionID: state.session.id })).toEqual(expected)
            },
          }).effect(state.host)
        expect(yield* state.host.session.get({ sessionID: state.session.id })).toEqual(before)
        expect(yield* state.host.session.messages({ sessionID: state.session.id })).toEqual(history)
      }),
    )
  }
}

it.live("selection follows the target Location instead of the plugin's captured defaults", () =>
  Effect.gen(function* () {
    const state = yield* setup
    const directory = yield* tmpdirScoped()
    const target = yield* state.host.session.create({
      location: Location.Ref.make({ directory: AbsolutePath.make(directory.path) }),
    })
    const context = yield* state.locations.contextEffect(target.location)
    yield* configure.pipe(Effect.provide(context))
    yield* Effect.gen(function* () {
      const agents = yield* Agent.Service
      yield* agents.transform((editor) => editor.default(Agent.ID.make("build")))
    }).pipe(Effect.provide(context))
    expect(yield* state.host.session.selection({ sessionID: target.id })).toEqual({
      agent: Agent.ID.make("build"),
      model: { providerID, id: fallbackID },
    })
    expect(yield* state.host.session.selection({ sessionID: state.session.id })).toEqual({
      agent: configuredAgent,
      model: configuredModel,
    })
  }),
)

it.live("selection uses the same native model precedence as execution before routing hooks", () =>
  Effect.gen(function* () {
    const state = yield* setup
    const selected = yield* state.host.session.selection({ sessionID: state.session.id })
    const native = yield* Effect.gen(function* () {
      const model = yield* Model.Service
      const resolve = yield* SessionRunnerModel.Service
      return yield* resolve.resolve(state.session, model.available, { kind: "primary", agent: configuredAgent })
    }).pipe(Effect.provide(state.target))
    expect(selected.model).toEqual(native.ref)
  }),
)

for (const failure of ["missing-session", "missing-agent", "missing-model", "missing-variant"] as const) {
  it.live(`selection preserves the native ${failure} failure`, () =>
    Effect.gen(function* () {
      const state = yield* setup
      const sessionID = failure === "missing-session" ? Session.ID.create() : state.session.id
      if (failure === "missing-agent")
        yield* state.host.session.switchAgent({ sessionID, agent: Agent.ID.make("absent") })
      if (failure === "missing-model")
        yield* state.host.session.switchModel({
          sessionID,
          model: Model.Ref.make({ providerID, id: Model.ID.make("absent") }),
        })
      if (failure === "missing-variant")
        yield* state.host.session.switchModel({
          sessionID,
          model: Model.Ref.make({ providerID, id: explicitID, variant: Model.VariantID.make("absent") }),
        })
      const tags = {
        "missing-session": "Session.NotFoundError",
        "missing-agent": "Session.AgentNotFoundError",
        "missing-model": "SessionRunnerModel.ModelUnavailableError",
        "missing-variant": "SessionRunnerModel.VariantUnavailableError",
      } as const
      expect(yield* state.host.session.selection({ sessionID }).pipe(Effect.flip)).toMatchObject({
        _tag: tags[failure],
      })
    }),
  )
}
