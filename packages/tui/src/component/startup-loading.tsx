import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { Spinner } from "./spinner"
import { TuiLayout } from "../layout"

export function StartupLoading(props: { ready: () => boolean }) {
  const theme = useTheme().theme
  const [show, setShow] = createSignal(false)
  const text = createMemo(() => (props.ready() ? "Finishing startup…" : "Loading plugins…"))
  let wait: NodeJS.Timeout | undefined
  let hold: NodeJS.Timeout | undefined
  let stamp = 0

  createEffect(() => {
    if (props.ready()) {
      if (wait) {
        clearTimeout(wait)
        wait = undefined
      }
      if (!show()) return
      if (hold) return

      const left = 3000 - (Date.now() - stamp)
      if (left <= 0) {
        setShow(false)
        return
      }

      hold = setTimeout(() => {
        hold = undefined
        setShow(false)
      }, left).unref()
      return
    }

    if (hold) {
      clearTimeout(hold)
      hold = undefined
    }
    if (show()) return
    if (wait) return

    wait = setTimeout(() => {
      wait = undefined
      stamp = Date.now()
      setShow(true)
    }, 500).unref()
  })

  onCleanup(() => {
    if (wait) clearTimeout(wait)
    if (hold) clearTimeout(hold)
  })

  return (
    <Show when={show()}>
      <box
        position="absolute"
        zIndex={5000}
        left={0}
        right={0}
        bottom={TuiLayout.StartupLoading.bottom}
        justifyContent="center"
        alignItems="center"
      >
        <box
          backgroundColor={theme.backgroundPanel}
          paddingLeft={TuiLayout.StartupLoading.paddingX}
          paddingRight={TuiLayout.StartupLoading.paddingX}
        >
          <Spinner color={theme.textMuted}>{text()}</Spinner>
        </box>
      </box>
    </Show>
  )
}
