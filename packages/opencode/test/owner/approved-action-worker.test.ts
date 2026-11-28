import { expect } from "bun:test"
import { strict } from "node:assert"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import type { ApprovedActionActivity } from "@opencode-ai/plugin"
import { Effect } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { WorkerApprovedAction } from "@/owner/approved-action-worker"
import { InstanceStore } from "@/project/instance-store"
import { AutoSwitch } from "@/session/auto-switch"
import { MessageID } from "@/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { requireInstance } from "../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(LayerNode.group([Session.node, SessionStatus.node, SessionProjector.node])))

it.instance("clears the running preview in both the activity event and the snapshot when its owner retires", () =>
  Effect.gen(function* () {
    const ctx = yield* requireInstance
    const store = yield* InstanceStore.Service
    const sessions = yield* Session.Service
    const status = yield* SessionStatus.Service
    const root = yield* sessions.create({ title: "Activity retirement fixture" })
    const bridge = yield* EffectBridge.make().pipe(Effect.provideService(AutoSwitch.Owner, () => root.id))
    const lifetime = new AbortController()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        WorkerApprovedAction.view(undefined)
        lifetime.abort()
        release.resolve()
      }),
    )

    let lastEvent: ApprovedActionActivity | undefined
    strict.ok(
      WorkerApprovedAction.configure({
        directory: ctx.directory,
        emit: (activity) => {
          lastEvent = activity
        },
      }),
    )
    WorkerApprovedAction.view(root.id)
    const action = WorkerApprovedAction.forPlugin({ ctx, bridge, signal: lifetime.signal, sessions, status })
    strict.ok(action)
    const binding = { sessionID: root.id, actionID: "qac_Retirement01", messageID: MessageID.ascending() }
    const capability = yield* Effect.promise(() => action.capability(binding))
    strict.equal(capability.kind, "ready")
    const request = { ...binding, owner: capability.owner }
    const prepared = yield* Effect.promise(() => action.prepare(request))
    strict.equal(prepared.kind, "prepared")
    const admission = yield* Effect.promise(() =>
      action.admit({ ...request, preparationID: prepared.preparationID }, {
        async run({ stream }) {
          stream({ sequence: 1, text: "temporary preview" })
          entered.resolve()
          await release.promise
          return undefined
        },
      }),
    )
    expect(admission).toEqual({ kind: "admitted" })
    yield* awaitWithTimeout(Effect.promise(() => entered.promise), "the approved action never started")
    const running = WorkerApprovedAction.activity(root.id)
    strict.ok(running)
    expect(running.preview).toBe("temporary preview")

    yield* store.dispose(ctx, "reload")
    lifetime.abort()

    expect(lastEvent).toEqual({ ...binding, sequence: running.sequence + 1, phase: "unconfirmed", preview: "" })
    WorkerApprovedAction.view(undefined)
    WorkerApprovedAction.view(root.id)
    expect(WorkerApprovedAction.activity(root.id)).toEqual(lastEvent)
  }),
)
