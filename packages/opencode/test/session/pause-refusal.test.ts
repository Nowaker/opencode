import { describe, expect, test } from "bun:test"
import { Option, Schema } from "effect"
import { SessionPause } from "../../src/session/pause"

const message = "No routable Claude account: 3 accounts spent, 1 reserve held (incident inc_1763330000000_7)"
const inner = {
  type: "rate_limit_error",
  code: "no_routable_account",
  message,
  reset_at: "2026-11-16T23:00:00.000Z",
  incident_id: "inc_1763330000000_7",
  request_id: "req_abc",
  profiles: [{ id: "work", reason: "spent", resets_at: null }],
}

describe("SessionPause.refusal", () => {
  test("a refusal before the stream keeps every Meridian field of the 429 body", () => {
    const error = {
      name: "APIError",
      data: {
        message,
        statusCode: 429,
        isRetryable: true,
        responseHeaders: { "retry-after": "60" },
        responseBody: JSON.stringify({ type: "error", error: inner }),
      },
    }
    expect(SessionPause.refusal(error)).toEqual({
      code: "no_routable_account",
      message,
      incident_id: "inc_1763330000000_7",
      request_id: "req_abc",
      reset_at: "2026-11-16T23:00:00.000Z",
      profiles: [{ id: "work", reason: "spent", resets_at: null }],
      api_error: error,
    })
  })

  test("a refusal as the stream's first chunk, stripped by the Anthropic SDK, matches on the prefix", () => {
    // The shape @ai-sdk/anthropic throws for an SSE error frame before any content, as stored on 2026-11-16.
    const error = {
      name: "APIError",
      data: {
        message,
        statusCode: 500,
        isRetryable: false,
        responseBody: JSON.stringify({ type: "rate_limit_error", message }),
        metadata: { url: "http://meridian-proxy.localhost:3450/messages" },
      },
    }
    expect(SessionPause.refusal(error)).toEqual({
      code: "no_routable_account",
      message,
      incident_id: "inc_1763330000000_7",
      api_error: error,
    })
  })

  test("a refusal later in the stream, recorded as an unknown error, matches on the prefix", () => {
    const error = { name: "UnknownError", data: { message: JSON.stringify({ type: "rate_limit_error", message }) } }
    expect(SessionPause.refusal(error)?.incident_id).toBe("inc_1763330000000_7")
    expect(SessionPause.refusal(error)?.message).toBe(message)
  })

  test("a message that only contains the prefix is a refusal without an incident", () => {
    const error = { name: "APIError", data: { message: "Too Many Requests: No routable Claude account: all spent" } }
    expect(SessionPause.refusal(error)).toEqual({
      code: "no_routable_account",
      message: "No routable Claude account: all spent",
      api_error: error,
    })
  })

  test("other errors are not refusals", () => {
    const errors = [
      {
        name: "APIError",
        data: {
          message: "Claude Max rate limit reached. Wait a moment and try again.",
          statusCode: 500,
          isRetryable: false,
          responseBody: JSON.stringify({
            type: "rate_limit_error",
            message: "Claude Max rate limit reached. Wait a moment and try again.",
          }),
        },
      },
      {
        name: "APIError",
        data: {
          message: "Rate limited",
          statusCode: 429,
          responseBody: JSON.stringify({ type: "error", error: { type: "rate_limit_error", code: "rate_limited" } }),
        },
      },
      { name: "UnknownError", data: { message: "boom" } },
      { name: "ContextOverflowError", data: { message: "Input exceeds context window of this model" } },
    ]
    expect(errors.map((error) => SessionPause.refusal(error))).toEqual([undefined, undefined, undefined, undefined])
  })

  test("malformed Meridian fields are left out, so the stored pause stays decodable", () => {
    const error = {
      name: "APIError",
      data: {
        message,
        statusCode: 429,
        responseBody: JSON.stringify({
          type: "error",
          error: { ...inner, incident_id: 7, request_id: null, reset_at: 1763330000000, profiles: "spent" },
        }),
      },
    }
    const refusal = SessionPause.refusal(error)
    expect(refusal?.incident_id).toBe("inc_1763330000000_7")
    expect(refusal && "request_id" in refusal).toBe(false)
    expect(refusal && "reset_at" in refusal).toBe(false)
    expect(refusal && "profiles" in refusal).toBe(false)
    const pause = { at: 1, mode: "soft", state: "paused", source: { kind: "api" }, reason: message, error: refusal }
    expect(Option.isSome(Schema.decodeUnknownOption(SessionPause.Info)(pause))).toBe(true)
  })
})
