import type { EditBufferRenderable } from "@opentui/core"

// Moves to the start or end of the caret's line and stays there on a repeated
// press, as editors do. opentui's gotoLineHome / gotoLineEnd step onto the
// previous or next line when the caret is already at the edge, so repeated
// home or end walks through the prompt.
export function gotoLineEdge(editor: EditBufferRenderable, edge: "home" | "end", select: boolean) {
  const cursor = editor.logicalCursor
  const atEdge = edge === "home" ? cursor.col === 0 : cursor.col === editor.editBuffer.getEOL().col
  if (!atEdge) return edge === "home" ? editor.gotoLineHome({ select }) : editor.gotoLineEnd({ select })
  if (!select) editor.clearSelection()
  return true
}
