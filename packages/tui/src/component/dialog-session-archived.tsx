import { TextAttributes } from "@opentui/core"
import type { SessionArchive } from "@opencode-ai/schema/session-archive"
import { Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { useDialog } from "../ui/dialog"

export function DialogSessionArchived(props: {
  archive: SessionArchive.Details
  unarchived?: SessionArchive.Action
  onUnarchive: () => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const confirm = () => {
    dialog.clear()
    props.onUnarchive()
  }
  useBindings(() => ({
    bindings: [
      { key: "return", desc: "Unarchive and send", group: "Dialog", cmd: confirm },
      { key: "u", desc: "Unarchive and send", group: "Dialog", cmd: confirm },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <text attributes={TextAttributes.BOLD} fg={theme.text}>
        Session archived
      </text>
      <text fg={theme.textMuted} wrapMode="word">
        Archived {new Date(props.archive.archivedAt).toLocaleString()} by {actor(props.archive.by)}.
      </text>
      <Show when={props.archive.note}>
        {(note) => (
          <text fg={theme.text} wrapMode="word">
            {note()}
          </text>
        )}
      </Show>
      <Show when={props.unarchived}>
        {(unarchived) => (
          <>
            <text fg={theme.textMuted} wrapMode="word">
              Last unarchived {new Date(unarchived().at).toLocaleString()} by {actor(unarchived().by)}.
            </text>
            <Show when={unarchived().note}>
              {(note) => (
                <text fg={theme.text} wrapMode="word">
                  {note()}
                </text>
              )}
            </Show>
          </>
        )}
      </Show>
      <box flexDirection="row" justifyContent="flex-end" gap={2}>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          Cancel [esc]
        </text>
        <text fg={theme.primary} onMouseUp={confirm}>
          Unarchive and send [enter/u]
        </text>
      </box>
    </box>
  )
}

function actor(by: SessionArchive.Actor | undefined): string {
  if (!by) return "an unknown source"
  const where = by.machine ? ` on ${by.machine}` : ""
  switch (by.kind) {
    case "tui":
      return `you (TUI${where})`
    case "api":
      return by.client === "portal"
        ? `Portal${by.instance ? ` ${by.instance}` : ""}${where}`
        : `API${by.client ? ` ${by.client}` : ""}${where}`
    case "system":
      return `Vibeterm${by.component ? ` ${by.component}` : ""}${where}`
    case "tool":
      return `session ${by.sessionTitle ?? by.sessionID ?? "unknown"}${where}${by.tool ? ` (${by.tool})` : ""}`
  }
}
