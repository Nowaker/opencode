/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { testRender, useRenderer } from "@opentui/solid"
import { For } from "solid-js"
import { ArgsProvider } from "../../../../src/context/args"
import { ExitProvider } from "../../../../src/context/exit"
import { KVProvider } from "../../../../src/context/kv"
import { PermissionProvider } from "../../../../src/context/permission"
import { ProjectProvider } from "../../../../src/context/project"
import { SDKProvider } from "../../../../src/context/sdk"
import { SyncProvider, useSync } from "../../../../src/context/sync"
import { keepScrollAnchor } from "../../../../src/util/scroll"
import { tmpdir } from "../../../fixture/fixture"
import { TestTuiContexts } from "../../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../../fixture/tui-runtime"
import { TuiConfigProvider } from "../../../../src/config"
import { createEventSource, createFetch, directory, wait } from "./sync-fixture"

const sessionID = "ses_scroll_anchor"

function message(index: number) {
  return {
    id: `msg_${String(index).padStart(4, "0")}`,
    sessionID,
    role: "assistant" as const,
    agent: "build",
    modelID: "model",
    providerID: "test",
    mode: "build",
    parentID: "msg_user",
    path: { cwd: directory, root: directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    // Equal-width epoch-like times, as real messages have.
    time: { created: 1_700_000_000_000 + index, completed: 1_700_000_000_000 + index },
  }
}

function updated(index: number): GlobalEvent {
  return {
    directory: "/tmp/other",
    project: "proj_test",
    payload: { id: `evt_${index}`, type: "message.updated", properties: { sessionID, info: message(index) } },
  }
}

async function mount(state: string) {
  const events = createEventSource()
  const calls = createFetch()
  const mounted: { sync?: ReturnType<typeof useSync>; scroll?: ScrollBoxRenderable } = {}

  function Transcript() {
    const renderer = useRenderer()
    const context = useSync()
    mounted.sync = context
    return (
      <scrollbox
        ref={(r: ScrollBoxRenderable) => {
          mounted.scroll = r
          keepScrollAnchor(renderer, r)
        }}
        stickyScroll={true}
        stickyStart="bottom"
        flexGrow={1}
      >
        <For each={context.data.message[sessionID] ?? []}>
          {(item) => (
            // Messages differ in height, so a pruned one shifts the rows below it by an
            // amount the reader cannot predict.
            <box flexShrink={0} height={1 + (item.time.created % 3)}>
              <text>{item.id}</text>
            </box>
          )}
        </For>
      </scrollbox>
    )
  }

  const app = await testRender(
    () => (
      <TestTuiContexts paths={{ state }}>
        <ArgsProvider>
          <KVProvider>
            <SDKProvider url="http://test" directory={directory} fetch={calls.fetch} events={events.source}>
              <PermissionProvider>
                <ProjectProvider>
                  <ExitProvider exit={() => {}}>
                    <TuiConfigProvider config={createTuiResolvedConfig()}>
                      <SyncProvider>
                        <Transcript />
                      </SyncProvider>
                    </TuiConfigProvider>
                  </ExitProvider>
                </ProjectProvider>
              </PermissionProvider>
            </SDKProvider>
          </KVProvider>
        </ArgsProvider>
      </TestTuiContexts>
    ),
    { width: 30, height: 12 },
  )
  await wait(() => mounted.sync?.status === "complete")
  const sync = mounted.sync
  const scroll = mounted.scroll
  if (!sync || !scroll) throw new Error("transcript did not mount its sync context and scrollbox")

  const append = async (from: number, to: number) => {
    for (let index = from; index < to; index++) events.emit(updated(index))
    await wait(() => sync.data.message[sessionID]?.at(-1)?.id === message(to - 1).id)
    await app.renderOnce()
  }
  const firstLine = () => {
    const line = app.captureCharFrame().trim().split("\n").at(0)
    if (line === undefined) throw new Error("rendered transcript frame has no lines")
    return line.trim()
  }
  return { app, append, firstLine, scroll, sync }
}

test("a scrolled-up transcript keeps its place while new messages prune the oldest past 100", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const view = await mount(tmp.path)

  try {
    await view.append(0, 100)
    view.scroll.scrollBy(-40)
    await view.app.renderOnce()
    const before = view.firstLine()

    await view.append(100, 106)

    expect(view.sync.data.message[sessionID]).toHaveLength(100)
    expect(view.sync.data.message[sessionID]?.at(0)?.id).toBe(message(6).id)
    expect(view.firstLine()).toBe(before)
  } finally {
    view.app.renderer.destroy()
  }
})

test("a transcript at the bottom keeps following new messages past 100", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const view = await mount(tmp.path)

  try {
    await view.append(0, 100)
    await view.append(100, 106)

    expect(view.app.captureCharFrame()).toContain(message(105).id)
  } finally {
    view.app.renderer.destroy()
  }
})
