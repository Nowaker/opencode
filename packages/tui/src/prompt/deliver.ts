import type { TuiComposerDeliverRefusal, TuiComposerDeliverResult } from "@opencode-ai/plugin/tui"
import type { useLocal } from "../context/local"
import type { useProject } from "../context/project"
import type { useSync } from "../context/sync"
import type { PromptSend } from "../plugin/prompt-control"
import type { usePromptAdmission } from "./admission"

type Input = {
  local: ReturnType<typeof useLocal>
  admission: ReturnType<typeof usePromptAdmission>
  sync: ReturnType<typeof useSync>
  project: ReturnType<typeof useProject>
}

/**
 * The composer's own submission, minus the composer: the same agent, model, variant and workspace checks, and the
 * same admission, but the text comes from the caller and nothing is read from or written to the prompt.
 */
export function createPromptSend(input: Input): PromptSend {
  return (request) => {
    const refuse = (reason: TuiComposerDeliverRefusal): TuiComposerDeliverResult => ({ status: "not-ready", reason })
    const agent = input.local.agent.current()
    if (!agent) return refuse("agent")
    const model = input.local.model.current()
    if (!model) return refuse("model")
    const workspaceID = input.sync.session.get(request.sessionID)?.workspaceID
    if (workspaceID && (input.project.workspace.status(workspaceID) ?? "error") !== "connected") return refuse("workspace")
    input.admission.submit({
      messageID: request.messageID,
      sessionID: request.sessionID,
      textPartID: request.partID,
      prompt: { input: request.text, parts: [] },
      delivery: true,
      body: {
        sessionID: request.sessionID,
        messageID: request.messageID,
        ...model,
        agent: agent.name,
        model,
        variant: input.local.model.variant.current(),
        parts: [{ id: request.partID, type: "text", text: request.text }],
      },
    })
    return { status: "submitted", messageID: request.messageID, partID: request.partID }
  }
}
