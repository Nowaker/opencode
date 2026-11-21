export type Wire = "anthropic" | "openai" | "availability"
export type ToolReply = { readonly name: string; readonly input: unknown; readonly id?: string }
export type Reply = string | boolean | {
  readonly text?: string
  readonly reasoning?: string | { readonly text: string; readonly signature?: string; readonly encryptedContent?: string }
  readonly tool?: ToolReply
  readonly refusal?: boolean | "quota_exhausted" | "reserve_held"
  readonly omitResponseMarker?: boolean
  readonly available?: boolean
  readonly routableAllotment?: number
  readonly observedAt?: number
}
export type Captured = {
  readonly wire: Wire
  readonly method: string
  readonly path: string
  readonly query: Readonly<Record<string, string>>
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
  readonly body: Record<string, unknown>
}

type StreamReply = Exclude<Reply, boolean | string>
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i

function normalize(reply: Reply): StreamReply {
  if (typeof reply === "string") return { text: reply }
  if (typeof reply === "boolean") return { available: reply }
  return reply
}

function anthropic(reply: StreamReply, id: number) {
  const events: Record<string, unknown>[] = [
    { type: "message_start", message: { id: `msg_${id}`, type: "message", role: "assistant", model: "claude-fixture", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } },
  ]
  let index = 0
  if (reply.reasoning) {
    const reasoning = typeof reply.reasoning === "string" ? { text: reply.reasoning } : reply.reasoning
    events.push(
      { type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: reasoning.text } },
      { type: "content_block_delta", index, delta: { type: "signature_delta", signature: reasoning.signature ?? `fixture-signature-${id}` } },
      { type: "content_block_stop", index },
    )
    index++
  }
  if (reply.tool) {
    events.push(
      { type: "content_block_start", index, content_block: { type: "tool_use", id: reply.tool.id ?? `toolu_${id}`, name: reply.tool.name, input: {} } },
      { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(reply.tool.input) } },
      { type: "content_block_stop", index },
    )
    index++
  }
  if (reply.text !== undefined) {
    events.push(
      { type: "content_block_start", index, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index, delta: { type: "text_delta", text: reply.text } },
      { type: "content_block_stop", index },
    )
  }
  events.push(
    { type: "message_delta", delta: { stop_reason: reply.tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } },
    { type: "message_stop" },
  )
  return events
}

function openai(reply: StreamReply, id: number) {
  const events: Record<string, unknown>[] = [
    { type: "response.created", response: { id: `resp_${id}`, created_at: id, model: "gpt-fixture", status: "in_progress" } },
  ]
  let index = 0
  if (reply.reasoning) {
    const reasoning = typeof reply.reasoning === "string" ? { text: reply.reasoning } : reply.reasoning
    const itemID = `rs_${id}`
    const encryptedContent = reasoning.encryptedContent ?? `fixture-encrypted-${id}`
    events.push(
      { type: "response.output_item.added", output_index: index, item: { type: "reasoning", id: itemID, encrypted_content: encryptedContent } },
      { type: "response.reasoning_summary_part.added", item_id: itemID, summary_index: 0 },
      { type: "response.reasoning_summary_text.delta", item_id: itemID, summary_index: 0, delta: reasoning.text },
      { type: "response.reasoning_summary_part.done", item_id: itemID, summary_index: 0 },
      { type: "response.output_item.done", output_index: index, item: { type: "reasoning", id: itemID, encrypted_content: encryptedContent, summary: [{ type: "summary_text", text: reasoning.text }] } },
    )
    index++
  }
  if (reply.tool) {
    const itemID = `fc_${id}`
    const callID = reply.tool.id ?? `call_${id}`
    const args = JSON.stringify(reply.tool.input)
    events.push(
      { type: "response.output_item.added", output_index: index, item: { type: "function_call", id: itemID, call_id: callID, name: reply.tool.name, arguments: "" } },
      { type: "response.function_call_arguments.delta", item_id: itemID, output_index: index, delta: args },
      { type: "response.output_item.done", output_index: index, item: { type: "function_call", id: itemID, call_id: callID, name: reply.tool.name, arguments: args, status: "completed" } },
    )
    index++
  }
  if (reply.text !== undefined) {
    const itemID = `msg_${id}`
    events.push(
      { type: "response.output_item.added", output_index: index, item: { type: "message", id: itemID, phase: "final_answer" } },
      { type: "response.output_text.delta", item_id: itemID, delta: reply.text },
      { type: "response.output_item.done", output_index: index, item: { type: "message", id: itemID, phase: "final_answer", content: [{ type: "output_text", text: reply.text, annotations: [] }] } },
    )
  }
  events.push({ type: "response.completed", response: { usage: { input_tokens: 3, output_tokens: 2, output_tokens_details: { reasoning_tokens: 0 } } } })
  return events
}

