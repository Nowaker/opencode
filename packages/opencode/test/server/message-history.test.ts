import { expect, test } from "bun:test"
import type { Database } from "bun:sqlite"
import path from "node:path"
import { z } from "zod"
import { MessageID } from "../../src/session/schema"
import { model, post, snapshotFiles, withHistoryServer } from "./message-history-fixture"

const ready = z.strictObject({
  version: z.literal(1),
  status: z.literal("ready"),
  revision: z.string().min(1),
  boundaryKind: z.enum(["none", "protected"]),
  boundaryMessageID: z.string().nullable(),
  boundaryCreatedAt: z.number().nullable(),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
})
const applied = z.strictObject({
  version: z.literal(1),
  status: z.literal("applied"),
  state: ready,
  affectedUserMessageID: z.string(),
})
const persisted = z.strictObject({
  version: z.literal(1),
  sessionID: z.string(),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  generation: z.string().min(1),
  boundaryMessageID: z.string().nullable(),
  boundaryCreatedAt: z.number().nullable(),
  historyFingerprint: z.string().min(1).nullable(),
})
const clear = {
  boundaryKind: "none",
  boundaryMessageID: null,
  boundaryCreatedAt: null,
  canUndo: true,
  canRedo: false,
} as const
const oldest = { id: "msg_z-oldest", time: 100, text: "Human: first" } as const
const second = { id: "msg_Z-second", time: 200, text: "Human: second" } as const
const latest = { id: "msg_a-latest", time: 200, text: "Human: latest" } as const
const notice = { id: "msg_notice", time: 300, text: "System: queued notification" } as const
const synthetic = { id: "msg_synthetic", time: 350, text: "Human: synthetic lookalike", synthetic: true } as const

