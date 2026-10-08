import { useProject } from "../../context/project"
import { useSync } from "../../context/sync"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../config"
import { useKV } from "../../context/kv"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"
import { usePluginRuntime } from "../../plugin/runtime"

import { getScrollAcceleration } from "../../util/scroll"
import { WorkspaceLabel } from "../../component/workspace-label"
import { TuiLayout } from "../../layout"
import { useOpencodeKeymap } from "../../keymap"
import { onClick } from "../../ui/click"
import { markOwnIds } from "../../ui/id-click"

export function Sidebar(props: { sessionID: string; overlay?: boolean }) {
  const pluginRuntime = usePluginRuntime()
  const project = useProject()
  const sync = useSync()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const kv = useKV()
  const keymap = useOpencodeKeymap()
  const session = createMemo(() => sync.session.get(props.sessionID))
  const workspace = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return
    return project.workspace.get(workspaceID)
  }
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const pinned = () => kv.get("sidebar_pin_title", tuiConfig.sidebar?.pin_title ?? false)
  const showSessionID = () =>
    TuiLayout.sidebarShowsSessionId({
      kv: kv.get("sidebar_session_id"),
      configured: tuiConfig.sidebar?.session_id,
      channel: InstallationChannel,
    })
  const title = () => (
    <pluginRuntime.Slot
      name="sidebar_title"
      mode="single_winner"
      session_id={props.sessionID}
      title={session()!.title}
      share_url={session()!.share?.url}
    >
      <box paddingRight={TuiLayout.Sidebar.titlePaddingRight}>
        <text fg={theme.text} {...onClick(() => keymap.dispatchCommand("session.rename"))}>
          <b>{session()!.title}</b>
        </text>
        <Show when={showSessionID()}>
          <text ref={markOwnIds} fg={theme.textMuted}>
            {props.sessionID}
          </text>
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
        width={TuiLayout.Sidebar.width}
        height="100%"
        paddingTop={TuiLayout.Sidebar.paddingY}
        paddingBottom={TuiLayout.Sidebar.paddingY}
        paddingLeft={TuiLayout.Sidebar.paddingX}
        paddingRight={TuiLayout.Sidebar.paddingX}
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
          <box flexShrink={0} gap={TuiLayout.Sidebar.gap} paddingRight={TuiLayout.Sidebar.contentPaddingRight}>
            <Show when={!pinned()}>{title()}</Show>
            <pluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={TuiLayout.Sidebar.gap} paddingTop={TuiLayout.Sidebar.footerPaddingTop}>
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
