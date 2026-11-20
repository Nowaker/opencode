import { createMemo, createResource, createSignal, Show } from "solid-js"
import type { MouseEvent } from "@opentui/core"
import type { ToolPart } from "@opencode-ai/sdk/v2"
import { useProject } from "../../context/project"
import { useSDK } from "../../context/sdk"
import { useTheme } from "../../context/theme"
import { useBindings } from "../../keymap"
import { onClick } from "../../ui/click"

export type BashBackgroundTarget = {
  readonly directory: string
  readonly sessionID: string
  readonly messageID: string
  readonly callID: string
  readonly jobID: string
}

export type BashBackgroundOwner = {
  readonly available: (target: BashBackgroundTarget) => Promise<boolean>
  readonly move: (target: BashBackgroundTarget) => Promise<string | undefined>
}

export function BashBackgroundAction(props: { readonly part: ToolPart; readonly sessionID: string }) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const project = useProject()
  const [hover, setHover] = createSignal(false)
  const [moving, setMoving] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const jobID = createMemo(() => {
    if (props.part.sessionID !== props.sessionID || props.part.state.status !== "running") return
    const marker: unknown = props.part.state.metadata?.foregroundJobID
    if (typeof marker === "string") return marker
  })
  const target = createMemo(() => {
    const id = jobID()
    const directory = project.instance.directory()
    if (!sdk.bashBackground || !id || !directory) return
    return {
      directory,
      sessionID: props.part.sessionID,
      messageID: props.part.messageID,
      callID: props.part.callID,
      jobID: id,
    }
  })
  const [verified] = createResource(target, async (candidate) => {
    return (await sdk.bashBackground?.available(candidate).catch(() => false)) ? candidate : undefined
  })
  const show = () => target() && verified() === target()
  const enabled = () => Boolean(show() && !moving() && !error())
  const move = async () => {
    const candidate = target()
    if (!candidate || !enabled()) return
    setMoving(true)
    try {
      const id = await sdk.bashBackground?.move(candidate)
      if (id) return
      setError("Could not move this Bash command to the background.")
    } catch {
      setError("Could not confirm the move to background.")
    }
    setMoving(false)
  }
  const click = onClick((event: MouseEvent) => {
    event.stopPropagation()
    void move()
  })

  useBindings(() => ({
    commands: enabled()
      ? [
          {
            namespace: "palette",
            name: `bash.background.${props.part.id}`,
            title: "Send to background",
            desc: String(props.part.state.input?.command ?? "Bash"),
            category: "Session",
            run: () => {
              void move()
            },
          },
        ]
      : [],
  }))

  return (
    <Show when={show()}>
      <box flexDirection="column" alignItems="flex-end" paddingRight={1}>
        <Show
          when={error()}
          fallback={
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={hover() && enabled() ? theme.backgroundMenu : theme.backgroundElement}
              onMouseOver={() => setHover(true)}
              onMouseOut={() => setHover(false)}
              onMouseDown={(event) => {
                event.stopPropagation()
                click.onMouseDown(event)
              }}
              onMouseUp={(event) => {
                event.stopPropagation()
                click.onMouseUp(event)
              }}
            >
              <text fg={moving() ? theme.textMuted : theme.text}>
                {moving() ? "Sending to background..." : "Send to background"}
              </text>
            </box>
          }
        >
          <text fg={theme.warning}>{error()}</text>
        </Show>
      </box>
    </Show>
  )
}
