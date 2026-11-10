import type { TuiDirectoryClickEvent } from "@opencode-ai/plugin/tui"
import { createContext, useContext } from "solid-js"
import { createClickHandlers } from "./id-click"

// Plugins that act on a clicked directory (`api.click.onDirectory`). A
// directory no plugin takes is copied, as every drawn directory is.
export function createDirectoryClick() {
  return createClickHandlers<TuiDirectoryClickEvent>()
}

export type DirectoryClick = ReturnType<typeof createDirectoryClick>

export const DirectoryClickContext = createContext<DirectoryClick>()

export function useDirectoryClick() {
  return useContext(DirectoryClickContext)
}
