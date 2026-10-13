import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createMemo, createSignal, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { TuiConfig, useTuiConfig } from "../../config"
import { useKV } from "../../context/kv"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { usePluginRuntime } from "../../plugin/runtime"

import { getScrollAcceleration } from "../../util/scroll"
import { WorkspaceLabel } from "../../component/workspace-label"

type KV = Pick<ReturnType<typeof useKV>, "get" | "set">
type Config = Pick<TuiConfig.Info, "sidebar">

// sidebar.pin_title set in tui.json decides on every start and /pin-title then lasts until opencode
// exits, across sessions; unset, /pin-title is remembered in kv.json.
const [titlePinToggled, setTitlePinToggled] = createSignal<boolean>()

export function sidebarTitlePinned(config: Config, kv: KV) {
  return titlePinToggled() ?? config.sidebar?.pin_title ?? kv.get("sidebar_pin_title", false)
}

// Returns the message to show when the toggle lasts only until exit.
export function toggleSidebarTitlePin(config: Config, kv: KV) {
  const next = !sidebarTitlePinned(config, kv)
  const configured = config.sidebar?.pin_title
  if (configured === undefined) return kv.set("sidebar_pin_title", next)
  setTitlePinToggled(next === configured ? undefined : next)
  if (next !== configured)
    return `Sidebar title ${next ? "pinned" : "unpinned"} until opencode exits: tui.json sets sidebar.pin_title`
}

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const pluginRuntime = usePluginRuntime()
  const project = useProject()
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const kv = useKV()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const workspace = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return
    return project.workspace.get(workspaceID)
  }
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const pinned = () => sidebarTitlePinned(tuiConfig, kv)
  const title = () => (
    <pluginRuntime.Slot
      name="sidebar_title"
      mode="single_winner"
      session_id={props.sessionID}
      title={session()!.title}
      share_url={session()!.share?.url}
    >
      <box paddingRight={1}>
        <text fg={theme.text}>
          <b>{session()!.title}</b>
        </text>
        <Show when={InstallationChannel !== "latest"}>
          <text fg={theme.textMuted}>{props.sessionID}</text>
        </Show>
        <Show when={session()!.workspaceID}>
          <text fg={theme.textMuted}>
            <Show
              when={workspace()}
              fallback={<WorkspaceLabel type="unknown" name={session()!.workspaceID!} status="error" icon />}
            >
              {(item) => (
                <WorkspaceLabel
                  type={item().type}
                  name={item().name}
                  status={project.workspace.status(item().id) ?? "error"}
                  icon
                />
              )}
            </Show>
          </text>
        </Show>
        <Show when={session()!.share?.url}>
          <text fg={theme.textMuted}>{session()!.share!.url}</text>
        </Show>
      </box>
    </pluginRuntime.Slot>
  )

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <Show when={pinned()}>
          <box flexShrink={0} paddingRight={1} paddingBottom={1}>
            {title()}
          </box>
        </Show>
        <scrollbox
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={1} paddingRight={1}>
            <Show when={!pinned()}>{title()}</Show>
            <pluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <pluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.success }}>•</span> <b>Open</b>
              <span style={{ fg: theme.text }}>
                <b>Code</b>
              </span>{" "}
              <span>{InstallationVersion}</span>
            </text>
          </pluginRuntime.Slot>
        </box>
      </box>
    </Show>
  )
}
