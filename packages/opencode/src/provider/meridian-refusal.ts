import { APICallError } from "ai"
import { Option, Schema } from "effect"

const fields = {
  version: Schema.Literal(1),
  phase: Schema.Literal("before_inference"),
  sent: Schema.Literal(false),
  model: Schema.String,
  reason: Schema.Literals(["quota_exhausted", "reserve_held"]),
}
const errorFields = {
  type: Schema.Literal("rate_limit_error"),
  code: Schema.Literal("no_routable_account"),
  request_id: Schema.String,
  message: Schema.optionalKey(Schema.Unknown),
}
const claude = Schema.fromJsonString(
  Schema.Struct({
    type: Schema.Literal("error"),
    error: Schema.Struct({ ...errorFields, route_refusal: Schema.Struct({ ...fields, provider: Schema.Literal("claude") }) }),
  }),
)
const chatgpt = Schema.fromJsonString(
  Schema.Struct({
    error: Schema.Struct({
      ...errorFields,
      route_refusal: Schema.Struct({ ...fields, provider: Schema.Literal("chatgpt"), variant: Schema.String }),
    }),
  }),
)

export const header = "x-meridian-route-refusal"
type Route =
  | { readonly type: "claude"; readonly wireModel: string; readonly variant?: string }
  | { readonly type: "chatgpt"; readonly wireModel: string; readonly variant: string }
export type Proof = Route & { readonly requestID: string; readonly reason: typeof fields.reason.Type }

class AttestedError extends APICallError {
  constructor(readonly proof: Proof, response: Response, details: { readonly body: string; readonly message: string }) {
    super({
      message: details.message,
      url: response.url,
      statusCode: response.status,
      responseHeaders: Object.fromEntries(response.headers),
      responseBody: details.body,
      requestBodyValues: undefined,
      isRetryable: false,
    })
  }
}

export function proofOf(error: unknown) {
  return error instanceof AttestedError ? error.proof : undefined
}

export async function attest(response: Response, request: Route & { readonly requestID: string }) {
  // GPT's upstream can see a request ID; only Meridian may emit this response marker.
  if (request.type === "chatgpt" && response.headers.get(header) !== "1") return
  const text = await response.clone().text().catch(() => undefined)
  if (text === undefined) return
  const decoded = request.type === "claude"
    ? Option.getOrUndefined(Schema.decodeUnknownOption(claude)(text))
    : Option.getOrUndefined(Schema.decodeUnknownOption(chatgpt)(text))
  const route = decoded?.error.route_refusal
  if (!decoded || !route || decoded.error.request_id !== request.requestID || route.model !== request.wireModel) return
  if (request.type === "chatgpt" && (route.provider !== "chatgpt" || route.variant !== request.variant)) return
  const message = typeof decoded.error.message === "string" ? decoded.error.message : "No routable account"
  return new AttestedError({ ...request, reason: route.reason }, response, { body: text, message })
}

export * as MeridianRefusal from "./meridian-refusal"
