import type { RouteSwitch } from "@opencode/schema/route-switch"
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js"
import { useData } from "../../context/data"
import { Keymap, type KeymapCommand } from "../../context/keymap"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { Locale } from "../../util/locale"
import { createAutoSwitchState } from "./auto-switch-state"

const reasonDetail: Record<RouteSwitch.Reason, string | undefined> = {
  "session-on": undefined,
  "session-off": undefined,
  "rule-on": "by rule",
  "rule-off": "by rule",
  "default-on": "default",
  "default-off": "default",
  "global-disabled": "disabled globally",
  pinned: "pinned",
  "older-engine": "older engine",
  "owner-unavailable": "owner unavailable",
  "policy-unavailable": "policy unavailable",
  "no-approved-alternate": "no approved alternate",
  "route-ineligible": "route ineligible",
  "unsafe-step": "unsafe step",
  "stale-evidence": "stale evidence",
  attempted: "already attempted",
  "alternate-active": undefined,
  "return-pending": undefined,
  busy: "busy",
}

export function PromptAutoSwitch(props: { readonly sessionID: string; readonly disabled: boolean }) {
  const theme = useTheme()
  const dialog = useDialog()
  const data = useData()
  const state = createAutoSwitchState(props.sessionID)
  const enabled = () => !props.disabled && state.editable()
  const snapshot = () => (state.access() === "ready" ? state.status() : undefined)
  const supported = () => snapshot()?.availability === "available"
  const idle = () =>
    data.session.status(props.sessionID) === "idle" && data.session.pending.list(props.sessionID).length === 0
  const previewExpiry = () => snapshot()?.previewExpiresAt
  const [expiredPreview, setExpiredPreview] = createSignal<number>()
  createEffect(() => {
    const expiresAt = previewExpiry()
    if (expiresAt === undefined) return
    const delay = expiresAt - Date.now()
    if (delay <= 0) {
      setExpiredPreview(expiresAt)
      return
    }
    const timer = setTimeout(() => setExpiredPreview(expiresAt), delay)
    onCleanup(() => clearTimeout(timer))
  })
  const previewExpired = () => {
    const expiresAt = previewExpiry()
    return expiresAt !== undefined && (!idle() || expiredPreview() === expiresAt || expiresAt <= Date.now())
  }
  const retry = () =>
    !props.disabled &&
    !state.pending() &&
    (state.access() === "unreadable" || snapshot()?.availability === "unavailable")
  const alternate = createMemo(() => {
    const status = snapshot()
    if (!status?.effective || !status.preferred || sameRoute(status.effective, status.preferred)) return
    return status.effective
  })
  const refreshPreview = createMemo(() => supported() && !!alternate() && idle())
  createEffect(() => {
    if (!refreshPreview()) return
    untrack(state.refresh)
    // Idle route evidence lasts at most 30 seconds. Status reads never start inference.
    const timer = setInterval(state.refresh, 20_000)
    onCleanup(() => clearInterval(timer))
  })
  const sticky = () =>
    alternate() &&
    (snapshot()?.returnState === "alternate" ||
      snapshot()?.returnState === "return-off" ||
      previewExpiry() !== undefined)
  const manualReturn = () => sticky() && !snapshot()?.returnPending
  const canReturn = () => enabled() && !!manualReturn()
  const toggle = () => {
    const current = snapshot()
    if (enabled() && current)
      state.edit({ action: "set-preference", preference: togglePreference(current.preference, current.enabled) })
  }
  const toggleReturn = () => {
    const current = snapshot()
    if (enabled() && current)
      state.edit({
        action: "set-return-preference",
        preference: togglePreference(current.returnPreference, current.returnEnabled),
      })
  }
  const returnToPreferred = () => {
    if (canReturn()) state.edit({ action: "return-to-preferred" })
  }
  const canRetryQuota = () => !props.disabled && idle() && state.retryable()
  const retryQuota = () => {
    if (canRetryQuota()) state.edit({ action: "retry-quota-stop" })
  }

  Keymap.createLayer(() => ({
    mode: "global",
    enabled: !props.disabled,
    commands: [
      { slug: "auto-switch", title: "Toggle auto-switch", enabled: enabled(), run: toggle },
      {
        slug: "auto-switch-default",
        title: "Auto-switch: follow the default",
        enabled: enabled() && snapshot()?.preference !== "inherit",
        run: () => state.edit({ action: "set-preference", preference: "inherit" }),
      },
      { slug: "auto-return", title: "Toggle auto-return", enabled: enabled(), run: toggleReturn },
      {
        slug: "auto-return-default",
        title: "Auto-return: follow the default",
        enabled: enabled() && snapshot()?.returnPreference !== "inherit",
        run: () => state.edit({ action: "set-return-preference", preference: "inherit" }),
      },
      { slug: "auto-switch-return", title: "Return to preferred model", enabled: canReturn(), run: returnToPreferred },
      { slug: "auto-switch-retry", title: "Retry quota-stopped step", enabled: canRetryQuota(), run: retryQuota },
      { slug: "auto-switch-refresh", title: "Retry auto-switch status", enabled: retry(), run: state.refresh },
    ].map(
      ({ slug, run, ...command }) =>
        ({
          ...command,
          id: `session.${slug}`,
          group: "Session",
          slash: { name: slug },
          bind: false,
          palette: true,
          run: () => {
            dialog.clear()
            if (command.enabled) run()
          },
        }) satisfies KeymapCommand,
    ),
  }))

  const label = () => {
    const access = state.access()
    switch (access) {
      case "connecting":
        return "unavailable (engine disconnected)"
      case "loading":
        return "loading..."
      case "unsupported":
        return "unsupported (older engine)"
      case "unreadable":
        return "status unavailable"
      case "ready": {
        const status = snapshot()
        if (!status) return "status unavailable"
        const value =
          status.availability === "available" ? preferenceLabel(status.preference, status.enabled) : "unavailable"
        const detail = status && reasonDetail[status.reason]
        return detail ? (status.availability === "available" ? `${value} ${detail}` : `${value} (${detail})`) : value
      }
      default:
        return access satisfies never
    }
  }

  const using = createMemo(() => {
    const route = alternate()
    const preferred = snapshot()?.preferred
    if (!route || !preferred) return
    return `Using ${routeLabel(route, preferred)} (preferred: ${routeLabel(preferred, route)})`
  })
  const next = createMemo(() => {
    const status = snapshot()
    if (!status || status.availability !== "available") return
    if (!status.next || previewExpired()) return alternate() ? "unverified" : undefined
    const effective = status.effective ?? status.preferred
    const same = effective && sameRoute(status.next, effective)
    if (same && !alternate()) return
    return `${routeLabel(status.next, effective)}${same ? "" : " (preview)"}`
  })

  return (
    <box width="100%" flexShrink={0}>
      <box flexDirection="row" flexWrap="wrap" columnGap={2}>
        <RouteAction label={`Auto-switch: ${label()}`} enabled={enabled()} run={toggle} />
        <Show when={supported()}>
          <RouteAction
            label={`Auto-return: ${preferenceLabel(snapshot()?.returnPreference ?? "inherit", snapshot()?.returnEnabled === true)}${snapshot()?.returnPreference === "inherit" ? " default" : ""}`}
            enabled={enabled()}
            run={toggleReturn}
          />
        </Show>
        <Show when={retry()}>
          <RouteAction label="Retry status" enabled run={state.refresh} />
        </Show>
        <Show
          when={state.pending()}
          fallback={
            <Show when={state.notice()}>
              {(notice) => (
                <text
                  fg={
                    notice().kind === "accepted"
                      ? theme.text.feedback.info.base
                      : notice().kind === "saved"
                        ? theme.text.feedback.success.base
                        : theme.text.feedback.error.base
                  }
                >
                  {notice().text}
                </text>
              )}
            </Show>
          }
        >
          <text fg={theme.text.feedback.info.base}>
            {state.pending() === "retry" ? "Requesting retry..." : "Saving..."}
          </text>
        </Show>
      </box>
      <Show when={using()}>
        {(line) => (
          <text fg={theme.text.base} wrapMode="word">
            {line()}
          </text>
        )}
      </Show>
      <Show when={next()}>
        {(route) => (
          <text fg={theme.text.base} wrapMode="word">
            Next: {route()}
          </text>
        )}
      </Show>
      <Show when={snapshot()?.returnPending}>
        <text fg={theme.text.feedback.info.base} wrapMode="word">
          {snapshot()?.returnState === "returning" && previewExpiry() === undefined
            ? "Returning to preferred"
            : "Return to preferred requested"}
        </text>
      </Show>
      <Show when={manualReturn() && supported()}>
        <RouteAction label="Return to preferred" enabled={canReturn()} run={returnToPreferred} />
      </Show>
      <Show when={snapshot()?.quotaStop}>
        {(stop) => (
          <box>
            <text fg={theme.text.feedback.warning.base} wrapMode="word">
              Quota stopped: {routeLabel(stop().route, null)} (
              {stop().reason === "reserve_held" ? "reserve held" : "quota exhausted"})
            </text>
            <Show when={state.retrySupported() && supported()}>
              <RouteAction label="Retry quota-stopped step" enabled={canRetryQuota()} run={retryQuota} />
            </Show>
          </box>
        )}
      </Show>
    </box>
  )
}

