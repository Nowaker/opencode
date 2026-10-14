import { Rpc } from "../../src/util/rpc"

if (process.env["RPC_FIXTURE_FAILURE"] === "startup") throw new Error("fixture worker startup failed")

const gate = process.env["RPC_FIXTURE_GATE"]
if (gate) {
  Rpc.emit("fixture.loading", undefined)
  while (!(await Bun.file(gate).exists())) {
    await Bun.sleep(5)
    Rpc.emit("fixture.tick", undefined)
  }
}
