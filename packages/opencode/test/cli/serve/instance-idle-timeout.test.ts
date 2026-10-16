import { ConfigServerV1 } from "@opencode-ai/core/v1/config/server"
import { expect, test } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import { resolveInstanceIdleTimeout } from "../../../src/cli/network"
import { Config } from "../../../src/config/config"
import { testEffect } from "../../lib/effect"

for (const timeout of [undefined, 0, 1234]) {
  const it = testEffect(
    Layer.mock(Config.Service, {
      getGlobal: () => Effect.succeed({ server: timeout === undefined ? {} : { instanceIdleTimeout: timeout } }),
    }),
  )
  it.effect(`resolves the serve idle timeout ${timeout} from global configuration`, () =>
    Effect.gen(function* () {
      expect(yield* resolveInstanceIdleTimeout).toBe(timeout ?? 900_000)
    }),
  )
}

for (const timeout of [-1, 1.5, "100", Number.POSITIVE_INFINITY]) {
  test(`rejects invalid server idle timeout ${timeout}`, () => {
    expect(() => Schema.decodeUnknownSync(ConfigServerV1.Server)({ instanceIdleTimeout: timeout })).toThrow()
  })
}
