import { expect } from "bun:test"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Permission } from "@opencode/core/permission"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { PluginPromise } from "@opencode/core/plugin/promise"
import type { PermissionDomain } from "@opencode/plugin/promise/permission"
import { Deferred, Effect, Fiber, Stream } from "effect"
import { testEffect } from "../lib/effect"
import { makePluginTestLayer } from "./fixture"

const it = testEffect(makePluginTestLayer(null))

for (const api of ["Effect", "Promise"] as const) {
  for (const decision of ["once", "reject", "defer"] as const) {
    it.live(`${api} ${decision} accepts explicit undefined reply optionals`, () =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        yield* agents.transform((editor) =>
          editor.update(Agent.ID.make("build"), (agent) => {
            agent.permissions = []
          }),
        )
        const plugins = yield* Plugin.Service
        const context = yield* PluginHost.make(plugins, "permission-undefined")
        const session = yield* context.session.create()
        const service = yield* Permission.Service
        const target = yield* service.ask({ sessionID: session.id, action: "deploy", resources: ["fixture"] })
        expect(target.effect).toBe("ask")
        const input = { sessionID: session.id, requestID: target.id, decision, scope: undefined, message: undefined }
        if (api === "Effect") expect(yield* context.permission.reply(input)).toBeUndefined()
        if (api === "Promise")
          yield* PluginPromise.fromPromise({
            id: "permission-undefined.promise",
            async setup(ctx) {
              expect(await ctx.permission.reply(input)).toBeUndefined()
            },
          }).effect(context)
        expect(yield* service.list()).toEqual([])
      }),
    )
  }
}

for (const api of ["Effect", "Promise"] as const) {
  for (const decision of ["defer", "reject"] as const) {
    it.live(`${api} replies ${decision} to only the owned request and returns exact feedback`, () =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        yield* agents.transform((editor) =>
          editor.update(Agent.ID.make("build"), (agent) => {
            agent.permissions = []
          }),
        )
        const plugins = yield* Plugin.Service
        const context = yield* PluginHost.make(plugins, "permission-reply")
        const binding = yield* Deferred.make<PermissionDomain>()
        const registration = yield* Effect.context()
        yield* PluginPromise.fromPromise({
          id: "permission-binding",
          async setup(ctx) {
            await Effect.runPromiseWith(registration)(Deferred.succeed(binding, ctx.permission))
          },
        }).effect(context)
        const promise = yield* Deferred.await(binding)
        const session = yield* context.session.create({ title: "Permission replies" })
        const other = yield* context.session.create({ title: "Other owner" })
        const service = yield* Permission.Service
        const bus = yield* Bus.Service
        const ready = yield* Deferred.make<Permission.Request>()
        yield* bus.subscribe(Permission.Event.Asked).pipe(
          Stream.runForEach((event) => Deferred.succeed(ready, event.data)),
          Effect.forkScoped({ startImmediately: true }),
        )
        const assertInput = { sessionID: session.id, action: "deploy", resources: ["prod"] }
        const assertion = yield* (
          api === "Effect"
            ? context.permission.assert(assertInput)
            : Effect.tryPromise({ try: () => promise.assert(assertInput), catch: (error) => error })
        ).pipe(Effect.exit, Effect.forkScoped)
        const target = (yield* Deferred.await(ready)).id
        const sibling = yield* service.ask({ sessionID: session.id, action: "deploy", resources: ["staging"] })
        const foreign = yield* service.ask({ sessionID: other.id, action: "deploy", resources: ["other"] })
        const payload =
          decision === "reject"
            ? { decision, scope: "request" as const, message: "Use staging\nExact feedback." }
            : { decision, message: "" }
        const input = { sessionID: session.id, requestID: target, ...payload }
        expect(context.app.capabilities).toMatchObject({
          permissionDefer: true,
          permissionRejectIsolation: true,
          syntheticAppend: true,
          jobControl: true,
        })

        if (api === "Effect") {
          for (const decision of ["once", "always", "defer"] as const)
            expect(
              yield* context.permission.reply({ ...input, decision, scope: "request" }).pipe(Effect.flip),
            ).toMatchObject({ _tag: "SchemaError" })
          expect((yield* service.list()).map((request) => request.id)).toEqual([target, sibling.id, foreign.id])
          expect(assertion.pollUnsafe()).toBeUndefined()
          expect(yield* context.permission.reply({ ...input, sessionID: other.id }).pipe(Effect.flip)).toMatchObject({
            message: `Permission request not found: ${target}`,
          })
          expect(yield* context.permission.reply(input)).toBeUndefined()
          expect(yield* context.permission.reply(input).pipe(Effect.flip)).toBeInstanceOf(Error)
        }
        if (api === "Promise")
          yield* Effect.promise(async () => {
            for (const decision of ["once", "always", "defer"] as const)
              await expect(promise.reply({ ...input, decision, scope: "request" })).rejects.toMatchObject({
                _tag: "SchemaError",
              })
            await expect(promise.reply({ ...input, sessionID: other.id })).rejects.toMatchObject({
              message: `Permission request not found: ${target}`,
            })
            expect(await Effect.runPromiseWith(registration)(service.list())).toHaveLength(3)
            expect(assertion.pollUnsafe()).toBeUndefined()
            expect(await promise.reply(input)).toBeUndefined()
            await expect(promise.reply(input)).rejects.toMatchObject({
              message: `Permission request not found: ${target}`,
            })
          })

        const outcome = yield* Fiber.join(assertion)
        expect(outcome).toMatchObject({
          _tag: "Failure",
          cause: { reasons: [{ _tag: "Fail", error: { _tag: "Tool.Error", message: payload.message } }] },
        })
        expect((yield* service.list()).map((request) => request.id)).toEqual([sibling.id, foreign.id])
        expect(
          yield* service.reply({ requestID: Permission.ID.create(), reply: "defer" }).pipe(Effect.flip),
        ).toBeInstanceOf(Permission.NotFoundError)
      }),
    )
  }
}
