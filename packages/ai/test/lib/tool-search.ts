import { ToolDefinition } from "../../src/effect.js"
import { Anthropic, OpenAI } from "../../src/providers.js"

export const openai = OpenAI.configure({ apiKey: false }).responses("deployment")
export const anthropic = Anthropic.configure({ apiKey: false }).model("deployment")
export const functionTool = (deferred?: boolean) =>
  ToolDefinition.make({
    name: "lookup",
    description: "Lookup",
    inputSchema: { type: "object", properties: {} },
    deferred,
  })
