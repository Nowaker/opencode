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

// sidebar.session_id set in tui.json decides on every start and /session-id then lasts until opencode
// exits; unset, /session-id is remembered in kv.json, and with neither, development builds show it.
const [sessionIDToggled, setSessionIDToggled] = createSignal<boolean>()

export function sidebarShowsSessionID(config: Config, kv: KV) {
  return (
    sessionIDToggled() ??
    config.sidebar?.session_id ??
    kv.get("sidebar_session_id", InstallationChannel !== "latest")
  )
}

// Returns the message to show when the toggle lasts only until exit.
export function toggleSidebarSessionID(config: Config, kv: KV) {
  const next = !sidebarShowsSessionID(config, kv)
  const configured = config.sidebar?.session_id
  if (configured === undefined) return kv.set("sidebar_session_id", next)
  setSessionIDToggled(next === configured ? undefined : next)
  if (next !== configured)
    return `Session ID ${next ? "shown" : "hidden"} until opencode exits: tui.json sets sidebar.session_id`
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
  // Development builds have always shown the session ID; keep that as the default.
  const showSessionID = () => sidebarShowsSessionID(tuiConfig, kv)

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
                <Show when={showSessionID()}>
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
