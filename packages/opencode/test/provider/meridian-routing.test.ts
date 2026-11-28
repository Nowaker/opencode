import { describe, expect, test } from "bun:test"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect } from "effect"
import { MeridianRouting } from "../../src/provider/meridian-routing"
import { createProviderFixture } from "../fixture/phase2-provider-fixture"
import { it } from "../lib/effect"

const trust = {
  claudeInferenceURL: "http://127.0.0.1:3457/v1/messages",
  chatgptAvailabilityURL: "http://127.0.0.1:3458/profiles/route-availability",
}

function model(providerID: string, npm: string) {
  return {
    providerID,
    api: { id: "claude-opus-5-5", npm },
    variants: { high: { effort: "high" } },
  } as unknown as Parameters<typeof MeridianRouting.transportFor>[1]
}

describe("MeridianRouting.routeProvider", () => {
  test("Vibeterm's restricted Claude provider routes like anthropic, so a spent route can auto-switch", () => {
    expect(MeridianRouting.routeProvider("anthropic-restricted")).toBe("claude")
    const transport = MeridianRouting.transportFor(trust, model("anthropic-restricted", "@ai-sdk/anthropic"))
    expect(transport?.type).toBe("claude")
    expect(transport?.wireModel).toBe("claude-opus-5-5")
  })

  test("anthropic-cybersec stays off the auto-switch routes: security work is never moved to GPT", () => {
    expect(MeridianRouting.routeProvider("anthropic-cybersec")).toBeUndefined()
  })
})

for (const row of [
  { providerID: "anthropic", provider: "claude", preference: "on", expected: "on" },
  { providerID: "anthropic", provider: "claude", preference: "off", expected: "off" },
  { providerID: "anthropic", provider: "claude", preference: "inherit", expected: undefined },
  { providerID: "anthropic-restricted", provider: "claude", preference: "off", expected: undefined },
  { providerID: "anthropic-meridian", provider: "claude", preference: "on", expected: undefined },
  { providerID: "openai", provider: "chatgpt", preference: "on", expected: undefined },
] as const) {
  it.live(`availability GET for ${row.providerID} with ${row.preference} sends preservation ${row.expected ?? "absent"}`, () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(
        Effect.sync(() => createProviderFixture()),
        (server) => Effect.promise(() => server.close()),
      )
      const direct = yield* Effect.acquireRelease(
        Effect.sync(() => createProviderFixture()),
        (server) => Effect.promise(() => server.close()),
      )
      const isClaude = row.provider === "claude"
      const modelID = isClaude ? "claude-opus-5-5" : "gpt-6.2-sol"
      const inference = new URL(isClaude ? "/v1/messages" : "/v1/responses", direct.url)
      const input = {
        provider: row.provider,
        model: {
          providerID: ProviderV2.ID.make(row.providerID),
          api: { id: modelID, npm: isClaude ? "@ai-sdk/anthropic" : "@ai-sdk/openai", url: inference.href },
          variants: { portable: isClaude ? { effort: "high" } : { reasoningEffort: "high" } },
        },
        variant: "portable",
        cybersecPreservation: row.preference,
      }

      const availability = yield* MeridianRouting.probe(input).pipe(
        Effect.provideService(MeridianRouting.Trust, {
          claudeInferenceURL: new URL("/v1/messages", fixture.url).href,
          chatgptAvailabilityURL: new URL("/profiles/route-availability", fixture.url).href,
          availabilityAPIKey: "fixture-probe-key",
        }),
      )

      expect(availability).toEqual(expect.any(Number))
      expect(fixture.unexpected).toEqual([])
      expect([...direct.captured, ...direct.unexpected]).toEqual([])
      expect(fixture.captured.map((request) => ({
        method: request.method,
        path: request.path,
        query: request.query,
        apiKey: request.headers["x-api-key"],
        preservation: request.headers["x-meridian-cybersec-preservation"],
      }))).toEqual([{
        method: "GET",
        path: "/profiles/route-availability",
        query: { provider: row.provider, model: modelID, variant: "high" },
        apiKey: "fixture-probe-key",
        preservation: row.expected,
      }])
    }),
  )
}
