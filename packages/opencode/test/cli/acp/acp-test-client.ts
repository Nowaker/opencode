import { expect } from "bun:test"
import type { SessionConfigOption, SessionConfigSelectOption } from "@agentclientprotocol/sdk"
import { Duration, Effect } from "effect"
import type { AcpHandle } from "../../lib/cli-process"

type JsonRpcRequest = {
  readonly jsonrpc: "2.0"
  readonly id: number
  readonly method: string
  readonly params?: unknown
}

type JsonRpcResponse<T = unknown> = {
  readonly jsonrpc: "2.0"
  readonly id: number
  readonly result?: T
  readonly error?: unknown
}

type JsonRpcNotification<T = unknown> = {
  readonly jsonrpc: "2.0"
  readonly method: string
  readonly params?: T
}

type JsonRpcIncomingRequest = {
  readonly jsonrpc: "2.0"
  readonly id: number | string
  readonly method: string
  readonly params?: unknown
}

/**
 * Answers a request the AGENT sends to us, such as `elicitation/create`. These
 * arrive while a `session/prompt` response is still outstanding, so they must be
 * answered from inside the same receive loop or the prompt deadlocks.
 */
export type AcpRequestHandlers = Record<string, (params: unknown) => unknown>

export type AcpClient = {
  readonly request: <T>(method: string, params?: unknown) => Effect.Effect<JsonRpcResponse<T>, unknown>
  readonly receive: Effect.Effect<unknown>
  readonly waitForNotification: <T>(
    method: string,
    predicate: (params: T) => boolean,
    timeoutMs?: number,
  ) => Effect.Effect<JsonRpcNotification<T>, unknown>
  /** Every agent-initiated request this client answered, in arrival order. */
  readonly handled: () => ReadonlyArray<JsonRpcIncomingRequest>
}

export function createAcpClient(acp: AcpHandle, handlers: AcpRequestHandlers = {}): AcpClient {
  const state = { nextId: 1 }
  const handled: JsonRpcIncomingRequest[] = []

  const answer = (received: JsonRpcIncomingRequest) =>
    Effect.gen(function* () {
      const handler = handlers[received.method]
      if (!handler) {
        yield* acp.send({
          jsonrpc: "2.0",
          id: received.id,
          error: { code: -32601, message: `no test handler for ${received.method}` },
        })
        return
      }
      handled.push(received)
      yield* acp.send({ jsonrpc: "2.0", id: received.id, result: handler(received.params) })
    })

  const request = <T>(method: string, params?: unknown) =>
    Effect.gen(function* () {
      const id = state.nextId++
      const message: JsonRpcRequest =
        params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params }
      yield* acp.send(message)

      while (true) {
        const received = yield* acp.receive.pipe(Effect.timeout(Duration.seconds(15)))
        if (isJsonRpcIncomingRequest(received)) {
          yield* answer(received)
          continue
        }
        if (isJsonRpcResponse<T>(received) && received.id === id) return received
      }
    })

  const waitForNotification = <T>(method: string, predicate: (params: T) => boolean, timeoutMs = 15_000) =>
    Effect.gen(function* () {
      while (true) {
        const received = yield* acp.receive.pipe(Effect.timeout(Duration.millis(timeoutMs)))
        if (isJsonRpcIncomingRequest(received)) {
          yield* answer(received)
          continue
        }
        if (!isJsonRpcNotification<T>(received)) continue
        if (received.method === method && predicate(received.params as T)) return received
      }
    })

  return {
    request,
    receive: acp.receive,
    waitForNotification,
    handled: () => handled,
  }
}

export function expectOk<T>(response: JsonRpcResponse<T>) {
  expect(response.error).toBeUndefined()
  expect(response.result).toBeDefined()
  return response.result as T
}

export function selectConfigOption(options: SessionConfigOption[] | null | undefined, id: string) {
  return options?.find(
    (option): option is Extract<SessionConfigOption, { type: "select" }> =>
      option.id === id && option.type === "select",
  )
}

export function firstAlternateValue(option: Extract<SessionConfigOption, { type: "select" }>) {
  return flattenSelectOptions(option).find((item) => item.value !== option.currentValue)?.value
}

export function flattenSelectOptions(option: Extract<SessionConfigOption, { type: "select" }>) {
  return option.options.flatMap((item): SessionConfigSelectOption[] => ("value" in item ? [item] : item.options))
}

function isJsonRpcResponse<T>(input: unknown): input is JsonRpcResponse<T> {
  if (!input || typeof input !== "object") return false
  // An agent-initiated request also carries `id`, and its id counter is the
  // agent's own, so it can collide with ours. `method` is what tells them apart.
  return "id" in input && "jsonrpc" in input && !("method" in input)
}

function isJsonRpcIncomingRequest(input: unknown): input is JsonRpcIncomingRequest {
  if (!input || typeof input !== "object") return false
  return "id" in input && "method" in input && "jsonrpc" in input
}

function isJsonRpcNotification<T>(input: unknown): input is JsonRpcNotification<T> {
  if (!input || typeof input !== "object") return false
  return "method" in input && !("id" in input) && "jsonrpc" in input
}
