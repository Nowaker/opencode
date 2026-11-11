import { Session } from "@opencode/core/session"
import { SessionMessagePage } from "@opencode/core/session/message-page"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../api"
import { wantsMediaRefs } from "../media-uri"
import { InvalidCursorError } from "@opencode/protocol/errors"
import { SessionMediaMessagesResponse } from "@opencode/protocol/groups/message"
import { failedMessageDecode, missingSession } from "./session-error"

export const MessageHandler = HttpApiBuilder.group(Api, "server.message", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service

    return handlers.handle(
      "session.messages",
      Effect.fn(function* (ctx) {
        const input = { ...ctx.query, sessionID: ctx.params.sessionID }
        if (wantsMediaRefs(ctx.request)) {
          const page = yield* SessionMessagePage.list(input, session.messagesWithRefs).pipe(
            Effect.catchTag(
              "Session.MessagesCursorError",
              (error) => new InvalidCursorError({ message: error.message }),
            ),
            Effect.catchTag("Session.NotFoundError", missingSession),
            Effect.catchTag("Session.MessageDecodeError", failedMessageDecode),
          )
          return yield* HttpServerResponse.schemaJson(SessionMediaMessagesResponse)(page).pipe(Effect.orDie)
        }
        return yield* SessionMessagePage.list(input, session.messages).pipe(
          Effect.catchTag("Session.MessagesCursorError", (error) => new InvalidCursorError({ message: error.message })),
          Effect.catchTag("Session.NotFoundError", missingSession),
          Effect.catchTag("Session.MessageDecodeError", failedMessageDecode),
        )
      }),
    )
  }),
)
