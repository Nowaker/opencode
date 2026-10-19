import type { Plugin } from "@opencode-ai/plugin"

export default (async () => ({
  "chat.message": async (_input, output) => {
    output.message.agent = "plan"
    const model = { providerID: "test", modelID: "test-model", variant: "high" }
    output.message.model = model
  },
})) satisfies Plugin