function preferenceLabel(preference: RouteSwitch.Preference, enabled: boolean) {
  const effective = enabled ? "On" : "Off"
  if (preference === "inherit" || (preference === "on") === enabled) return effective
  return `${effective} (session ${preference === "on" ? "On" : "Off"})`
}

function togglePreference(preference: RouteSwitch.Preference, enabled: boolean) {
  return (preference === "inherit" ? enabled : preference === "on") ? "off" : "on"
}

function RouteAction(props: { readonly label: string; readonly enabled: boolean; readonly run: () => void }) {
  const theme = useTheme()
  const [hovered, setHovered] = createSignal(false)
  const highlight = () => props.enabled && hovered()
  return (
    <text
      fg={
        props.enabled
          ? highlight()
            ? theme.text.action.primary.hovered
            : theme.text.action.primary.base
          : theme.text.action.primary.disabled
      }
      bg={highlight() ? theme.background.action.primary.hovered : undefined}
      maxWidth="100%"
      wrapMode="word"
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={(event) => {
        if (event.button !== 0 || !props.enabled) return
        event.stopPropagation()
        props.run()
      }}
    >
      {props.label}
    </text>
  )
}

function sameRoute(a: RouteSwitch.Route, b: RouteSwitch.Route) {
  return a.agent === b.agent && a.providerID === b.providerID && a.modelID === b.modelID && a.variant === b.variant
}

function routeLabel(route: RouteSwitch.Route, other: RouteSwitch.Route | null) {
  return [
    route.agent === other?.agent ? undefined : Locale.titlecase(route.agent),
    !other || (route.providerID !== other.providerID && route.modelID === other.modelID)
      ? `${route.providerID}/${route.modelID}`
      : route.modelID,
    route.variant,
  ]
    .filter(Boolean)
    .join(" ")
}
