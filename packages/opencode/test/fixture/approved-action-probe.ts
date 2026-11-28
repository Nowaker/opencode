import type { ApprovedActionReceipt, PluginModule } from "@opencode-ai/plugin"
import { once } from "node:events"
import { watch } from "node:fs"
import { appendFile } from "node:fs/promises"
import path from "node:path"
import { Identifier } from "../../src/id/id"

export const actionID = "qac_TuiFixture01"
export const idlePreview = "[fixture] *literal* progress"
export const activePreview = "[fixture] *still running*"
export const receiptOutput = "[fixture] literal result"
export const exitCode = 7

export default {
  id: "fixture.approved-action-probe",
  async server(input) {
    const probe = process.env.APPROVED_ACTION_TEST_PROBE
    if (!probe) throw new Error("Missing approved-action probe path")
    const publish = (stage: string, text: string) => Bun.write(`${probe}.${stage}`, `${text}\n`)
    const action = input.approvedAction
    await publish("plugin", action ? `version:${action.version}` : "absent")
    if (!action) return {}

    let started = false
    return {
      async event({ event }) {
        if (started || event.type !== "session.idle") return
        started = true
        const { sessionID } = event.properties
        const messageID = Identifier.ascending("message")
        const binding = { sessionID, actionID, messageID }
        try {
          const capability = await action.capability({ sessionID })
          if (capability.kind === "refused") {
            await publish("error", `capability: ${capability.reason}`)
            return
          }
          const prepared = await action.prepare({ ...binding, owner: capability.owner })
          if (prepared.kind === "refused") {
            await publish("error", `prepare: ${prepared.reason}`)
            return
          }
          const admission = await action.admit({
            ...binding,
            owner: capability.owner,
            preparationID: prepared.preparationID,
          }, {
            async run(context) {
              const signal = AbortSignal.any([context.signal, AbortSignal.timeout(120_000)])
              const waitAt = async (name: "active" | "finish", ready: () => void | Promise<void>) => {
                const gate = watch(path.join(input.directory, "gate", name), { signal })
                try {
                  await Promise.all([once(gate, "change", { signal }), Promise.resolve().then(ready)])
                } finally {
                  gate.close()
                }
              }
              try {
                await waitAt("active", async () => {
                  context.stream({ sequence: 1, text: `\x1b[31m${idlePreview}\x1b[0m\x00` })
                  await appendFile(`${probe}.running`, `${messageID}\n`)
                })
                await waitAt("finish", () => {
                  context.stream({ sequence: 2, text: `\n\x1b[32m${activePreview}\x1b[0m\x00` })
                })
                return {
                  ...binding,
                  outcome: { kind: "exited", exitCode, output: `\x1b[31m${receiptOutput}\x1b[0m\x00` },
                } satisfies ApprovedActionReceipt
              } catch (error) {
                await publish("error", `run: ${String(error)}`)
                throw error
              }
            },
          })
          if (admission.kind === "refused") {
            await publish("error", `admit: ${admission.reason}`)
            return
          }
          await publish("admitted", sessionID)
        } catch (error) {
          await publish("error", String(error))
          throw error
        }
      },
    }
  },
} satisfies PluginModule