function eventStream(events: ReadonlyArray<Record<string, unknown>>) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" },
  })
}

async function requestBody(request: Request) {
  const value: unknown = await request.json()
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new Error("Expected JSON object request body")
  return value as Record<string, unknown>
}

export function createProviderFixture() {
  const captured: Captured[] = []
  const unexpected: string[] = []
  const queues: Record<Wire, Reply[]> = { anthropic: [], openai: [], availability: [] }
  let id = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const path = url.pathname
      const query = Object.fromEntries(url.searchParams)
      if (request.method === "GET" && path === "/v1/models") return Response.json({ data: [{ id: "gpt-6.2-sol" }] })
      if (request.method === "GET" && path === "/profiles/route-availability") {
        const capturedRequest: Captured = { wire: "availability", method: request.method, path, query, headers: Object.fromEntries(request.headers), body: {} }
        captured.push(capturedRequest)
        const queued = queues.availability.shift()
        const scripted = queued === undefined ? undefined : normalize(queued)
        return Response.json({
          version: 1,
          provider: query.provider ?? "chatgpt",
          model: query.model ?? "gpt-fixture",
          variant: query.variant ?? "high",
          available: scripted?.available ?? true,
          observed_at: scripted?.observedAt ?? Date.now(),
          routable_allotment: scripted?.routableAllotment ?? (scripted?.available === false ? 0 : 1),
        })
      }
      const wire: Wire | undefined = request.method === "POST" && path === "/v1/messages"
        ? "anthropic"
        : request.method === "POST" && path === "/v1/responses"
          ? "openai"
          : undefined
      if (!wire) {
        unexpected.push(`${request.method} ${url.pathname}${url.search}`)
        return Response.json({ error: "Unexpected fixture request" }, { status: 404 })
      }
      try {
        const body = await requestBody(request)
        captured.push({ wire, method: request.method, path, query, headers: Object.fromEntries(request.headers), body })
        const queued = queues[wire].shift()
        if (queued === undefined) return Response.json({ error: `No ${wire} fixture reply queued` }, { status: 409 })
        const reply = normalize(queued)
        id++
        if (reply.refusal) {
          const requestID = request.headers.get("x-request-id")
          if (!requestID || !uuid.test(requestID)) return Response.json({ error: "Refusal requires the exact request UUID" }, { status: 409 })
          const reason = reply.refusal === true ? "quota_exhausted" : reply.refusal
          if (wire === "anthropic") {
            return Response.json({
              type: "error",
              error: {
                type: "rate_limit_error",
                code: "no_routable_account",
                request_id: requestID,
                route_refusal: { version: 1, phase: "before_inference", sent: false, provider: "claude", model: body.model, reason },
              },
            }, { status: 429 })
          }
          const effort = (body.reasoning as { effort?: unknown } | undefined)?.effort
          if (request.headers.get("x-meridian-route-refusal") !== "1" || typeof effort !== "string") {
            return Response.json({ error: "GPT refusal requires its request fence and reasoning effort" }, { status: 409 })
          }
          return Response.json({
            error: {
              type: "rate_limit_error",
              code: "no_routable_account",
              request_id: requestID,
              route_refusal: { version: 1, phase: "before_inference", sent: false, provider: "chatgpt", model: body.model, variant: effort, reason },
            },
          }, { status: 429, headers: reply.omitResponseMarker ? {} : { "x-meridian-route-refusal": "1" } })
        }
        return eventStream(wire === "anthropic" ? anthropic(reply, id) : openai(reply, id))
      } catch (error) {
        return Response.json({ error: String(error) }, { status: 400 })
      }
    },
  })
  return {
    url: server.url,
    captured,
    unexpected,
    enqueue(wire: Wire, ...replies: Reply[]) { queues[wire].push(...replies) },
    async close() { await server.stop(true) },
  }
}
