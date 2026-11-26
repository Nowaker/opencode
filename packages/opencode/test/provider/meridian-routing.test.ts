import { describe, expect, test } from "bun:test"
import { MeridianRouting } from "../../src/provider/meridian-routing"

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
