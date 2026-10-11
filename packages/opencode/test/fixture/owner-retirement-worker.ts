import { strictEqual, throws } from "node:assert"
import { OwnerQuiescence } from "../../src/owner/quiescence"
import { InstanceRuntime } from "../../src/project/instance-runtime"
import { registerDisposer } from "../../src/effect/instance-registry"

onmessage = async (event: MessageEvent<string>) => {
  const directory = event.data
  const { rpc } = await import("../../src/cli/tui/worker")
  await InstanceRuntime.load({ directory })
  let disposed = false
  using unregister = {
    [Symbol.dispose]: registerDisposer(async (input) => {
      if (input !== directory) return
      disposed = true
      throws(() => OwnerQuiescence.runPromise(async () => undefined), OwnerQuiescence.Sealed)
    }),
  }
  using lease = OwnerQuiescence.lease()
  strictEqual(OwnerQuiescence.commit(lease), true)
  await rpc.shutdown()
  strictEqual(disposed, true)
  lease[Symbol.dispose]()
  strictEqual(OwnerQuiescence.status().committed, true)
  strictEqual(OwnerQuiescence.status().sealed, true)
  strictEqual(OwnerQuiescence.status().active, 0)
  throws(() => OwnerQuiescence.runPromise(async () => undefined), OwnerQuiescence.Sealed)
  postMessage("retired")
}
