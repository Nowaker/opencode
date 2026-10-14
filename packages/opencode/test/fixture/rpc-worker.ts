import "./rpc-worker-bootstrap"
import { Rpc } from "../../src/util/rpc"

const order: string[] = []

export const rpc = {
  echo(input: string) {
    order.push(input)
    return input
  },
  seen() {
    return order.slice()
  },
  throws() {
    throw new Error("thrown in the worker")
  },
  async rejects() {
    throw new Error("rejected in the worker")
  },
  wrapped() {
    throw new Error("", { cause: new Error("the cause says why") })
  },
  exits() {
    process.exit(0)
  },
}

Rpc.listen(rpc)
Rpc.emit("fixture.ready", undefined)
