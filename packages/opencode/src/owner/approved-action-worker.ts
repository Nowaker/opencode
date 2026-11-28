import { realpathSync } from "node:fs"
import path from "node:path"
import { Effect, Option, Schema } from "effect"
import type {
  ApprovedAction,
  ApprovedActionActivity,
  ApprovedActionReceipt,
  ApprovedActionRefused,
} from "@opencode-ai/plugin"
import type { EffectBridge } from "@/effect/bridge"
import { InstanceRef } from "@/effect/instance-ref"
import { InstanceActivity } from "@/project/instance-activity"
import type { InstanceContext } from "@/project/instance-context"
import { AutoSwitch } from "@/session/auto-switch"
import { MessageHistoryState } from "@/session/message-history-state"
import { SessionPause } from "@/session/pause"
import type { SessionPrompt } from "@/session/prompt"
import { SessionID } from "@/session/schema"
import type { Session } from "@/session/session"
import type { SessionStatus } from "@/session/status"
import { NotFoundError } from "@/storage/storage"
import { createApprovedAction } from "./approved-action"
import { OwnerQuiescence } from "./quiescence"

type Settings = {
  readonly directory: string
  readonly emit: (activity: ApprovedActionActivity) => void
}

type PluginInstance = {
  readonly ctx: InstanceContext
  readonly bridge: EffectBridge.Shape
  readonly signal: AbortSignal
  readonly sessions: Session.Interface
  readonly status: SessionStatus.Interface
}

let settings: Settings | undefined
let displayed: SessionID | undefined
let latestRootActivity: { readonly publisher: object; readonly row: ApprovedActionActivity } | undefined

export function configure(input: Settings) {
  settings ??= input
  return settings.directory === input.directory
}

export function view(sessionID: SessionID | undefined) {
  if (settings) displayed = sessionID
}

export function activity(sessionID: SessionID) {
  const row = latestRootActivity?.row
  return row?.sessionID === sessionID ? row : undefined
}

