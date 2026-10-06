import type { AssistantMessage, Model, Provider, Session } from "@opencode-ai/sdk/v2"

export function sidebarSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "ses_test",
    slug: "test",
    projectID: "proj_test",
    directory: "/tmp/opencode",
    title: "Test session",
    version: "test",
    time: { created: 0, updated: 0 },
    ...overrides,
  }
}

export function sidebarAssistantMessage(
  input: Pick<AssistantMessage, "providerID" | "modelID" | "tokens">,
): AssistantMessage {
  return {
    id: "msg_test",
    sessionID: "ses_test",
    role: "assistant",
    time: { created: 0 },
    parentID: "msg_parent",
    mode: "build",
    agent: "build",
    path: { cwd: "/tmp/opencode", root: "/tmp/opencode" },
    cost: 0,
    ...input,
  }
}

export function sidebarProvider(input: { id: string; model: string; context: number }): Provider {
  const modalities = { text: true, audio: false, image: false, video: false, pdf: false }
  const model: Model = {
    id: input.model,
    providerID: input.id,
    api: { id: input.model, url: "", npm: "" },
    name: input.model,
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: modalities,
      output: modalities,
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: input.context, output: 0 },
    status: "active",
    options: {},
    headers: {},
    release_date: "",
  }
  return { id: input.id, name: input.id, source: "config", env: [], options: {}, models: { [input.model]: model } }
}
