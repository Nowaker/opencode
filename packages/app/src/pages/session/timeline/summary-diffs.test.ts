import { describe, expect, test } from "bun:test"
import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2"
import { normalize, text } from "@opencode-ai/session-ui/session-diff"
import { QueryClient, skipToken } from "@tanstack/solid-query"
import { ServerScope } from "@/utils/server-scope"
import { turnDiffQuery, turnPatchMissing, uniqueSummaryDiffs, withTurnPatches } from "./summary-diffs"

const patch = [
  "Index: src/app.ts",
  "===================================================================",
  "--- src/app.ts\t",
  "+++ src/app.ts\t",
  "@@ -1,2 +1,2 @@",
  " keep",
  "-old",
  "+new",
  "",
].join("\n")

function turnClient(responses: Record<string, SnapshotFileDiff[]>) {
  const calls: Array<{ sessionID: string; messageID: string }> = []
  const client: Parameters<typeof turnDiffQuery>[4] = {
    session: {
      async diff(input) {
        calls.push(input)
        const data = responses[`${input.sessionID}/${input.messageID}`]
        if (!data) throw new Error("Unexpected turn diff request")
        return { data }
      },
    },
  }
  return { client, calls }
}

describe("historical turn patches", () => {
  const stripped = { file: "src/app.ts", additions: 1, deletions: 1, status: "modified" as const }
  const full = { ...stripped, patch }

  test("only file metadata whose patch body was left out needs the turn payload", () => {
    expect(turnPatchMissing(stripped)).toBe(true)
    expect(turnPatchMissing(full)).toBe(false)
    expect(turnPatchMissing({ ...stripped, patch: "Binary files differ" })).toBe(false)
    expect(turnPatchMissing({ file: "empty.ts", additions: 0, deletions: 0 })).toBe(false)
  })

  test("a hidden view holds an inert key that never requests a turn", () => {
    const { client, calls } = turnClient({})
    const hidden = turnDiffQuery(ServerScope.local, "/project", "ses_a", undefined, client)
    const shown = turnDiffQuery(ServerScope.local, "/project", "ses_a", "msg_1", client)
    expect(hidden.queryFn).toBe(skipToken)
    expect(hidden.queryKey).not.toEqual(shown.queryKey)
    expect(calls).toEqual([])
  })

  test("loads one exact turn per session and message without touching other turns", async () => {
    const { client, calls } = turnClient({ "ses_a/msg_1": [full], "ses_b/msg_1": [] })
    const queryClient = new QueryClient()

    expect(await queryClient.ensureQueryData(turnDiffQuery(ServerScope.local, "/project", "ses_a", "msg_1", client))).toEqual([
      full,
    ])
    expect(await queryClient.ensureQueryData(turnDiffQuery(ServerScope.local, "/project", "ses_a", "msg_1", client))).toEqual([
      full,
    ])
    expect(await queryClient.ensureQueryData(turnDiffQuery(ServerScope.local, "/project", "ses_b", "msg_1", client))).toEqual([])
    expect(calls).toEqual([
      { sessionID: "ses_a", messageID: "msg_1" },
      { sessionID: "ses_b", messageID: "msg_1" },
    ])
  })

  test("stripped history expands later to the real patch while keeping list paths and stats", () => {
    const metadata = uniqueSummaryDiffs([stripped])
    expect(metadata.map((item) => text(normalize(item), "additions"))).toEqual([""])

    const expanded = withTurnPatches(metadata, [full])
    expect(expanded).toEqual([full])
    expect(expanded.map((item) => text(normalize(item), "additions"))).toEqual(["keep\nnew\n"])
  })

  test("pairs quoted list paths with the server's unquoted paths by identity", () => {
    const quoted = { file: '"src/a\\040b.ts"', additions: 1, deletions: 1 }
    const result = withTurnPatches(uniqueSummaryDiffs([quoted]), [{ file: "src/a b.ts", patch, additions: 1, deletions: 1 }])
    expect(result).toEqual([{ ...quoted, patch }])
  })

  test("preserves literal quotes around a file name already decoded by the diff endpoint", () => {
    const file: SnapshotFileDiff & { file: string } = { file: '"\\"quoted.ts\\""', additions: 1, deletions: 1 }
    const result = withTurnPatches([file], [{ ...file, file: '"quoted.ts"', patch }])
    expect(result).toEqual([{ ...file, patch }])
  })

  test("keeps a leading BOM in a Git-quoted path distinct from the plain file name", () => {
    const quoted: SnapshotFileDiff & { file: string } = { ...stripped, file: '"\\357\\273\\277plain.ts"' }
    const plain = { ...stripped, file: "plain.ts" }
    const result = withTurnPatches([quoted, plain], [
      { ...plain, patch: "plain-patch" },
      { ...plain, file: "\uFEFFplain.ts", patch: "bom-patch" },
    ])
    expect(result).toEqual([{ ...quoted, patch: "bom-patch" }, { ...plain, patch: "plain-patch" }])
  })

  test("never gives a listed file another file's patch, even with equal stats in the same position", () => {
    const listed = uniqueSummaryDiffs([
      { file: '"src/x\\040y.ts"', additions: 1, deletions: 1 },
      { file: "src/b.ts", additions: 1, deletions: 1 },
    ])
    const result = withTurnPatches(listed, [
      { file: "src/other.ts", patch, additions: 1, deletions: 1 },
      { file: "src/b.ts", patch: "b-patch", additions: 1, deletions: 1 },
    ])
    expect(result).toEqual([listed[0], { ...listed[1], patch: "b-patch" }])
    expect(result[0]).toBe(listed[0])
  })

  test("ignores a turn payload that does not describe the listed files", () => {
    const metadata = uniqueSummaryDiffs([stripped])
    expect(withTurnPatches(metadata, undefined)).toBe(metadata)
    expect(withTurnPatches(metadata, [{ file: "src/other.ts", patch, additions: 5, deletions: 0 }])).toEqual([stripped])
  })
})

const diff = (file: string, additions: number) =>
  ({
    file,
    additions,
    deletions: 0,
  }) satisfies SnapshotFileDiff

describe("uniqueSummaryDiffs", () => {
  test("drops entries without files and preserves unique input", () => {
    const alpha = diff("alpha.ts", 1)
    const beta = diff("beta.ts", 1)
    const invalid = { additions: 1, deletions: 0 } satisfies SnapshotFileDiff

    expect(uniqueSummaryDiffs(undefined)).toEqual([])
    expect(uniqueSummaryDiffs([])).toEqual([])
    expect(uniqueSummaryDiffs([invalid])).toEqual([])

    const result = uniqueSummaryDiffs([alpha, invalid, beta])
    expect(result).toEqual([alpha, beta])
    expect(result[0]).toBe(alpha)
    expect(result[1]).toBe(beta)
  })

  test("keeps the last diff per file in the legacy display order", () => {
    const oldAlpha = diff("alpha.ts", 1)
    const oldBeta = diff("beta.ts", 1)
    const newAlpha = diff("alpha.ts", 2)
    const charlie = diff("charlie.ts", 1)
    const newBeta = diff("beta.ts", 2)

    const result = uniqueSummaryDiffs([oldAlpha, oldBeta, newAlpha, charlie, newBeta])

    expect(result).toEqual([newAlpha, charlie, newBeta])
    expect(result[0]).toBe(newAlpha)
    expect(result[1]).toBe(charlie)
    expect(result[2]).toBe(newBeta)
  })
})
