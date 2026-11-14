export * as SessionModelRequestTools from "./model-request-tools.js"

import { JsonSchema, type LanguageModel, type ToolDefinition } from "@opencode/ai/effect"
import { Anthropic, OpenAI } from "@opencode/ai/providers"
import type { SessionContext } from "@opencode/plugin/effect/session"
import { Schema } from "effect"

type Definitions = SessionContext["tools"]
const cloneInput = Schema.decodeSync(Schema.fromJsonString(JsonSchema))

export const prepare = (definitions: ReadonlyArray<ToolDefinition>) => {
  // Remember which tool each definition object came from. Hooks rename a tool by moving
  // its definition to a new key, so after the hook we find the tool by object identity.
  // Definitions are shared across steps and sessions, and hooks may edit schemas in place,
  // so each hook gets a deep copy.
  const given = new Map<Definitions[string], ToolDefinition>(
    definitions.map(
      (tool) =>
        [
          {
            description: tool.description,
            input: cloneInput(JSON.stringify(tool.inputSchema)),
            deferred: tool.deferred,
          },
          tool,
        ] as const,
    ),
  )
  return {
    tools: Object.fromEntries(Array.from(given, ([draft, tool]) => [tool.name, draft])),
    reconcile: (current: Definitions | undefined) => {
      // Match by identity first, then by key. Entries matching neither were invented by a
      // hook and are dropped. `tool.name` stays the real name so execution can map renames back.
      const byName = new Map(definitions.map((tool) => [tool.name, tool]))
      return new Map(
        Object.entries(current ?? {}).flatMap(([name, draft]) => {
          const tool = given.get(draft) ?? byName.get(name)
          return tool
            ? [
                [
                  name,
                  { ...tool, description: draft.description, inputSchema: draft.input, deferred: draft.deferred },
                ] as const,
              ]
            : []
        }),
      )
    },
  }
}

export const declarations = (
  hooked: ReadonlyMap<string, ToolDefinition>,
  protocol: LanguageModel["route"]["protocol"],
) => {
  const deferred = Array.from(hooked.values()).some((tool) => tool.deferred === true)
  const search = !deferred
    ? []
    : protocol === "anthropic-messages"
      ? [Anthropic.toolSearch()]
      : protocol === "openai-responses"
        ? [OpenAI.toolSearch()]
        : []
  return [...Array.from(hooked, ([name, tool]) => ({ ...tool, name })), ...search]
}
