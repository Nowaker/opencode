import { describe, expect } from "bun:test"
import path from "node:path"
import { Deferred, Effect, Fiber } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Plugin } from "@/plugin"
import { MessageID, SessionID } from "@/session/schema"
import { snapshotWriters } from "@/snapshot/writers"
import { ShellTool } from "@/tool/shell"
import { ShellHandoff } from "@/tool/shell/handoff"
import type { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { awaitWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      CrossSpawnSpawner.node,
      FSUtil.node,
      Plugin.node,
      Truncate.node,
      Config.node,
      Agent.node,
      RuntimeFlags.node,
      BackgroundJob.node,
      EventV2Bridge.node,
    ]),
  ),
)

describe.skipIf(process.platform === "win32")("shell snapshot writer", () => {
  it.instance(
    "keeps the same writer active after foreground Bash hands off and returns",
    () =>
      Effect.gen(function* () {
        const instance = yield* InstanceState.context
        const jobs = yield* BackgroundJob.Service
        const tool = yield* ShellTool.pipe(Effect.flatMap((info) => info.init()))
        const ready = yield* Deferred.make<string>()
        const before = snapshotWriters.current(instance.worktree)
        let jobID: string | undefined
        yield* Effect.addFinalizer(() => (jobID ? jobs.cancel(jobID).pipe(Effect.asVoid) : Effect.void))

        const ctx: Tool.Context = {
          sessionID: SessionID.make("ses_snapshot_writer"),
          messageID: MessageID.ascending(),
          callID: "snapshot-writer",
          agent: "build",
          abort: new AbortController().signal,
          messages: [],
          ask: () => Effect.void,
          metadata: (value) =>
            Effect.gen(function* () {
              const id = value.metadata?.foregroundJobID
              const output = value.metadata?.output
              if (typeof id !== "string" || typeof output !== "string" || !output.includes("WRITE_READY")) return
              jobID = id
              yield* Deferred.succeed(ready, id)
            }),
        }
        const call = yield* tool
          .execute(
            {
              command: [
                "printf before > before.txt",
                "printf 'WRITE_READY\\n'",
                "while [ ! -f release ]; do sleep 0.02; done",
                "printf after > after.txt",
              ].join("; "),
              timeout: 30_000,
            },
            ctx,
          )
          .pipe(Effect.forkScoped({ startImmediately: true }))
        const id = yield* awaitWithTimeout(Deferred.await(ready), "Bash did not reach the write gate", "8 seconds")
        const foreground = snapshotWriters.current(instance.worktree)
        expect(foreground.active).toBe(1)
        expect(foreground.generation).toBeGreaterThan(before.generation)
        expect(yield* Effect.promise(() => Bun.file(path.join(instance.directory, "before.txt")).text())).toBe("before")

        const handoff = yield* ShellHandoff.find({
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          callID: "snapshot-writer",
          jobID: id,
        })
        if (!handoff) throw new Error("Running Bash did not offer a handoff")
        expect(yield* awaitWithTimeout(handoff.move(), "Bash did not move to background", "5 seconds")).toBe(id)
        const result = yield* awaitWithTimeout(Fiber.join(call), "Foreground Bash did not return", "5 seconds")
        expect(result.metadata).toMatchObject({ background: true, jobId: id })
        expect(snapshotWriters.current(instance.worktree)).toEqual(foreground)

        yield* Effect.promise(() => Bun.write(path.join(instance.directory, "release"), "go"))
        const finished = yield* jobs.wait({ id, timeout: 5_000 })
        expect(finished.info?.status).toBe("completed")
        expect(yield* Effect.promise(() => Bun.file(path.join(instance.directory, "after.txt")).text())).toBe("after")
        expect(snapshotWriters.current(instance.worktree)).toEqual({ generation: foreground.generation, active: 0 })
      }),
    { git: true, config: { shell: "/bin/bash" } },
    30_000,
  )
})
