import { expect, spyOn } from "bun:test"
import childProcess from "node:child_process"
import { Effect, Stream } from "effect"
import { PlatformError } from "effect/PlatformError"
import { ChildProcess } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(CrossSpawnSpawner.node))

for (const code of ["EIO", "EPIPE"]) {
  it.live(
    `reports active stdin ${code} as a PlatformError`,
    Effect.gen(function* () {
      using spawn = spyOn(childProcess, "spawn")
      const handle = yield* ChildProcess.make(process.execPath, ["-e", "process.stdin.resume()"])
      const proc = spawn.mock.results.at(-1)?.value
      if (!(proc instanceof childProcess.ChildProcess) || !proc.stdin) throw new Error("missing child stdin")
      const stdin = proc.stdin
      const error = Object.assign(new Error("stdin write failed"), { code, syscall: "write" })
      const input = Stream.fromEffect(
        Effect.promise(
          () =>
            new Promise<Uint8Array>((resolve) => {
              setImmediate(() => {
                stdin.destroy(error)
                resolve(Buffer.from("input"))
              })
            }),
        ),
      )

      const failure = yield* Stream.run(input, handle.stdin).pipe(Effect.flip, Effect.timeout("2 seconds"))

      expect(failure).toBeInstanceOf(PlatformError)
      expect([failure.reason._tag, failure.reason.module, failure.reason.method]).toEqual([
        "Unknown",
        "ChildProcess",
        "fromWritable(stdin)",
      ])
      expect(failure.reason.cause).toBe(error)
    }),
  )
}

it.live(
  "keeps unhandled non-EPIPE stdin errors visible after the sink finishes",
  Effect.gen(function* () {
    using spawn = spyOn(childProcess, "spawn")
    const handle = yield* ChildProcess.make(process.execPath, ["-e", "process.stdin.resume()"], {
      stdin: { stream: "pipe", endOnDone: false },
    })
    const proc = spawn.mock.results.at(-1)?.value
    if (!(proc instanceof childProcess.ChildProcess) || !proc.stdin) throw new Error("missing child stdin")
    const stdin = proc.stdin
    const error = Object.assign(new Error("late stdin failure"), { code: "EIO" })
    yield* Stream.run(Stream.make(Buffer.from("input")), handle.stdin)

    expect(() => stdin.emit("error", error)).toThrow(error)
    expect(() => stdin.emit("error", Object.assign(new Error("closed pipe"), { code: "EPIPE" }))).not.toThrow()
  }),
)
