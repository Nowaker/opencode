import { useData, locationKey } from "../../context/data"
import { useLocal } from "../../context/local"
import { useLocation } from "../../context/location"
import { useToast } from "../../ui/toast"
import { Locale } from "../../util/locale"
import type { ModelPreferenceModel } from "../../model-preference"
import type { SubmitBinding, SubmitResolution } from "./submit-intent"

export function createSubmitSelection(input: {
  readonly sessionID: string | undefined
  readonly mode: () => "normal" | "shell"
  readonly warnModel: () => void
}) {
  const data = useData()
  const local = useLocal()
  const location = useLocation()
  const toast = useToast()
  const key = () => locationKey(location.ref ?? data.location.default())

  function describe(
    where: string | undefined,
    agentID: string | undefined,
    selection: (ModelPreferenceModel & { readonly variant?: string | undefined }) | undefined,
  ) {
    const model = local.model.describe(selection)
    return {
      location: where,
      sessionID: input.sessionID,
      agentID,
      providerID: selection?.providerID,
      modelID: selection?.modelID,
      agentLabel: agentID === undefined ? undefined : Locale.titlecase(agentID),
      agentColor: agentID === undefined ? undefined : local.agent.color(agentID),
      modelLabel: model.model,
      providerLabel: model.provider,
      variant: selection?.variant,
    }
  }

  function capture(shown: ReturnType<typeof describe>): SubmitBinding | undefined {
    if (
      shown.location === key() &&
      shown.sessionID === input.sessionID &&
      shown.agentID !== undefined &&
      shown.providerID !== undefined &&
      shown.modelID !== undefined
    )
      return {
        sessionID: input.sessionID,
        location: shown.location,
        agentID: shown.agentID,
        providerID: shown.providerID,
        modelID: shown.modelID,
        variant: shown.variant,
      }
    if (input.sessionID === undefined) return
    const agentID = local.agent.requested()
    const model = local.model.requested()
    if (agentID === undefined || model === undefined) return
    return { sessionID: input.sessionID, location: key(), agentID, ...model, variant: model.variant }
  }

  function unavailable(title: string, message: string): SubmitResolution {
    return { type: "unavailable", show: () => toast.show({ title, message, variant: "warning" }) }
  }

  function resolve(captured?: SubmitBinding, deferred = false): SubmitResolution {
    const agents = data.location.agent.list(location.ref)
    const models = data.location.model.list(location.ref)
    if (deferred) {
      // These promises have settled. Missing publication is a terminal failure, not another wait or retry.
      if (
        agents === undefined ||
        models === undefined ||
        data.location.provider.list(location.ref) === undefined ||
        data.location.config.list(location.ref) === undefined ||
        (input.sessionID !== undefined && data.session.get(input.sessionID) === undefined)
      )
        return unavailable("Failed to send prompt", "The model list is not available in this session's location")
      if (captured === undefined && !local.model.ready) return { type: "loading" }
    }
    const agent = captured ? agents?.find((item) => item.id === captured.agentID) : local.agent.current()
    const model = captured ?? local.model.selection()
    const usesModel = input.sessionID === undefined || input.mode() !== "shell"
    if (!agent || !model || (usesModel && !local.model.available(model))) {
      if (!deferred && (agents === undefined || models === undefined)) return { type: "loading" }
      if (!agent)
        return unavailable("Agent unavailable", `${captured?.agentID ?? "No agent"} is not available in this session's location`)
      if (!model) return { type: "unavailable", show: input.warnModel }
      return unavailable("Model unavailable", `${model.providerID}/${model.modelID} is not available in this session's location`)
    }
    if (
      captured?.variant !== undefined &&
      usesModel &&
      !models?.some(
        (item) =>
          item.providerID === captured.providerID &&
          item.id === captured.modelID &&
          item.variants.some((variant) => variant.id === captured.variant),
      )
    )
      return unavailable("Model unavailable", `The selected variant ${captured.variant} is not available`)
    return {
      type: "ready",
      binding: captured ?? {
        sessionID: input.sessionID,
        location: key(),
        agentID: agent.id,
        providerID: model.providerID,
        modelID: model.modelID,
        variant: model.variant,
      },
    }
  }

  return {
    key,
    describe,
    capture,
    resolve,
    load: () => Promise.all([
      data.location.agent.sync(location.ref),
      data.location.model.sync(location.ref),
      data.location.provider.sync(location.ref),
      data.location.config.sync(location.ref),
      input.sessionID === undefined ? undefined : data.session.sync(input.sessionID),
    ]),
  }
}
