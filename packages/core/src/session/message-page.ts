export * as SessionMessagePage from "./message-page.js"

import { Effect, Option, Schema } from "effect"
import { SessionMessage } from "./message.js"
import type { SessionStore } from "./store.js"

const Cursor = Schema.Struct({
  id: SessionMessage.ID,
  order: Schema.Literals(["asc", "desc"]),
  direction: Schema.Literals(["previous", "next"]),
})
const decodeCursor = Schema.decodeUnknownOption(Schema.fromJsonString(Cursor))

export class InvalidCursorError extends Schema.TaggedError<InvalidCursorError>()("Session.MessagesCursorError", {
  message: Schema.String,
}) {}

type Input = Omit<SessionStore.MessagesInput, "cursor"> & { readonly cursor?: string }

export const list = Effect.fn("SessionMessagePage.list")(function* <
  Message extends { readonly id: SessionMessage.ID },
  E,
  R,
>(input: Input, read: (input: SessionStore.MessagesInput) => Effect.Effect<ReadonlyArray<Message>, E, R>) {
  if (input.cursor && input.order !== undefined)
    return yield* new InvalidCursorError({ message: "Cursor cannot be combined with order" })
  const decoded = input.cursor
    ? (Option.getOrUndefined(decodeCursor(Buffer.from(input.cursor, "base64url").toString("utf8"))) ??
      (yield* new InvalidCursorError({ message: "Invalid cursor" })))
    : undefined
  const order = decoded?.order ?? input.order ?? "desc"
  const messages = yield* read({
    sessionID: input.sessionID,
    limit: input.limit ?? 50,
    order,
    type: input.type,
    cursor: decoded ? { id: decoded.id, direction: decoded.direction } : undefined,
  })
  const encode = (message: Message | undefined, direction: "previous" | "next") =>
    message ? Buffer.from(JSON.stringify({ id: message.id, order, direction })).toString("base64url") : undefined
  return {
    data: messages,
    cursor: {
      previous: encode(messages[0], "previous"),
      next: encode(messages.at(-1), "next"),
    },
  }
})
