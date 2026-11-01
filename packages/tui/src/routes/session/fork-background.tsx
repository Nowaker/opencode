import { Identifier } from "@opencode-ai/core/id/id"
import type { Part, UserMessage } from "@opencode-ai/sdk/v2"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { useTuiPaths } from "../../context/runtime"
import { useDialog } from "../../ui/dialog"
import { DialogConfirm } from "../../ui/dialog-confirm"
import { useToast } from "../../ui/toast"
import { saveDraft } from "../../component/prompt/draft-stash"
import type { PromptInfo } from "../../component/prompt/history"
import { stripPromptPartIDs as strip } from "../../prompt/part"
import { errorMessage } from "../../util/error"

// Where a background fork cuts the session. "message" keeps an assistant message that is still streaming,
// settled; "last-message" leaves it out; "last-prompt" stops before the newest prompt and hands it to the
// new session's composer, as /fork does.
export type ForkPoint = "message" | "last-message" | "last-prompt"

const label: Record<ForkPoint, string> = {
  message: "this message",
  "last-message": "the last message",
  "last-prompt": "the last prompt",
}

/**
 * Forks a session into a new one without leaving it: the view stays, a turn in progress keeps running, and the
 * session gets a notice with the new ID, which only the reader sees.
 */
export function useBackgroundFork() {
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const paths = useTuiPaths()

  return async (sessionID: string, point: ForkPoint) => {
    const messages = sync.data.message[sessionID] ?? []
    const prompts = messages.filter(
      (message): message is UserMessage =>
        message.role === "user" && (sync.data.part[message.id] ?? []).some(isPromptText),
    )
    const prompt = prompts.at(-1)
    if (point === "last-prompt" && !prompt) {
      toast.show({ variant: "warning", message: "No prompt to fork before", duration: 3000 })
      return
    }
    const confirmed = await DialogConfirm.show(
      dialog,
      "Fork in background",
      `Fork this session from ${label[point]} into a new session? You stay here, and a running turn keeps going.`,
    )
    if (!confirmed) return

    const id = Identifier.descending("session")
    toast.show({ variant: "info", message: `Forking this session into ${id}…`, duration: 4000 })
    const forked = await sdk.client.session
      .fork({
        sessionID,
        id,
        unsettled: point === "last-message" ? "exclude" : "settle",
        ...(point === "last-prompt" && { messageID: prompt!.id }),
      })
      .catch((error: unknown) => ({ data: undefined, error }))
    if (!forked.data) {
      toast.show({ variant: "error", message: `Fork failed: ${errorMessage(forked.error)}`, duration: 6000 })
      return
    }
    if (point === "last-prompt") {
      const draft = promptDraft(sync.data.part[prompt!.id] ?? [])
      await saveDraft(paths.state, id, { prompt: draft, cursor: draft.input.length }).catch((error: unknown) =>
        toast.show({ variant: "warning", message: `Prompt not kept for ${id}: ${errorMessage(error)}` }),
      )
    }

    toast.show({ variant: "success", message: `Forked this session into ${id}`, duration: 5000 })
    // The notice copies the last prompt's agent and model: the composer takes both from the newest user message.
    await sdk.client.session
      .prompt({
        sessionID,
        noReply: true,
        ...(prompt && {
          agent: prompt.agent,
          model: { providerID: prompt.model.providerID, modelID: prompt.model.modelID },
          variant: prompt.model.variant,
        }),
        parts: [{ type: "text", text: `Background fork from ${label[point]} finished: ${id}`, ignored: true }],
      })
      .catch((error: unknown) =>
        toast.show({ variant: "warning", message: `Fork notice not posted: ${errorMessage(error)}` }),
      )
  }
}

function isPromptText(part: Part) {
  return part.type === "text" && !part.synthetic && !part.ignored
}

function promptDraft(parts: Part[]) {
  return parts.reduce(
    (draft, part) => {
      if (part.type === "text" && !part.synthetic) draft.input += part.text
      if (part.type === "file") draft.parts.push(strip(part))
      return draft
    },
    { input: "", parts: [] as PromptInfo["parts"] },
  )
}
