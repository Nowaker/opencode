#!/usr/bin/env bun
process.env.OPENCODE_DB = "/home/nowaker/projekty/nowaker/opencode-tools/tmp/stress-rig/opencode-data/opencode.db"
process.env.XDG_DATA_HOME = "/home/nowaker/projekty/nowaker/opencode-tools/tmp/stress-rig/xdg-data"
process.env.XDG_CONFIG_HOME = "/home/nowaker/projekty/nowaker/opencode-tools/tmp/stress-rig/xdg-config"
process.env.OPENCODE_DISABLE_SHARE = "true"

const { ManagedRuntime } = await import("effect")
const { MessageV2 } = await import("@/session/message-v2")
const { SessionID } = await import("@/session/schema")
const { Flag } = await import("@opencode-ai/core/flag/flag")
const { Database } = await import("@opencode-ai/core/database/database")
const { LayerNode } = await import("@opencode-ai/core/effect/layer-node")

Flag.OPENCODE_DB = process.env.OPENCODE_DB!

const sid = SessionID.make("ses_1ad6a8e07ffeUN4nLbC0vax6d0")
const runtime = ManagedRuntime.make(LayerNode.compile(Database.node))

await runtime.runPromise(MessageV2.filterCompactedEffect(sid))

const N = 5
const times: number[] = []
for (let i = 0; i < N; i++) {
  const t0 = performance.now()
  const msgs = await runtime.runPromise(MessageV2.filterCompactedEffect(sid))
  const ms = performance.now() - t0
  times.push(ms)
  console.log(`iter ${i + 1}: ${ms.toFixed(1)}ms, ${msgs.length} msgs`)
}

times.sort((a, b) => a - b)
console.log(
  `min=${times[0].toFixed(1)}ms median=${times[Math.floor(N / 2)].toFixed(1)}ms max=${times[N - 1].toFixed(1)}ms`,
)
await runtime.dispose()
process.exit(0)