test("v1 protected history follows genuine persisted turns without changing raw history or files", async () => {
  await withHistoryServer(async (server) => {
    const armedID = server.armedID
    const filename = path.join(server.project, "keep.txt")
    await Bun.write(filename, "before file edit\n")
    seedUser(server.db, armedID, { ...oldest, id: "msg_stock" })
    const stock = ready.parse(await server.history(armedID, { operation: "read" }))
    const reverted = await server.request(`/session/${armedID}/revert`, post({ messageID: "msg_stock" }))
    expect(reverted.status).toBe(200)
    const armed = z.object({ revert: z.object({ snapshot: z.string().min(1) }) }).parse(await reverted.json())
    const stockMarker = server.db.query<{ revert: string }, [string]>(
      "SELECT revert FROM session WHERE id = ?",
    )
    const beforeStock = stockMarker.get(armedID)
    expect(beforeStock?.revert).toBeString()
    expect(await server.history(armedID, {
      operation: "mutate",
      mutation: { action: "undo", expectedRevision: stock.revision },
    })).toMatchObject({ version: 1, status: "rejected", reason: "armed-revert" })
    await Bun.write(filename, "after file edit\n")

    const sessionID = await server.createSession()
    const route = `/session/${sessionID}`
    // Insert out of order. The timestamp tie orders uppercase Z before lowercase a in SQLite BINARY.
    for (const row of [latest, notice, second, synthetic, oldest]) seedUser(server.db, sessionID, row)
    insertMessage(server.db, sessionID, {
      id: "msg_answer",
      time: 400,
      data: {
        ...model,
        role: "assistant",
        parentID: latest.id,
        agent: "build",
        mode: "build",
        finish: "stop",
        path: { cwd: server.project, root: server.project },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    })
    server.db.query("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run("prt_answer_patch", "msg_answer", sessionID, 400, 400, JSON.stringify({
        type: "patch", hash: armed.revert.snapshot, files: [filename],
      }))

    const raw = async (): Promise<unknown> => {
      const response = await server.request(`${route}/message`)
      expect(response.status).toBe(200)
      return response.json()
    }
    const stored = () => ({
      messages: server.db.query("SELECT * FROM message WHERE session_id = ? ORDER BY id").all(sessionID),
      parts: server.db.query("SELECT * FROM part WHERE session_id = ? ORDER BY id").all(sessionID),
    })
    const marker = () => server.db.query<{ revert: string | null; history: string | null }, [string]>(
      "SELECT revert, json_extract(metadata, '$.messageHistory') AS history FROM session WHERE id = ?",
    ).get(sessionID)
    const snapshots = () => snapshotFiles(server.snapshots)
    const before = { raw: await raw(), rows: stored(), snapshots: await snapshots() }
    const ids = z.array(z.object({ info: z.object({ id: z.string() }) })).parse(before.raw)
    expect(ids.map((row) => row.info.id)).toEqual([
      oldest.id, second.id, latest.id, notice.id, synthetic.id, "msg_answer",
    ])

    const read = () => server.history(sessionID, { operation: "read" })
    const move = (action: "undo" | "redo", expectedRevision: string) =>
      server.history(sessionID, { operation: "mutate", mutation: { action, expectedRevision } })
    const initial = ready.parse(await read())
    expect(initial).toMatchObject(clear)
    const undoLatest = applied.parse(await move("undo", initial.revision))
    expect(undoLatest).toMatchObject({
      affectedUserMessageID: latest.id,
      state: {
        boundaryKind: "protected",
        boundaryMessageID: latest.id,
        boundaryCreatedAt: latest.time,
        canUndo: true,
        canRedo: true,
      },
    })
    expect(await read()).toEqual(undoLatest.state)
    expect(await move("undo", initial.revision))
      .toMatchObject({ version: 1, status: "rejected", reason: "stale-revision" })
    expect(await raw()).toEqual(before.raw)
    expect(await Bun.file(filename).text()).toBe("after file edit\n")
    expect(await snapshots()).toEqual(before.snapshots)
    expect(marker()?.revert).toBeNull()
    const active = persisted.parse(JSON.parse(marker()?.history ?? "null"))
    expect(active).toMatchObject({
      sessionID, boundaryMessageID: latest.id, boundaryCreatedAt: latest.time,
      historyFingerprint: expect.any(String),
    })
    const expectMetadataPreserved = async (record: z.infer<typeof persisted>, kind: string) => {
      const forged = { ...active, generation: crypto.randomUUID(), boundaryMessageID: second.id }
      for (const [label, payload] of [["replacement", {}], ["forged key", { messageHistory: forged }]] as const) {
        const metadata = { fixtureLabel: `${kind} ${label}`, ...payload }
        const response = await server.request(route, { ...post({ metadata }), method: "PATCH" })
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ metadata: { fixtureLabel: metadata.fixtureLabel } })
        expect(persisted.parse(JSON.parse(marker()?.history ?? "null"))).toEqual(record)
      }
    }
    await expectMetadataPreserved(active, "protected")
    const protectedState = ready.parse(await read())
    expect(protectedState).toEqual({ ...undoLatest.state, revision: protectedState.revision })

    await server.whileShellHeld(async () => {
      expect(await read()).toMatchObject({
        version: 1, status: "unavailable", reason: "busy", boundaryKind: "protected",
        boundaryMessageID: latest.id, boundaryCreatedAt: latest.time,
      })
      expect(await move("redo", protectedState.revision)).toEqual({ version: 1, status: "rejected", reason: "busy" })
    })

    const fresh = {
      messageID: MessageID.ascending(), model, noReply: true,
      parts: [{ type: "text", text: "Human: admit only after redo" }],
    }
    const readSessionRow = server.db.query("SELECT * FROM session WHERE id = ?")
    const beforeRefusals = readSessionRow.get(sessionID)
    const attempts = [
      ["fresh exact-ID async prompt", "/prompt_async", post(fresh)],
      ["replay of a hidden exact ID with an answer", "/prompt_async", post({
        ...fresh, messageID: latest.id, parts: [{ type: "text", text: latest.text }],
      })],
      ["sync noReply prompt", "/message", post(fresh)],
      ["summarize", "/summarize", post(model)],
      ["native apply", "/revert/apply", { method: "POST" }],
      ["delete a hidden message", `/message/${latest.id}`, { method: "DELETE" }],
      ["shell file write", "/shell", post({ agent: "build", command: "printf blocked > protected-write.txt" })],
    ] as const
    for (const [label, suffix, init] of attempts) {
      const response = await server.request(`${route}${suffix}`, init)
      expect(response.status, label).toBe(409)
      expect(await response.json(), label).toEqual({
        name: "ProtectedMessageHistoryError",
        data: {
          code: "protected-message-history",
          message: "This session's message history is protected; clear the history boundary before writing.",
        },
      })
    }
    expect(readSessionRow.get(sessionID)).toEqual(beforeRefusals)
    expect(stored()).toEqual(before.rows)
    expect(await Bun.file(path.join(server.project, "protected-write.txt")).exists()).toBe(false)
    expect(await read()).toEqual(protectedState)

    const undoSecond = applied.parse(await move("undo", protectedState.revision))
    expect(undoSecond).toMatchObject({
      affectedUserMessageID: second.id,
      state: { boundaryKind: "protected", boundaryMessageID: second.id, boundaryCreatedAt: second.time },
    })
    const redoSecond = applied.parse(await move("redo", undoSecond.state.revision))
    expect(redoSecond).toMatchObject({
      affectedUserMessageID: second.id,
      state: { boundaryKind: "protected", boundaryMessageID: latest.id, boundaryCreatedAt: latest.time },
    })
    const redoLatest = applied.parse(await move("redo", redoSecond.state.revision))
    expect(redoLatest).toMatchObject({ affectedUserMessageID: latest.id, state: clear })
    expect(await read()).toEqual(redoLatest.state)
    expect(await move("undo", initial.revision))
      .toMatchObject({ version: 1, status: "rejected", reason: "stale-revision" })
    const tombstone = persisted.parse(JSON.parse(marker()?.history ?? "null"))
    expect(tombstone).toMatchObject({
      sessionID, boundaryMessageID: null, boundaryCreatedAt: null, historyFingerprint: null,
    })
    expect(tombstone.revision).toBeGreaterThan(active.revision)
    await expectMetadataPreserved(tombstone, "cleared")
    expect(marker()?.revert).toBeNull()
    expect(stored()).toEqual(before.rows)
    expect(await raw()).toEqual(before.raw)
    expect(await Bun.file(filename).text()).toBe("after file edit\n")
    expect(await snapshots()).toEqual(before.snapshots)
    expect(stockMarker.get(armedID)).toEqual(beforeStock)

    const beforeAdmission = ready.parse(await read())
    expect(beforeAdmission).toMatchObject(clear)
    const resumed = await server.request(`${route}/message`, post(fresh))
    expect(resumed.status, await resumed.clone().text()).toBe(200)
    expect(await resumed.json()).toMatchObject({
      info: { id: fresh.messageID, role: "user" }, parts: fresh.parts,
    })
    expect(server.db.query("SELECT id FROM message WHERE session_id = ? AND id = ?")
      .all(sessionID, fresh.messageID)).toEqual([{ id: fresh.messageID }])
    expect(await move("undo", beforeAdmission.revision)).toMatchObject({
      version: 1, status: "rejected", reason: "stale-revision",
    })
    const afterAdmission = ready.parse(await read())
    expect(afterAdmission).toMatchObject(clear)
    expect(afterAdmission.revision).not.toBe(beforeAdmission.revision)
  })
}, 90_000)

function seedUser(db: Database, sessionID: string, row: {
  readonly id: string
  readonly time: number
  readonly text: string
  readonly synthetic?: boolean
}) {
  insertMessage(db, sessionID, { ...row, data: { role: "user", agent: "build", model } })
  db.query("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
    .run(`prt_${row.id}`, row.id, sessionID, row.time, row.time, JSON.stringify({
      type: "text", text: row.text, synthetic: row.synthetic,
    }))
}

function insertMessage(db: Database, sessionID: string, row: {
  readonly id: string
  readonly time: number
  readonly data: object
}) {
  db.query("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
    .run(row.id, sessionID, row.time, row.time, JSON.stringify({ ...row.data, time: { created: row.time } }))
}
