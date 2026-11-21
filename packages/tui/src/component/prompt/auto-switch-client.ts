import type { OpenCodeClient } from "@opencode/client"
import { RouteSwitch } from "@opencode/schema/route-switch"
import { Schema } from "effect"

export type AutoSwitchAction =
  | Omit<Extract<RouteSwitch.Mutation, { preference: RouteSwitch.Preference }>, "revision" | "ownerEpoch">
  | { readonly action: "return-to-preferred" }
  | { readonly action: "retry-quota-stop" }

type Mutation = AutoSwitchAction & { readonly ownerEpoch: string; readonly revision: number }

export function createAutoSwitchClient(api: OpenCodeClient, sessionID: string, lifetime: AbortSignal) {
  const options = () => ({ signal: AbortSignal.any([lifetime, AbortSignal.timeout(5_000)]) })
  const decode = Schema.decodeUnknownOption(RouteSwitch.Status)
  const status = (input: unknown) => {
    const result = decode(input)
    return result._tag === "Some" && result.value.sessionID === sessionID ? result.value : undefined
  }

  return {
    capabilities: () => api.server.info(options()).then((info) => info.capabilities),
    read: () => api.experimental.session.autoSwitch.get({ sessionID }, options()).then(status),
    edit: (payload: Mutation) => {
      const result =
        payload.action === "retry-quota-stop"
          ? api.experimental.session.autoSwitch.retry(
              { sessionID, ownerEpoch: payload.ownerEpoch, revision: payload.revision },
              options(),
            )
          : api.experimental.session.autoSwitch.edit({ sessionID, payload }, options())
      return result.then(
        (body) => {
          const snapshot = status(body)
          return snapshot?.availability === "available" &&
            snapshot.ownerEpoch === payload.ownerEpoch &&
            snapshot.revision > payload.revision &&
            acknowledges(snapshot, payload)
            ? { kind: "saved" as const, status: snapshot }
            : { kind: "unconfirmed" as const }
        },
        (error: unknown) => {
          if (!(error instanceof Error) || !("_tag" in error) || !("data" in error))
            return { kind: "unconfirmed" as const }
          const snapshot = status(error.data)
          if (snapshot && error._tag === "AutoSwitchConflict") return { kind: "conflict" as const, status: snapshot }
          if (snapshot && error._tag === "AutoSwitchUnavailable")
            return { kind: "unavailable" as const, status: snapshot }
          return { kind: "unconfirmed" as const }
        },
      )
    },
  }
}

function acknowledges(status: RouteSwitch.Status, payload: Mutation) {
  switch (payload.action) {
    case "retry-quota-stop":
      return true
    case "set-preference":
      return status.preference === payload.preference
    case "set-return-preference":
      return status.returnPreference === payload.preference
    case "return-to-preferred":
      return status.returnPending
    default:
      return payload satisfies never
  }
}
