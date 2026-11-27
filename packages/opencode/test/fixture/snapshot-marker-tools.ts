import path from "node:path"
import { appendFile } from "node:fs/promises"
import { tool } from "@opencode-ai/plugin"

const markerTool = (name: string) =>
  tool({
    description: `Write the ${name} marker`,
    args: {},
    async execute(_args, context) {
      await appendFile(path.join(context.directory, name), `${name}\n`)
      return `Wrote ${name}`
    },
  })

export const snapshotMarkerTools = {
  snapshot_write_alpha: markerTool("snapshot-marker-alpha"),
  snapshot_write_beta: markerTool("snapshot-marker-beta"),
}
