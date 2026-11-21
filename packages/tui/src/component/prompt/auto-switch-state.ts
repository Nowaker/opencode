import type { RouteSwitch } from "@opencode/schema/route-switch"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { useClient } from "../../context/client"
import { createAutoSwitchClient, type AutoSwitchAction } from "./auto-switch-client"

type Access = "connecting" | "loading" | "unsupported" | "unreadable" | "ready"
type Notice = { readonly kind: "saved" | "accepted" | "error"; readonly text: string }

export function createAutoSwitchState(sessionID: string) {
  const client = useClient()
  const [access, setAccess] = createSignal<Access>("connecting")
  const [status, setStatus] = createSignal<RouteSwitch.Status>()
  const [pending, setPending] = createSignal<"save" | "retry">()
  const [retrySupported, setRetrySupported] = createSignal(false)
  const [acceptedRetry, setAcceptedRetry] = createSignal<{ readonly ownerEpoch: string; readonly revision: number }>()
  const [reading, setReading] = createSignal(false)
  const [notice, setNotice] = createSignal<Notice>()
  let refresh: (() => void) | undefined
  let edit: ((action: AutoSwitchAction) => void) | undefined

  const editable = () => {
    const snapshot = status()
    return access() === "ready" && !pending() && snapshot?.availability === "available" && snapshot.reason !== "pinned"
  }
  const retryable = () => {
    const snapshot = status()
    const accepted = acceptedRetry()
    return (
      access() === "ready" &&
      !pending() &&
      retrySupported() &&
      snapshot?.availability === "available" &&
      !!snapshot.quotaStop &&
      !(accepted?.ownerEpoch === snapshot.ownerEpoch && accepted.revision >= snapshot.revision)
    )
  }

  createEffect(() => {
    if (client.connection.status() !== "connected") return
    const controller = new AbortController()
    const api = createAutoSwitchClient(client.api, sessionID, controller.signal)
    let dirty = false
    let writeGeneration = 0
    let supported = false
    setAccess("loading")

    function read() {
      dirty = true
      if (controller.signal.aborted || !supported || pending() || reading()) return
      dirty = false
      const generation = writeGeneration
      setReading(true)
      void api
        .read()
        .then(
          (snapshot) => {
            if (controller.signal.aborted || generation !== writeGeneration) return
            const previous = status()
            if (
              notice()?.kind === "saved" &&
              (snapshot?.ownerEpoch !== previous?.ownerEpoch || snapshot?.revision !== previous?.revision)
            )
              setNotice(undefined)
            setStatus(snapshot)
            setAccess(snapshot ? "ready" : "unreadable")
          },
          () => {
            if (controller.signal.aborted || generation !== writeGeneration) return
            if (notice()?.kind === "saved") setNotice(undefined)
            setStatus(undefined)
            setAccess("unreadable")
          },
        )
        .finally(() => {
          if (controller.signal.aborted) return
          setReading(false)
          if (dirty) read()
        })
    }

    function connect() {
      void api.capabilities().then(
        (value) => {
          if (controller.signal.aborted) return
          supported = value?.autoSwitch === true
          setRetrySupported(value?.autoSwitchRetry === true)
          if (supported) read()
          if (!supported) setAccess("unsupported")
        },
        () => {
          if (controller.signal.aborted) return
          setAccess("unreadable")
        },
      )
    }

    refresh = () => {
      if (supported) return read()
      if (access() !== "unreadable") return
      setAccess("loading")
      connect()
    }
    edit = (action) => {
      const current = status()
      const retry = action.action === "retry-quota-stop"
      if (!(retry ? retryable() : editable()) || current?.availability !== "available") return
      writeGeneration++
      if (reading()) dirty = true
      setNotice(undefined)
      setPending(retry ? "retry" : "save")
      void api.edit({ ...action, ownerEpoch: current.ownerEpoch, revision: current.revision }).then((result) => {
        if (controller.signal.aborted) return
        if (result.kind !== "unconfirmed") setStatus(result.status)
        switch (result.kind) {
          case "saved":
            if (retry && result.status.availability === "available") setAcceptedRetry(result.status)
            setNotice(retry ? { kind: "accepted", text: "Retry requested" } : { kind: "saved", text: "Saved" })
            break
          case "conflict":
            setNotice({
              kind: "error",
              text: retry
                ? "Retry not accepted: status changed"
                : result.status.reason === "pinned"
                  ? "Not saved: route pinned"
                  : "Not saved: changed elsewhere",
            })
            break
          case "unavailable":
            setNotice({
              kind: "error",
              text: retry
                ? "Retry not accepted: owner unavailable"
                : result.status.reason === "pinned"
                  ? "Not saved: route pinned"
                  : "Not saved: auto-switch unavailable",
            })
            break
          case "unconfirmed":
            setNotice({ kind: "error", text: retry ? "Retry unconfirmed" : "Save unconfirmed" })
            dirty = true
            break
          default:
            result satisfies never
        }
        setPending(undefined)
        if (dirty) read()
      })
    }

    const invalidate = (event: { readonly data: { readonly sessionID: string } }) => {
      if (event.data.sessionID === sessionID) read()
    }
    const off = [
      client.event.on("session.route-switch.updated", invalidate),
      client.event.on("session.agent.selected", invalidate),
      client.event.on("session.model.selected", invalidate),
      client.event.on("session.inbox.enqueued", invalidate),
      client.event.on("session.inbox.cancelled", invalidate),
    ]
    connect()
    onCleanup(() => {
      off.forEach((unsubscribe) => unsubscribe())
      controller.abort()
      refresh = undefined
      edit = undefined
      if (pending())
        setNotice({
          kind: "error",
          text:
            pending() === "retry" ? "Retry unconfirmed: engine disconnected" : "Save unconfirmed: engine disconnected",
        })
      if (notice()?.kind !== "error") setNotice(undefined)
      setPending(undefined)
      setRetrySupported(false)
      setReading(false)
      setStatus(undefined)
      setAccess("connecting")
    })
  })

  return {
    access,
    status,
    editable,
    pending,
    retryable,
    retrySupported,
    notice,
    refresh: () => refresh?.(),
    edit: (action: AutoSwitchAction) => edit?.(action),
  }
}
