import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import { isRecord } from "../../src/util/record"

// Observe the chosen session and try a normal quota write through the real
// TUI SDK. The plugin never gets or calls the worker's ownership capability.
export default {
  id: "fixture.native-owner-probe",
  async tui(api) {
    const seen = new Set<string>()
    const attachSelection = process.env.NATIVE_OWNER_TEST_ATTACH_SELECTION
    let wasHome = false
    const probe = () => {
      const composer = api.prompt.snapshot()
      if (!composer.ready) return
      const route = api.route.current
      if (route.name === "home") {
        if (!composer.focused) return
        if (attachSelection) {
          api.route.navigate("session", { sessionID: attachSelection })
          return
        }
        if (!wasHome) process.stdout.write("\nNATIVE_OWNER_HOME_READY\n")
        wasHome = true
        return
      }

      wasHome = false
      if (route.name !== "session" || !("params" in route)) return
      const sessionID = route.params?.sessionID
      if (typeof sessionID !== "string" || seen.has(sessionID)) return
      const selected = api.state.session.get(sessionID)
      if (!selected) return
      const vibeterm = selected.metadata?.vibeterm
      const lineage = isRecord(vibeterm) ? vibeterm.lineage : undefined
      const source = isRecord(lineage) ? lineage.originalObjectId : undefined
      const forkedFrom = typeof source === "string" ? source : "-"
      seen.add(sessionID)
      void api.client.session.cybersecPreservation
        .update({ sessionID, preference: "on" })
        .then((result) => {
          const { status } = result.response
          const preference = result.data?.preference ?? "none"
          process.stdout.write(`\nNATIVE_OWNER_RESULT ${sessionID} ${status} ${preference} ${forkedFrom}\n`)
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          process.stdout.write(`\nNATIVE_OWNER_PROBE_ERROR ${message}\n`)
        })
    }
    api.renderer.on("frame", probe)
    api.lifecycle.onDispose(() => {
      api.renderer.off("frame", probe)
    })
    probe()
  },
} satisfies TuiPluginModule
