import { expect } from "bun:test"
import { Cause, Context, Effect, Exit, Fiber, Layer } from "effect"
import { absurd } from "effect/Function"
import { Form } from "@opencode/core/form"
import { QuestionTool } from "@opencode/core/tool/plugin/question"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"
import { exercise, question, setup } from "./form-fixture"

const it = testEffect(PluginTestLayer)

for (const api of ["Effect", "Promise"] as const) {
  it.live(`${api} form reads are raw, pending-only and scoped to the current Location and optional session`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const first = yield* fixture.forms.create({
        sessionID: fixture.owner.id,
        title: "First",
        fields: [{ key: "name", type: "string" }],
      })
      const second = yield* fixture.forms.create({
        sessionID: "ses_other_owner",
        title: "Second",
        fields: [{ key: "name", type: "string" }],
      })
      const settled = yield* fixture.forms.create({
        sessionID: fixture.owner.id,
        title: "Settled",
        fields: [{ key: "name", type: "string" }],
      })
      yield* fixture.forms.reply({ id: settled.id, answer: { name: "Earlier" } })
      const foreign = yield* Layer.build(PluginTestLayer.pipe(Layer.fresh))
      const foreignForms = Context.get(foreign, Form.Service)
      const elsewhere = yield* foreignForms.create({
        sessionID: fixture.owner.id,
        title: "Other Location",
        fields: [{ key: "name", type: "string" }],
      })
      const observed: unknown[] = []
      const input = { sessionID: fixture.owner.id, formID: settled.id }

      yield* exercise(api, fixture.host, {
        effect: (ctx) =>
          Effect.gen(function* () {
            expect(ctx.app.capabilities?.formControl).toBe(true)
            observed.push(
              yield* ctx.form.list(),
              yield* ctx.form.list({}),
              yield* ctx.form.list({ sessionID: fixture.owner.id }),
              yield* ctx.form.list({ sessionID: "ses_missing" }),
              yield* ctx.form.get(input),
            )
            expect(yield* ctx.form.get({ ...input, formID: elsewhere.id }).pipe(Effect.flip)).toEqual(
              new Form.NotFoundError({ id: elsewhere.id }),
            )
          }),
        promise: async (ctx) => {
          expect(ctx.app.capabilities?.formControl).toBe(true)
          observed.push(
            await ctx.form.list(),
            await ctx.form.list({}),
            await ctx.form.list({ sessionID: fixture.owner.id }),
            await ctx.form.list({ sessionID: "ses_missing" }),
            await ctx.form.get(input),
          )
          await expect(ctx.form.get({ ...input, formID: elsewhere.id })).rejects.toEqual(
            new Form.NotFoundError({ id: elsewhere.id }),
          )
        },
      })

      for (const all of observed.slice(0, 2)) {
        expect(all).toHaveLength(2)
        expect(all).toEqual(expect.arrayContaining([first, second]))
      }
      expect(observed.slice(2)).toEqual([
        [first],
        [],
        { ...settled, state: { status: "answered", answer: { name: "Earlier" } } },
      ])
      expect(yield* foreignForms.list()).toEqual([elsewhere])
    }),
  )

  it.live(`${api} get, reply and cancel refuse wrong owners and missing forms without changing pending work`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const form = yield* fixture.forms.create({
        sessionID: fixture.owner.id,
        title: "Owned",
        fields: [{ key: "name", type: "string", required: true }],
      })
      for (const input of [
        { sessionID: "ses_wrong", formID: form.id },
        { sessionID: fixture.owner.id, formID: Form.ID.create() },
      ]) {
        const missing = new Form.NotFoundError({ id: input.formID })
        yield* exercise(api, fixture.host, {
          effect: (ctx) =>
            Effect.gen(function* () {
              expect(yield* ctx.form.get(input).pipe(Effect.flip)).toEqual(missing)
              expect(yield* ctx.form.reply({ ...input, answer: { name: "Wrong owner" } }).pipe(Effect.flip)).toEqual(
                missing,
              )
              expect(yield* ctx.form.cancel(input).pipe(Effect.flip)).toEqual(missing)
            }),
          promise: async (ctx) => {
            await expect(ctx.form.get(input)).rejects.toEqual(missing)
            await expect(ctx.form.reply({ ...input, answer: { name: "Wrong owner" } })).rejects.toEqual(missing)
            await expect(ctx.form.cancel(input)).rejects.toEqual(missing)
          },
        })
        expect(yield* fixture.forms.state(form.id)).toEqual({ status: "pending" })
        expect(yield* fixture.forms.list()).toEqual([form])
      }
    }),
  )

  it.live(`${api} invalid native answers preserve the pending form and retain InvalidAnswerError`, () =>
    Effect.gen(function* () {
      const fixture = yield* setup
      const form = yield* fixture.forms.create({
        sessionID: fixture.owner.id,
        title: "Validation",
        fields: [{ key: "name", type: "string", required: true }],
      })
      const input = { sessionID: fixture.owner.id, formID: form.id, answer: { name: false } }
      const invalid = new Form.InvalidAnswerError({ id: form.id, message: "Expected string for form field: name" })
      yield* exercise(api, fixture.host, {
        effect: (ctx) =>
          ctx.form.reply(input).pipe(
            Effect.flip,
            Effect.tap((error) => Effect.sync(() => expect(error).toEqual(invalid))),
            Effect.asVoid,
          ),
        promise: async (ctx) => {
          await expect(ctx.form.reply(input)).rejects.toEqual(invalid)
        },
      })
      expect(yield* fixture.forms.state(form.id)).toEqual({ status: "pending" })
      expect(yield* fixture.forms.list()).toEqual([form])
    }),
  )

  for (const settlement of ["reply", "cancel", "cancel-empty"] as const) {
    it.live(
      `${api} ${settlement} settles an actual native question, retains details and rejects repeat settlement`,
      () =>
        Effect.gen(function* () {
          const fixture = yield* setup
          const active = yield* question(fixture.host, fixture.owner.id)
          const input = { sessionID: fixture.owner.id, formID: active.form.id }
          const answer = { q0: "Yes", q1: ["Alpha", "Beta"] }
          const message = "Cancelled through native form controls"
          expect(active.form.id).toStartWith("frm_")

          yield* exercise(api, fixture.host, {
            effect: (ctx) => {
              switch (settlement) {
                case "reply":
                  return ctx.form.reply({ ...input, answer })
                case "cancel":
                  return ctx.form.cancel({ ...input, message })
                case "cancel-empty":
                  return ctx.form.cancel(input)
                default:
                  return absurd(settlement)
              }
            },
            promise: async (ctx) => {
              switch (settlement) {
                case "reply":
                  return ctx.form.reply({ ...input, answer })
                case "cancel":
                  return ctx.form.cancel({ ...input, message })
                case "cancel-empty":
                  return ctx.form.cancel(input)
                default:
                  return absurd(settlement)
              }
            },
          })

          const details: unknown[] = []
          yield* exercise(api, fixture.host, {
            effect: (ctx) =>
              Effect.gen(function* () {
                details.push(yield* ctx.form.get(input), yield* ctx.form.list())
                expect(yield* ctx.form.reply({ ...input, answer }).pipe(Effect.flip)).toEqual(
                  new Form.AlreadySettledError({ id: active.form.id }),
                )
                expect(yield* ctx.form.cancel(input).pipe(Effect.flip)).toEqual(
                  new Form.AlreadySettledError({ id: active.form.id }),
                )
              }),
            promise: async (ctx) => {
              details.push(await ctx.form.get(input), await ctx.form.list())
              await expect(ctx.form.reply({ ...input, answer })).rejects.toEqual(
                new Form.AlreadySettledError({ id: active.form.id }),
              )
              await expect(ctx.form.cancel(input)).rejects.toEqual(new Form.AlreadySettledError({ id: active.form.id }))
            },
          })
          expect(details[1]).toEqual([])
          switch (settlement) {
            case "reply":
              expect(details[0]).toEqual({ ...active.form, state: { status: "answered", answer } })
              expect(yield* Fiber.join(active.running)).toMatchObject({
                status: "completed",
                output: { answers: [["Yes"], ["Alpha", "Beta"]] },
              })
              break
            case "cancel":
              expect(details[0]).toEqual({ ...active.form, state: { status: "cancelled", message } })
              expect(yield* Fiber.join(active.running)).toMatchObject({ status: "error", error: { message } })
              break
            case "cancel-empty": {
              expect(details[0]).toEqual({ ...active.form, state: { status: "cancelled" } })
              const exit = yield* Fiber.await(active.running)
              expect(Exit.isFailure(exit)).toBe(true)
              if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBeInstanceOf(QuestionTool.CancelledError)
              break
            }
            default:
              absurd(settlement)
          }
        }),
    )
  }
}
