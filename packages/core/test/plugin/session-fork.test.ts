import { expect } from "bun:test"
import { Effect } from "effect"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Session } from "@opencode/core/session"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

for (const api of ["Effect", "Promise"] as const) {
  it.live(`${api} plugin forks preserve ordinary Session API boundaries and inheritance`, () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const plugins = yield* Plugin.Service
      const context = yield* PluginHost.make(plugins, "fork-test")
      const parent = yield* context.session.create({ title: "Parent", metadata: { project: "fixture" } })
      yield* context.session.synthetic({ sessionID: parent.id, ignored: true, text: "history" })
      const history = yield* context.session.context({ sessionID: parent.id })
      const first = history[0]
      if (!first) return yield* Effect.die("Missing parent history")
      const verify = Effect.fn(function* (id: Session.ID, empty: boolean) {
        const fork = yield* sessions.get(id)
        expect(fork).toMatchObject({
          fork: { sessionID: parent.id },
          metadata: parent.metadata,
          title: "Parent (fork #1)",
        })
        expect(fork.parentID).toBeUndefined()
        expect((yield* sessions.context(id)).map((message) => message.type)).toEqual(empty ? [] : ["synthetic"])
      })
      if (api === "Effect") {
        const fork = yield* context.session.fork({ sessionID: parent.id })
        yield* verify(fork.id, false)
        const empty = yield* context.session.fork({ sessionID: parent.id, before: first.id })
        yield* verify(empty.id, true)
        return
      }
      const forks: Array<{ readonly id: Session.ID; readonly empty: boolean }> = []
      yield* PluginPromise.fromPromise({
        id: "fork-test",
        async setup(ctx) {
          forks.push({ id: Session.ID.make((await ctx.session.fork({ sessionID: parent.id })).id), empty: false })
          forks.push({
            id: Session.ID.make((await ctx.session.fork({ sessionID: parent.id, before: first.id })).id),
            empty: true,
          })
        },
      }).effect(context)
      expect(forks).toHaveLength(2)
      yield* Effect.forEach(forks, (fork) => verify(fork.id, fork.empty))
    }),
  )
}
