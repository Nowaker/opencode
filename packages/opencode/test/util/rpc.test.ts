import { afterAll, describe, expect, test } from "bun:test"
import { Rpc } from "../../src/util/rpc"
import type { rpc } from "../fixture/rpc-worker"
import { tmpdir } from "../fixture/fixture"
import path from "node:path"

const worker = new Worker(new URL("../fixture/rpc-worker.ts", import.meta.url))
const client = Rpc.client<typeof rpc>(worker)

afterAll(() => worker.terminate())

// The protocol has no timeout of its own, so a call is raced against one here:
// an unanswered request then fails the assertion instead of stalling the test.
const settle = (call: Promise<unknown>) =>
  Promise.race([
    call.then(
      (value) => ({ value }),
      (error: Error) => ({ error: error.message }),
    ),
    Bun.sleep(2000).then(() => "no reply"),
  ])

describe("util.rpc", () => {
  test("does not lose a request sent while the worker module is still initializing", async () => {
    // Given: the worker's asynchronous module initialization is held before Rpc.listen.
    await using tmp = await tmpdir()
    const gate = path.join(tmp.path, "release")
    const delayed = new Worker(new URL("../fixture/rpc-worker.ts", import.meta.url), {
      env: { ...process.env, RPC_FIXTURE_GATE: gate },
    })
    using _cleanup = { [Symbol.dispose]: () => delayed.terminate() }
    const waiting = Promise.withResolvers<void>()
    const ticking = Promise.withResolvers<void>()
    const ready = Promise.withResolvers<void>()
    const early = Rpc.client<typeof rpc>(delayed)
    early.on("fixture.loading", () => waiting.resolve())
    early.on("fixture.ready", () => ready.resolve())
    let ticks = 0
    early.on("fixture.tick", () => {
      if (++ticks === 2) ticking.resolve()
    })
    await waiting.promise

    // When: a request arrives during initialization, then the worker is released.
    const result = Promise.all([
      settle(early.call("echo", "first queued")),
      settle(early.call("echo", "second queued")),
    ])
    await ticking.promise
    await Bun.write(gate, "release")
    await ready.promise

    // Then: both the early request and a later request receive their own replies.
    expect(await settle(early.call("echo", "after initialization completed"))).toEqual({
      value: "after initialization completed",
    })
    expect(await result).toEqual([{ value: "first queued" }, { value: "second queued" }])
    expect(await early.call("seen", undefined)).toEqual([
      "first queued",
      "second queued",
      "after initialization completed",
    ])
  })

  test("resolves with the worker's result", async () => {
    expect(await settle(client.call("echo", "hello"))).toEqual({ value: "hello" })
  })

  test("rejects queued and future calls when the worker fails before receiver readiness", async () => {
    // Given: a worker whose imported bootstrap fails before installing Rpc.listen.
    const failed = new Worker(new URL("../fixture/rpc-worker.ts", import.meta.url), {
      env: { ...process.env, RPC_FIXTURE_FAILURE: "startup" },
    })
    using _cleanup = { [Symbol.dispose]: () => failed.terminate() }
    const transport = Rpc.client<typeof rpc>(failed)

    // When: a request is queued during that failed startup.
    const result = await settle(transport.call("echo", "queued"))

    // Then: neither that request nor a later call can wait forever.
    expect(result).toEqual({ error: expect.stringContaining("fixture worker startup failed") })
    expect(await settle(transport.call("echo", "later"))).toEqual({
      error: expect.stringContaining("fixture worker startup failed"),
    })
  })

  test("rejects an outstanding call when its worker exits without a reply", async () => {
    // Given: a worker with a method that exits before answering.
    const exiting = new Worker(new URL("../fixture/rpc-worker.ts", import.meta.url))
    using _cleanup = { [Symbol.dispose]: () => exiting.terminate() }
    const transport = Rpc.client<typeof rpc>(exiting)

    // When: the request makes that worker exit.
    const result = await settle(transport.call("exits", undefined))

    // Then: the transport reports closure and refuses subsequent requests.
    expect(result).toEqual({ error: "RPC worker closed before replying" })
    expect(await settle(transport.call("echo", "later"))).toEqual({ error: "RPC worker closed before replying" })
  })

  test("rejects when the worker's method throws", async () => {
    expect(await settle(client.call("throws", undefined))).toEqual({ error: "thrown in the worker" })
  })

  test("rejects with the cause's message when the error has none of its own", async () => {
    expect(await settle(client.call("wrapped", undefined))).toEqual({ error: "the cause says why" })
  })

  test("rejects when the worker's method rejects, and keeps serving", async () => {
    expect(await settle(client.call("rejects", undefined))).toEqual({ error: "rejected in the worker" })
    expect(await settle(client.call("echo", "still there"))).toEqual({ value: "still there" })
  })
})
