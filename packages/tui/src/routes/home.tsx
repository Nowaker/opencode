import { Prompt, type PromptRef } from "../component/prompt"
import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js"
import { Logo } from "../component/logo"
import { logo } from "../logo"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useRouteData } from "../context/route"
import { usePromptRef } from "../context/prompt"
import { useLocal } from "../context/local"
import { usePluginRuntime } from "../plugin/runtime"
import { useEditorContext } from "../context/editor"
import { useTerminalDimensions } from "@opentui/solid"
import { useTuiConfig } from "../config"
import { HomeSessionDestinationProvider } from "./home/session-destination"
import { useUpdateNotification } from "../context/update-notification"
import { useTheme } from "../context/theme"
import { useExit } from "../context/exit"
import { TuiLayout } from "../layout"

let once = false

export function Home() {
  const pluginRuntime = usePluginRuntime()
  const sync = useSync()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const [ref, setRef] = createSignal<PromptRef | undefined>()
  const args = useArgs()
  const local = useLocal()
  const editor = useEditorContext()
  const dimensions = useTerminalDimensions()
  const tuiConfig = useTuiConfig()
  const update = useUpdateNotification()
  const [logoWidth, setLogoWidth] = createSignal(0)
  const [logoHeight, setLogoHeight] = createSignal(0)
  const [noticeHeight, setNoticeHeight] = createSignal(0)
  const [columnHeight, setColumnHeight] = createSignal<number>()
  const notice = () => (update.notification() ? noticeHeight() : 0)
  const promptMaxWidth = createMemo(() => TuiLayout.homePromptMaxWidth(tuiConfig.prompt?.max_width, dimensions().width))
  const showLogo = createMemo(() => {
    if (tuiConfig.home?.logo === false) return false
    const height = columnHeight()
    if (height === undefined) return true
    // The logo's measured height is kept while it is hidden, so it comes back once it fits.
    return TuiLayout.homeLogoFits({ height, logo: logoHeight() || logo.left.length, notice: notice() })
  })
  const position = () => tuiConfig.home?.prompt_position ?? "middle"
  const [promptHeight, setPromptHeight] = createSignal(0)
  const [bottomHeight, setBottomHeight] = createSignal(0)
  const stack = createMemo(() =>
    TuiLayout.homeStack({
      height: columnHeight() ?? dimensions().height,
      logo: showLogo() ? logoHeight() : 0,
      prompt: notice() + promptHeight(),
      bottom: bottomHeight(),
      position: position(),
    }),
  )
  const promptSpace = createMemo(() => {
    const height = columnHeight()
    if (height === undefined) return
    return TuiLayout.homePromptSpace({
      height,
      logo: showLogo() ? logoHeight() : 0,
      notice: notice(),
    })
  })
  let sent = false

  onMount(() => {
    editor.clearSelection()
  })

  const bind = (r: PromptRef | undefined) => {
    setRef(r)
    promptRef.set(r)
    if (once || !r) return
    if (route.prompt) {
      r.set(route.prompt)
      once = true
      return
    }
    if (!args.prompt) return
    r.set({ input: args.prompt, parts: [] })
    once = true
  }

  // Wait for sync and model store to be ready before auto-submitting --prompt
  createEffect(() => {
    const r = ref()
    if (sent) return
    if (!r) return
    if (!sync.ready || !local.model.ready) return
    if (!args.prompt) return
    if (r.current.input !== args.prompt) return
    sent = true
    r.submit()
  })

  return (
    <HomeSessionDestinationProvider>
      <box
        flexGrow={1}
        alignItems="center"
        paddingLeft={TuiLayout.Home.paddingX}
        paddingRight={TuiLayout.Home.paddingX}
        onSizeChange={function () {
          setColumnHeight(this.height)
        }}
      >
        <box height={0} flexGrow={position() === "top" ? 0 : 1} />
        <Show when={showLogo()}>
          <box height={stack().gapAbove} flexShrink={0} />
          <box
            flexShrink={0}
            onSizeChange={function () {
              setLogoWidth(this.width)
              setLogoHeight(this.height)
            }}
          >
            <pluginRuntime.Slot name="home_logo" mode="replace">
              <Logo />
            </pluginRuntime.Slot>
          </box>
          <box height={stack().gapBelow} flexShrink={0} />
        </Show>
        <UpdateNotification width={showLogo() ? logoWidth() : undefined} onHeight={setNoticeHeight} />
        <box
          width="100%"
          maxWidth={promptMaxWidth()}
          zIndex={1000}
          paddingTop={TuiLayout.Home.promptPaddingTop}
          flexShrink={0}
          onSizeChange={function () {
            setPromptHeight(this.height)
          }}
        >
          <pluginRuntime.Slot name="home_prompt" mode="replace" ref={bind}>
            <Prompt
              ref={bind}
              space={promptSpace()}
              right={<pluginRuntime.Slot name="home_prompt_right" />}
              placeholders={TuiLayout.HomePlaceholders}
            />
          </pluginRuntime.Slot>
        </box>
        {/* The tips keep their own height in an absolute box, which is how the stack learns it. */}
        <box width="100%" height={stack().bottom} flexShrink={0} overflow="hidden">
          <box
            position="absolute"
            top={0}
            left={0}
            width="100%"
            alignItems="center"
            onSizeChange={function () {
              // An empty box is still a row tall.
              setBottomHeight(this.getChildren().length ? this.height : 0)
            }}
          >
            <pluginRuntime.Slot name="home_bottom" />
          </box>
        </box>
        <box height={0} flexGrow={position() === "bottom" ? 0 : 1} />
        <Toast />
      </box>
      <box width="100%" flexShrink={0}>
        <pluginRuntime.Slot name="home_footer" mode="single_winner" />
      </box>
    </HomeSessionDestinationProvider>
  )
}

function UpdateNotification(props: { width?: number; onHeight: (rows: number) => void }) {
  const update = useUpdateNotification()
  const exit = useExit()
  const { theme } = useTheme()
  const [hovered, setHovered] = createSignal(false)
  createEffect(() => {
    update.notification()
    setHovered(false)
  })

  return (
    <Show when={update.notification()} keyed>
      {(state) => (
        <box
          flexShrink={0}
          flexDirection="row"
          justifyContent="center"
          width={props.width}
          maxWidth="100%"
          onSizeChange={function () {
            props.onHeight(this.height)
          }}
          gap={1}
          backgroundColor={hovered() ? theme.backgroundElement : undefined}
          onMouseOver={() => setHovered(true)}
          onMouseOut={() => setHovered(false)}
          onMouseUp={() => {
            if (state.type === "installed") return exit()
            update.open?.()
          }}
        >
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.primary }}>{state.type === "installed" ? "/exit" : "/update"}</span>
            {state.type === "available"
              ? ` to install v${state.version}`
              : state.type === "major"
                ? " to upgrade to OpenCode 2.0"
                : state.target.type === "major"
                  ? " restart to use OpenCode 2.0"
                  : ` restart to use v${state.target.version}`}
          </text>
        </box>
      )}
    </Show>
  )
}
