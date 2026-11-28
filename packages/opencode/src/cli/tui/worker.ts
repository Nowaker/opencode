import { Server } from "@/server/server"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { ServerAuth } from "@/server/auth"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect, Option, Schema } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { AutoSwitch } from "@/session/auto-switch"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { NotFoundError } from "@/storage/storage"
import { Workspace } from "@/control-plane/workspace"
import { WorkspaceAdapterRuntime } from "@/control-plane/workspace-adapter-runtime"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { ErrorRecord } from "@opencode-ai/core/observability/error-record"
import { FSUtil } from "@opencode-ai/core/fs-util"
import path from "path"
import { InstanceRef } from "@/effect/instance-ref"
import { ShellHandoff } from "@/tool/shell/handoff"
import { InstanceStore } from "@/project/instance-store"
import { WorkerApprovedAction } from "@/owner/approved-action-worker"

Heap.start()

// The worker survives what it catches here, so a session is not lost to one
// bad promise; the record is what keeps the error from vanishing with it.
const errors = ErrorRecord.writer({
  file: path.join(Global.Path.log, "errors.jsonl"),
  process: "tui-worker",
  version: InstallationVersion,
})

const onUnhandledRejection = (error: unknown) => errors.record(error, "unhandledRejection")

const onUncaughtException = (error: Error) => errors.record(error, "uncaughtException")

process.on("unhandledRejection", onUnhandledRejection)
process.on("uncaughtException", onUncaughtException)

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Awaited<ReturnType<typeof Server.listen>> | undefined
let transport: "portless" | "listener" | "unconfigured" | "closed" | undefined

type BashTarget = Parameters<typeof ShellHandoff.find>[0] & { readonly directory: string }

function withBashOwner<A>(
  input: BashTarget,
  act: (control: NonNullable<Effect.Success<ReturnType<typeof ShellHandoff.find>>>) => Effect.Effect<A>,
) {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const store = yield* InstanceStore.Service
      const instance = yield* store.existing(input.directory)
      if (!instance) return
      const control = yield* ShellHandoff.find(input).pipe(Effect.provideService(InstanceRef, instance))
      if (control) return yield* act(control)
    }),
  )
}

export const rpc = {
  enableApprovedActions(input: { directory: string }) {
    if (transport !== undefined && transport !== "portless") return false
    if (!path.isAbsolute(input.directory)) return false
    const directory = FSUtil.resolve(input.directory)
    if (directory !== FSUtil.resolve(process.cwd())) return false
    transport = "portless"
    return WorkerApprovedAction.configure({ directory, emit: (event) => Rpc.emit("approved-action.activity", event) })
  },
  approvedActionView(input: { sessionID?: string }) {
    if (transport !== "portless") return
    WorkerApprovedAction.view(Option.getOrUndefined(Schema.decodeUnknownOption(SessionID)(input.sessionID)))
  },
  approvedActionActivity(input: { sessionID: string }) {
    if (transport !== "portless") return
    return WorkerApprovedAction.activity(Schema.decodeUnknownSync(SessionID)(input.sessionID))
  },
  bindAutoSwitchOwner(input: { sessionID: string }) {
    return AutoSwitch.bindOwner(Schema.decodeUnknownSync(SessionID)(input.sessionID))
  },
  bindSessionOwner(input: { sessionID: string }) {
    transport ??= "unconfigured"
    const id = Schema.decodeUnknownSync(SessionID)(input.sessionID)
    return AppRuntime.runPromise(
      Effect.gen(function* () {
        const owner = yield* AutoSwitch.Owner
        const bound = owner()
        if (bound !== undefined) return bound === id
        const sessions = yield* Session.Service
        const root = yield* sessions.get(id).pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.void))
        if (!root || root.parentID !== undefined) return false
        if (root.workspaceID !== undefined) {
          const workspaces = yield* Workspace.Service
          const workspace = yield* workspaces.get(root.workspaceID)
          if (!workspace) return false
          const instances = yield* InstanceStore.Service
          const target = yield* instances.provide({ directory: process.cwd() }, WorkspaceAdapterRuntime.target(workspace))
          if (target.type !== "local") return false
        }
        return AutoSwitch.bindOwner(id)
      }),
    )
  },
  async bashBackgroundAvailable(input: BashTarget) {
    return (await withBashOwner(input, (control) => Effect.sync(control.available))) === true
  },
  bashBackgroundMove(input: BashTarget) {
    return withBashOwner(input, (control) => control.move())
  },
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    transport ??= "unconfigured"
    const headers = { ...input.headers }
    const auth = ServerAuth.header()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().app.fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (transport === "portless" || transport === "closed") throw new TypeError("Worker cannot start a listener")
    transport = "listener"
    if (server) await server.stop(true)
    server = await Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    transport ??= "unconfigured"
    await InstanceRuntime.load({ directory: input.directory })
    return upgrade().catch(() => undefined)
  },
  async reload() {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const cfg = yield* Config.Service
        yield* cfg.invalidate()
        yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true, reason: "reload" })
      }),
    )
  },
  async shutdown() {
    transport = "closed"
    WorkerApprovedAction.view(undefined)
    await InstanceRuntime.disposeAllInstances("exit")
    if (server) await server.stop(true)
    process.off("unhandledRejection", onUnhandledRejection)
    process.off("uncaughtException", onUncaughtException)
  },
}

Rpc.listen(rpc)
