import { expect, test } from "bun:test"
import { Schema } from "effect"
import { EngineStop } from "../src/engine-stop.js"

const identity = { expectedGeneration: "engine-one", operationID: "stop-one" }
const decodedIdentity = {
  expectedGeneration: EngineStop.Generation.make(identity.expectedGeneration),
  operationID: EngineStop.OperationID.make(identity.operationID),
}

test("idle preparation requires the revision while force rejects an idle snapshot", () => {
  const decode = Schema.decodeUnknownSync(EngineStop.PrepareInput)
  expect(() => decode({ ...identity, mode: "idle" })).toThrow()
  expect(decode({ ...identity, mode: "idle", expectedActivityRevision: 4 })).toEqual({
    ...decodedIdentity,
    mode: "idle",
    expectedActivityRevision: EngineStop.ActivityRevision.make(4),
  })
  expect(() => decode({ ...identity, mode: "force-restart", expectedActivityRevision: 4 })).toThrow()
  expect(decode({ ...identity, mode: "force-restart" })).toEqual({ ...decodedIdentity, mode: "force-restart" })
})

for (const waitMs of [-1, 0.5, 30_001, Infinity]) {
  test(`request waiting rejects ${waitMs} milliseconds`, () => {
    const input = { ...identity, mode: "force-restart", waitMs }
    expect(() => Schema.decodeUnknownSync(EngineStop.PrepareInput)(input)).toThrow()
    expect(() => Schema.decodeUnknownSync(EngineStop.GetQuery)({ waitMs })).toThrow()
  })
}

for (const waitMs of [0, 30_000]) {
  test(`request waiting accepts the ${waitMs} millisecond boundary`, () => {
    const input = { ...identity, mode: "force-restart", waitMs }
    expect(Schema.decodeUnknownSync(EngineStop.PrepareInput)(input)).toEqual({
      ...decodedIdentity,
      mode: "force-restart",
      waitMs,
    })
    expect(Schema.decodeUnknownSync(EngineStop.GetQuery)({ waitMs })).toEqual({ waitMs })
  })
}

test("optional wait and operation query fields disappear from encoded requests", () => {
  expect(Schema.encodeSync(EngineStop.GetQuery)({ operationID: undefined, waitMs: undefined })).toEqual({})
  expect(
    Schema.encodeSync(EngineStop.PrepareInput)({
      expectedGeneration: EngineStop.Generation.make(identity.expectedGeneration),
      operationID: EngineStop.OperationID.make(identity.operationID),
      mode: "force-restart",
      waitMs: undefined,
    }),
  ).toEqual({ ...identity, mode: "force-restart" })
})
