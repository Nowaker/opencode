import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { TextRenderable } from "@opentui/core"
import { getComponentCatalogue } from "@opentui/solid/components"
import { writeFileSync } from "node:fs"

export default {
  id: "opencode.redraw.fixture",
  async tui(api: TuiPluginApi) {
    const endpoint = process.env.OPENCODE_REDRAW_ENDPOINT
    if (!endpoint) throw new Error("OPENCODE_REDRAW_ENDPOINT is required")
    const renderer = api.renderer
    const Spinner = getComponentCatalogue().spinner
    const spinner = new Spinner(renderer, {
      id: "redraw-spinner",
      position: "absolute",
      zIndex: 1000,
      top: 2,
      left: 2,
      frames: ["a", "b", "c", "d"],
      interval: 50,
    })
    const content = new TextRenderable(renderer, {
      id: "redraw-content",
      position: "absolute",
      zIndex: 1000,
      top: 4,
      left: 2,
      content: "REDRAW_READY",
    })
    const live = new TextRenderable(renderer, {
      id: "redraw-live",
      position: "absolute",
      zIndex: 1000,
      top: 6,
      left: 2,
    })
    let focused: boolean | null = null
    let mode = "spinner"
    let tick = 0
    const focus = () => {
      focused = true
      writeFileSync(`${endpoint}.focus`, "true")
    }
    const blur = () => {
      focused = false
      writeFileSync(`${endpoint}.focus`, "false")
    }
    renderer.on("focus", focus)
    renderer.on("blur", blur)
    renderer.setFrameCallback(async () => {
      if (mode === "live") live.content = `LIVE_${++tick}`
    })
    renderer.root.add(spinner)
    renderer.root.add(content)
    renderer.root.add(live)
    if (process.env.OPENCODE_REDRAW_BASELINE_FOCUS === "1") process.stdout.write("\x1b[?1004h")
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === "/content") {
          const text = await request.text()
          const changedAt = performance.timeOrigin + performance.now()
          content.content = text
          return Response.json({ changedAt })
        }
        if (url.pathname === "/live") {
          mode = "live"
          spinner.visible = false
          renderer.start()
        }
        return Response.json({ focused, mode, maxFps: renderer.maxFps, targetFps: renderer.targetFps })
      },
    })
    writeFileSync(endpoint, String(server.port))
    api.lifecycle.onDispose(() => {
      server.stop(true)
      if (process.env.OPENCODE_REDRAW_BASELINE_FOCUS === "1") process.stdout.write("\x1b[?1004l")
      renderer.off("focus", focus)
      renderer.off("blur", blur)
      spinner.destroy()
      content.destroy()
      live.destroy()
    })
  },
}
