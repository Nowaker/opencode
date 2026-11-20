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
import { Effect, Schema } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { AutoSwitch } from "@/session/auto-switch"
import { SessionID } from "@/session/schema"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { ErrorRecord } from "@opencode-ai/core/observability/error-record"
import path from "path"
import { InstanceRef } from "@/effect/instance-ref"
import { ShellHandoff } from "@/tool/shell/handoff"
import { InstanceStore } from "@/project/instance-store"

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
  bindAutoSwitchOwner(input: { sessionID: string }) {
    return AutoSwitch.bindOwner(Schema.decodeUnknownSync(SessionID)(input.sessionID))
  },
  async bashBackgroundAvailable(input: BashTarget) {
    return (await withBashOwner(input, (control) => Effect.sync(control.available))) === true
  },
  bashBackgroundMove(input: BashTarget) {
    return withBashOwner(input, (control) => control.move())
  },
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
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
    if (server) await server.stop(true)
    server = await Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
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
    await InstanceRuntime.disposeAllInstances("exit")
    if (server) await server.stop(true)
    process.off("unhandledRejection", onUnhandledRejection)
    process.off("uncaughtException", onUncaughtException)
  },
}

Rpc.listen(rpc)
