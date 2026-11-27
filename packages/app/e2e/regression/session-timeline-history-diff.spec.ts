import { expect, test, type Request } from "@playwright/test"
import {
  assistantMessage,
  directory,
  event,
  sessionID,
  setupTimeline,
  userMessage,
} from "../performance/timeline-stability/fixture"

const historyID = "msg_1000_history_user"
const lastID = "msg_2000_last_user"
const nextID = "msg_3000_next_user"
const historyFile = "src/history-a.ts"
const lastFile = "src/last-b.ts"
const nextFile = "src/next-c.ts"

test("expands stripped historical and last-turn diffs on demand without fetching collapsed turns", async ({ page }) => {
  const diffRequests: string[] = []
  const isTurnDiff = (request: Request) => new URL(request.url()).pathname === `/session/${sessionID}/diff`
  page.on("request", (request) => {
    if (isTurnDiff(request)) diffRequests.push(new URL(request.url()).searchParams.get("messageID") ?? "")
  })
  await page.addInitScript(() => {
    localStorage.setItem(
      "opencode.global.dat:layout",
      JSON.stringify({ review: { diffStyle: "unified", panelOpened: true } }),
    )
  })

  const fixture = await setupTimeline(page, {
    settings: { newLayoutDesigns: true },
    messages: [
      userMessage(undefined, { id: historyID, created: 1700000000000, summary: { diffs: [stripped(historyFile)] } }),
      assistantMessage([], { id: "msg_1001_history_assistant", parentID: historyID, created: 1700000001000 }),
      userMessage(undefined, { id: lastID, created: 1700000010000, summary: { diffs: [stripped(lastFile)] } }),
      assistantMessage([], { id: "msg_2001_last_assistant", parentID: lastID, created: 1700000011000 }),
    ],
  })
  await page.route(
    (url) => url.pathname === `/session/${sessionID}/diff`,
    (route) => {
      const messageID = new URL(route.request().url()).searchParams.get("messageID")
      const body = messageID === historyID ? [full(historyFile, "history")]
        : messageID === lastID ? [full(lastFile, "last")]
        : messageID === nextID ? [full(nextFile, "next")]
        : []
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(body),
      })
    },
  )

  const historyRow = page.locator('[data-timeline-row="DiffSummary"]', { hasText: "history-a.ts" })
  await expect(historyRow).toBeVisible()
  await expect(historyRow.getByText("1 Changed file", { exact: true })).toBeVisible()
  expect(diffRequests).toEqual([])

  const historyResponse = page.waitForResponse((response) => isTurnDiff(response.request()))
  await historyRow.getByRole("button", { name: /history-a\.ts/ }).click()
  expect(new URL((await historyResponse).url()).searchParams.get("messageID")).toBe(historyID)
  await expect(historyRow.getByText("export const history = 2")).toBeVisible()
  expect(diffRequests).toEqual([historyID])

  const panel = page.locator("#review-panel")
  await panel.locator("#session-side-panel-review-tab").click()
  const lastResponse = page.waitForResponse(
    (response) => isTurnDiff(response.request()) && new URL(response.url()).searchParams.get("messageID") === lastID,
  )
  await panel.getByRole("button", { name: "Git changes" }).click()
  await page.getByRole("option", { name: "Last turn changes" }).click()
  await lastResponse
  await expect(panel.getByText("export const last = 2")).toBeVisible()
  expect(diffRequests).toEqual([historyID, lastID])

  await page.route((url) => url.pathname === "/file", (route) => route.fulfill({
    json: [{ name: "normal.ts", path: "normal.ts", absolute: `${directory}/normal.ts`, type: "file", ignored: false }],
    headers: { "access-control-allow-origin": "*" },
  }))
  await page.route((url) => url.pathname === "/file/content", (route) => route.fulfill({
    json: { type: "text", content: "normal file contents" },
    headers: { "access-control-allow-origin": "*" },
  }))
  await panel.getByRole("button", { name: "Open file" }).click()
  await expect(panel.getByRole("tab", { name: "Open file" })).toHaveAttribute("data-selected", "")
  await expect(panel.getByRole("button", { name: "normal.ts" })).toBeVisible()
  const nextTurn = userMessage(undefined, {
    id: nextID, created: 1700000020000, summary: { diffs: [stripped(nextFile)] },
  })
  await fixture.send(event("message.updated", { sessionID, info: nextTurn.info }))
  await expect(page.locator('[data-timeline-row="DiffSummary"]', { hasText: "next-c.ts" })).toBeVisible()
  expect(diffRequests).toEqual([historyID, lastID])

  await panel.getByRole("button", { name: "normal.ts" }).click()
  await expect(panel.getByRole("tab", { name: "normal.ts" })).toHaveAttribute("data-selected", "")
  await expect(panel.getByText("normal file contents")).toBeVisible()
  expect(diffRequests).toEqual([historyID, lastID])

  const nextResponse = page.waitForResponse(
    (response) => isTurnDiff(response.request()) && new URL(response.url()).searchParams.get("messageID") === nextID,
  )
  await panel.locator("#session-side-panel-review-tab").click()
  await nextResponse
  await expect(panel.getByText("export const next = 2")).toBeVisible()
  expect(diffRequests).toEqual([historyID, lastID, nextID])
})

function stripped(file: string) {
  return { file, additions: 1, deletions: 1, status: "modified" as const }
}

function full(file: string, name: string) {
  return {
    ...stripped(file),
    patch: `Index: ${file}\n===================================================================\n--- ${file}\t\n+++ ${file}\t\n@@ -1,2 +1,2 @@\n // ${name}\n-export const ${name} = 1\n+export const ${name} = 2\n`,
  }
}