export function forPlugin(instance: PluginInstance): ApprovedAction | undefined {
  const config = settings
  const { ctx, bridge, signal, sessions, status } = instance
  const state = InstanceActivity.get(ctx)
  if (!config || ctx.directory !== config.directory || !state?.pinned || state.retired || signal.aborted) return

  const publisher = {}
  const publishActivity = (event: Omit<ApprovedActionActivity, "sequence">) => {
    const row = { ...event, sequence: (latestRootActivity?.row.sequence ?? 0) + 1 }
    latestRootActivity = { publisher, row }
    config.emit(row)
  }
  signal.addEventListener(
    "abort",
    () => {
      const current = latestRootActivity
      if (current?.publisher !== publisher || current.row.phase !== "running") return
      publishActivity({
        sessionID: current.row.sessionID,
        actionID: current.row.actionID,
        messageID: current.row.messageID,
        phase: "unconfirmed",
        preview: "",
      })
    },
    { once: true },
  )

  const alive = () => !signal.aborted && !state.retired
  const get = (id: SessionID) => sessions.get(id).pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.void))
  const here = (session: Session.Info) =>
    session.parentID === undefined &&
    session.projectID === ctx.project.id &&
    canonical(session.directory) === ctx.directory

  const root = Effect.fnUntraced(function* (id: SessionID) {
    if (!alive()) return refused("owner-unavailable")
    const owner = yield* AutoSwitch.Owner
    if (owner() !== id) return refused("unsupported-owner")
    const session = yield* get(id)
    if (!session) return refused("session-not-found")
    if (!here(session)) return refused("unsupported-owner")
    const workspaceID = session.workspaceID
    if (workspaceID === undefined) return session

    const target = yield* Effect.promise(() => workspaceTarget(ctx, workspaceID)).pipe(
      Effect.catchCause(() => Effect.void),
    )
    if (target?.type !== "local" || canonical(target.directory) !== ctx.directory) return refused("unsupported-owner")
    // The adapter can suspend. A move or archive during that wait must not use the old row.
    const current = yield* get(id)
    if (!current) return refused("session-not-found")
    if (!here(current) || current.workspaceID !== workspaceID) return refused("unsupported-owner")
    return current
  })

  const check = (sessionID: string) =>
    bridge.promise(
      Effect.gen(function* () {
        if (!alive() || OwnerQuiescence.status().sealed) return refused("owner-unavailable")
        if (displayed !== sessionID) return refused("unsupported-owner")
        const id = Option.getOrUndefined(Schema.decodeUnknownOption(SessionID)(sessionID))
        if (!id) return refused("invalid-binding")
        const currentStatus = yield* status.get(id)
        const session = yield* root(id)
        if ("kind" in session) return session
        if (!alive() || OwnerQuiescence.status().sealed) return refused("owner-unavailable")
        if (displayed !== id) return refused("unsupported-owner")
        if (session.time.archived !== undefined) return refused("archived")
        if (currentStatus.paused || SessionPause.read(session.metadata)) return refused("paused")
        const writable = yield* MessageHistoryState.assertWritable(session).pipe(Effect.option)
        if (session.revert || Option.isNone(writable)) return refused("armed-revert")
      }),
    )

  const project = <A, E>(sessionID: string, action: (prompt: SessionPrompt.Interface) => Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      const { AppRuntime } = yield* Effect.promise(() => import("@/effect/app-runtime"))
      const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
      const id = Option.getOrUndefined(Schema.decodeUnknownOption(SessionID)(sessionID))
      if (!id) return refused("invalid-binding")
      const session = yield* root(id)
      if ("kind" in session) return session
      if (!alive()) return refused("owner-unavailable")
      return yield* Effect.promise(() =>
        AppRuntime.runPromise(
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            if (!alive()) return refused("owner-unavailable")
            return yield* action(prompt)
          }).pipe(Effect.provideService(InstanceRef, ctx)),
        ),
      )
    }).pipe(Effect.catchCause(() => Effect.succeed(refused("owner-unavailable"))))

  const action = createApprovedAction({
    signal,
    check,
    owner: () => {
      const { ownerID, generation } = OwnerQuiescence.status()
      return { ownerID, generation }
    },
    hold: (work) => bridge.bind(() => OwnerQuiescence.runPromise(work))(),
    publish(event) {
      if (alive()) publishActivity(event)
    },
    settle: bridge.bind(async (receipt: ApprovedActionReceipt) => {
      if (!alive()) return refused("owner-unavailable")
      try {
        return OwnerQuiescence.runPromise(() =>
          bridge.promise(project(receipt.sessionID, (prompt) => prompt.settleApprovedAction(receipt))),
        )
      } catch (error) {
        if (error instanceof OwnerQuiescence.Sealed) return refused("owner-unavailable")
        throw error
      }
    }),
    receipt: (receipt) => bridge.promise(project(receipt.sessionID, (prompt) => prompt.receiptApprovedAction(receipt))),
  })

  return {
    ...action,
    admit(input, { run }) {
      const sessionID = input.sessionID
      return action.admit(input, {
        // Admission hands off across a Promise boundary. Check again inside the owner lease.
        run: async (context) => {
          if ((await check(sessionID)) || !alive() || displayed !== sessionID) return
          return run(context)
        },
      })
    },
  }
}

async function workspaceTarget(ctx: InstanceContext, id: NonNullable<Session.Info["workspaceID"]>) {
  const { AppRuntime } = await import("@/effect/app-runtime")
  const { Workspace } = await import("@/control-plane/workspace")
  const { WorkspaceAdapterRuntime } = await import("@/control-plane/workspace-adapter-runtime")
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const workspaces = yield* Workspace.Service
      const workspace = yield* workspaces.get(id)
      if (workspace?.projectID !== ctx.project.id) return
      return yield* WorkspaceAdapterRuntime.target(workspace)
    }).pipe(Effect.provideService(InstanceRef, ctx)),
  )
}

function canonical(directory: string) {
  if (!path.isAbsolute(directory)) return
  try {
    return realpathSync(directory)
  } catch (error) {
    if (error instanceof Error && "code" in error) return undefined
    throw error
  }
}

function refused(reason: ApprovedActionRefused["reason"]): ApprovedActionRefused {
  return { kind: "refused", reason }
}

export * as WorkerApprovedAction from "./approved-action-worker"
