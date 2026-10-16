import { expect, test } from "bun:test"
import { McpPendingAuth } from "../../src/mcp/pending-auth"

test("disposing one directory preserves another directory's pending authentication", async () => {
  const closed: string[] = []
  const first = {
    directory: "/first",
    transport: {
      close: async () => {
        closed.push("first")
      },
    },
  }
  const other = {
    directory: "/other",
    transport: {
      close: async () => {
        closed.push("other")
      },
    },
  }
  const pending = new Map([
    ["first", first],
    ["other", other],
  ])
  await McpPendingAuth.releaseDirectory(pending, "/first")
  expect([...pending.entries()]).toEqual([["other", other]])
  expect(closed).toEqual(["first"])
})

test("a failing pending transport does not skip other cleanup or erase another directory", async () => {
  const closed: string[] = []
  const pending = new Map([
    [
      "failure",
      {
        directory: "/first",
        transport: {
          close: async () => {
            throw new Error("fixture close failed")
          },
        },
      },
    ],
    [
      "success",
      {
        directory: "/first",
        transport: {
          close: async () => {
            closed.push("success")
          },
        },
      },
    ],
    [
      "other",
      {
        directory: "/other",
        transport: {
          close: async () => {
            closed.push("other")
          },
        },
      },
    ],
  ])
  await McpPendingAuth.releaseDirectory(pending, "/first")
  expect([...pending.keys()]).toEqual(["other"])
  expect(closed).toEqual(["success"])
})

test("cleanup preserves an authentication record replaced while its old transport closes", async () => {
  const closed: string[] = []
  const replacement = {
    directory: "/other",
    transport: {
      close: async () => {
        closed.push("other")
      },
    },
  }
  const pending = new Map<string, McpPendingAuth.PendingTransport>()
  pending.set("first", {
    directory: "/first",
    transport: {
      close: async () => {
        closed.push("first")
        pending.set("replaced", replacement)
      },
    },
  })
  pending.set("replaced", {
    directory: "/first",
    transport: {
      close: async () => {
        closed.push("old")
      },
    },
  })
  await McpPendingAuth.releaseDirectory(pending, "/first")
  expect(pending.get("replaced")).toBe(replacement)
  expect(closed).toEqual(["first", "old"])
})
