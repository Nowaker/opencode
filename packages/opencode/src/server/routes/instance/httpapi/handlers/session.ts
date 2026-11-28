import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Agent } from "@/agent/agent"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Command } from "@/command"
import { OwnerQuiescence } from "@/owner/quiescence"
import { Permission } from "@/permission"
import { SessionShare } from "@/share/session"
import { Session } from "@/session/session"
import { AutoSwitch } from "@/session/auto-switch"
import { CybersecPreservation } from "@/session/cybersec-preservation"
import { CybersecPreservationEvent } from "@opencode-ai/schema/cybersec-preservation-event"
import { Provider } from "@/provider/provider"
import { SessionCompaction } from "@/session/compaction"
import { MessageHistoryState } from "@/session/message-history-state"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionPause } from "@/session/pause"
import { SessionArchive } from "@/session/archive"
import { SessionSummary } from "@/session/summary"
import { Todo } from "@/session/todo"
import { MessageID, SessionID } from "@/session/schema"
import { NamedError } from "@opencode-ai/core/util/error"
import { Cause, Deferred, Effect, Option, Schema, Scope } from "effect"
import * as Stream from "effect/Stream"
import { InstanceState } from "@/effect/instance-state"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  AbortQuery,
  CommandPayload,
  DiffQuery,
  ForkPayload,
  InitPayload,
  ListQuery,
  MessagesQuery,
  PausePayload,
  PermissionResponsePayload,
  PromptPayload,
  UnpausePayload,
  RevertPayload,
  ShellPayload,
  SummarizePayload,
  UpdatePayload,
} from "../groups/session"
import {
  AutoSwitchConflict,
  AutoSwitchUnavailable,
  notFound,
  PermissionNotFoundError,
  PromptAdmissionError,
  PromptNotQueuedError,
  SendNowRefusedError,
  ServiceUnavailableError,
} from "../errors"
import * as SessionError from "./session-errors"
import { makePartHandlers } from "./session-parts"

const tryParseJson = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new HttpApiError.BadRequest({}),
  })

const preservationUnavailable = () =>
  new ServiceUnavailableError({ message: "Session cybersec preservation owner unavailable" })

function projectHistory(message: SessionV1.WithParts): SessionV1.WithParts {
  if (message.info.role !== "user") return message
  const promptOrigin = MessageV2.storedPromptOrigin(message.info)
  if (!promptOrigin && message.info.promptOrigin === undefined) return message
  return { ...message, info: { ...message.info, promptOrigin } }
}

export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const shareSvc = yield* SessionShare.Service
    const promptSvc = yield* SessionPrompt.Service
    const revertSvc = yield* SessionRevert.Service
    const compactSvc = yield* SessionCompaction.Service
    const runState = yield* SessionRunState.Service
    const agentSvc = yield* Agent.Service
    const permissionSvc = yield* Permission.Service
    const statusSvc = yield* SessionStatus.Service
    const pauseSvc = yield* SessionPause.Service
    const todoSvc = yield* Todo.Service
    const summary = yield* SessionSummary.Service
    const events = yield* EventV2Bridge.Service
    const scope = yield* Scope.Scope
    const { deletePart, updatePart } = yield* makePartHandlers

    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      const directory = ctx.query.directory ? yield* InstanceState.directory : undefined
      return yield* session.list({
        directory: ctx.query.scope === "project" ? undefined : directory,
        scope: ctx.query.scope,
        path: ctx.query.path,
        roots: ctx.query.roots,
        start: ctx.query.start,
        search: ctx.query.search,
        limit: ctx.query.limit,
      })
    })

    // A session paused before this process started is in the database only; it is listed as idle and paused.
    const status = Effect.fn("SessionHttpApi.status")(function* () {
      const live = yield* statusSvc.list()
      const paused = yield* pauseSvc.list()
      return {
        ...Object.fromEntries([...paused].map(([id, pause]) => [id, { type: "idle" as const, paused: pause }])),
        ...Object.fromEntries(live),
      }
    })

    const requireSession = Effect.fn("SessionHttpApi.requireSession")(function* (sessionID: SessionID) {
      return yield* SessionError.mapStorageNotFound(session.get(sessionID))
    })

    const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* requireSession(ctx.params.sessionID)
    })

    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* session.children(ctx.params.sessionID)
    })

    const todo = Effect.fn("SessionHttpApi.todo")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* todoSvc.get(ctx.params.sessionID)
    })

    const diff = Effect.fn("SessionHttpApi.diff")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof DiffQuery.Type
    }) {
      return yield* summary.diff({ sessionID: ctx.params.sessionID, messageID: ctx.query.messageID })
    })

    const messages = Effect.fn("SessionHttpApi.messages")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof MessagesQuery.Type
    }) {
      const anchor = ctx.query.after ?? ctx.query.before
      if (ctx.query.before && ctx.query.after) return yield* new HttpApiError.BadRequest({})
      if (ctx.query.after && ctx.query.order === "desc") return yield* new HttpApiError.BadRequest({})
      if (ctx.query.before && ctx.query.order === "asc") return yield* new HttpApiError.BadRequest({})
      if (anchor && ctx.query.limit === undefined) return yield* new HttpApiError.BadRequest({})
      if (anchor && !anchor.startsWith("msg")) {
        yield* Effect.try({
          try: () => MessageV2.cursor.decode(anchor),
          catch: () => new HttpApiError.BadRequest({}),
        })
      }
      yield* requireSession(ctx.params.sessionID)
      if (ctx.query.limit === undefined || ctx.query.limit === 0) {
        return (yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID })))
          .map(projectHistory)
      }

      const page = yield* SessionError.mapStorageNotFound(
        MessageV2.page({
          sessionID: ctx.params.sessionID,
          limit: ctx.query.limit,
          before: ctx.query.before,
          after: ctx.query.after,
          order: ctx.query.order,
        }),
      )
      const total = yield* MessageV2.total(ctx.params.sessionID)
      if (!page.cursor) {
        // Returning the items, not a jsonUnsafe response, keeps them going
        // through the success schema, so a corrupt stored row is still a 400.
        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(
            response.status >= 400
              ? response
              : HttpServerResponse.setHeaders(response, {
                  "Access-Control-Expose-Headers": "X-Total-Count",
                  "X-Total-Count": total.toString(),
                }),
          ),
        )
        return page.items.map(projectHistory)
      }

      const request = yield* HttpServerRequest.HttpServerRequest
      // toURL() honors the Host + x-forwarded-proto headers, so the Link
      // header echoes the real origin instead of a hard-coded localhost.
      const url = Option.getOrElse(HttpServerRequest.toURL(request), () => new URL(request.url, "http://localhost"))
      const direction = ctx.query.after !== undefined || ctx.query.order === "asc" ? "after" : "before"
      url.searchParams.set("limit", ctx.query.limit.toString())
      url.searchParams.delete("order")
      url.searchParams.delete(direction === "after" ? "before" : "after")
      url.searchParams.set(direction, page.cursor)
      return HttpServerResponse.jsonUnsafe(page.items.map(projectHistory), {
        headers: {
          "Access-Control-Expose-Headers": "Link, X-Next-Cursor, X-Total-Count",
          Link: `<${url.toString()}>; rel="next"`,
          "X-Next-Cursor": page.cursor,
          "X-Total-Count": total.toString(),
        },
      })
    })

    const message = Effect.fn("SessionHttpApi.message")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      return yield* SessionError.mapStorageNotFound(
        MessageV2.get({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID }),
      ).pipe(Effect.map(projectHistory))
    })

    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: { payload?: Session.CreateInput }) {
      return yield* shareSvc.create(ctx.payload)
    })

    const createRaw = Effect.fn("SessionHttpApi.createRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* create({})

      const json = yield* tryParseJson(body)
      const decoded = yield* Schema.decodeUnknownEffect(Session.CreateInput)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      const payload = decoded
        ? {
            ...decoded,
            permission: decoded.permission ? [...decoded.permission] : undefined,
          }
        : decoded
      return yield* create({ payload })
    })

    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* session.remove(ctx.params.sessionID).pipe(
        Effect.catchTag("NotFoundError", (error) => Effect.fail(notFound(error.message))),
        SessionError.mapProtectedHistory,
      )
      return true
    })

    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (ctx.payload.title !== undefined) {
        yield* session.setTitle({ sessionID: ctx.params.sessionID, title: ctx.payload.title })
      }
      if (ctx.payload.metadata !== undefined) {
        yield* session.setMetadata({ sessionID: ctx.params.sessionID, metadata: ctx.payload.metadata })
      }
      if (ctx.payload.permission !== undefined) {
        yield* session.setPermission({
          sessionID: ctx.params.sessionID,
          permission: Permission.merge(current.permission ?? [], ctx.payload.permission),
        })
      }
      if (ctx.payload.time?.archived !== undefined) {
        yield* session.setArchived({ sessionID: ctx.params.sessionID, time: ctx.payload.time.archived })
      }
      if (ctx.payload.model !== undefined) {
        yield* session.setModel({ sessionID: ctx.params.sessionID, model: ctx.payload.model })
        yield* HttpEffect.appendPreResponseHandler((_request, response) =>
          Effect.succeed(
            response.status >= 400
              ? response
              : HttpServerResponse.setHeaders(response, {
                  "x-vibeterm-session-model": "1",
                  "access-control-expose-headers": "x-vibeterm-session-model",
                }),
          ),
        )
      }
      return yield* requireSession(ctx.params.sessionID)
    })

    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload?: typeof ForkPayload.Type
    }) {
      return yield* session.fork({
        sessionID: ctx.params.sessionID,
        messageID: ctx.payload?.messageID,
        id: ctx.payload?.id,
        unsettled: ctx.payload?.unsettled,
        history: ctx.payload?.history,
        parentID: ctx.payload?.parentID,
        title: ctx.payload?.title,
        permission: ctx.payload?.permission,
      }).pipe(
        Effect.catchTag("NotFoundError", (error) => Effect.fail(notFound(error.message))),
        SessionError.mapProtectedHistory,
      )
    })

    const forkRaw = Effect.fn("SessionHttpApi.forkRaw")(function* (ctx: {
      params: { sessionID: SessionID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* fork({ params: ctx.params })

      const json = yield* tryParseJson(body)
      const payload = yield* Schema.decodeUnknownEffect(ForkPayload)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* fork({ params: ctx.params, payload })
    })

    const abort = Effect.fn("SessionHttpApi.abort")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof AbortQuery.Type
    }) {
      yield* promptSvc.cancel(ctx.params.sessionID, { requester: ctx.query.requester ?? "api" })
      return true
    })

    const init = Effect.fn("SessionHttpApi.init")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InitPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* promptSvc
        .command({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload.messageID,
          model: `${ctx.payload.providerID}/${ctx.payload.modelID}`,
          command: Command.Default.INIT,
          arguments: "",
        })
        .pipe(SessionError.mapPromptRequest)
      return true
    })

    // share/unshare errors aren't all client-induced — storage and network
    // failures from SessionShare are real possibilities. Map to a typed 500
    // (matches the legacy route behavior which routed any failure through
    // ErrorMiddleware → NamedError.Unknown 500) instead of blanket-mapping
    // every failure to a 400 BadRequest.
    const share = Effect.fn("SessionHttpApi.share")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc.share(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const unshare = Effect.fn("SessionHttpApi.unshare")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc
        .unshare(ctx.params.sessionID)
        .pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const summarize = Effect.fn("SessionHttpApi.summarize")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SummarizePayload.Type
    }) {
      yield* revertSvc.cleanup(yield* requireSession(ctx.params.sessionID))
      const messages = yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
      const defaultAgent = yield* agentSvc.defaultAgent()
      const currentAgent = messages.findLast((message) => message.info.role === "user")?.info.agent ?? defaultAgent

      yield* compactSvc.create({
        sessionID: ctx.params.sessionID,
        agent: currentAgent,
        model: {
          providerID: ctx.payload.providerID,
          modelID: ctx.payload.modelID,
        },
        auto: ctx.payload.auto ?? false,
      })
      yield* promptSvc.loop({ sessionID: ctx.params.sessionID })
      return true
    })

    const prompt = Effect.fn("SessionHttpApi.prompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const message = yield* promptSvc
        .prompt({
          ...ctx.payload,
          sessionID: ctx.params.sessionID,
        })
        .pipe(SessionError.mapPromptRequest)
      return HttpServerResponse.stream(Stream.make(JSON.stringify(message)).pipe(Stream.encodeText), {
        contentType: "application/json",
      })
    })

    const promptAsync = Effect.fn("SessionHttpApi.promptAsync")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const admission = yield* Deferred.make<void, SessionPrompt.AdmissionError>()
      const client = yield* SessionError.archiveClient
      yield* promptSvc.prompt({ ...ctx.payload, sessionID: ctx.params.sessionID }, admission).pipe(
        Effect.provideService(SessionArchive.Client, client),
        Effect.catchTag("ProtectedMessageHistoryError", (error) => Deferred.fail(admission, error)),
        Effect.onError((cause) => Deferred.failCause(admission, Cause.die(Cause.squash(cause)))),
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            if (Cause.squash(cause) instanceof SessionArchive.Error) return
            yield* Effect.logError("prompt_async failed", { sessionID: ctx.params.sessionID, cause })
            yield* events.publish(Session.Event.Error, {
              sessionID: ctx.params.sessionID,
              error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
            })
          }),
        ),
        (work) => OwnerQuiescence.fork(work, scope, true),
      )
      yield* Deferred.await(admission).pipe(
        Effect.catchTag("PromptAdmissionRejected", (error) =>
          Effect.fail(new PromptAdmissionError({
            name: "PromptAdmissionError",
            data: { message: error.message, possiblyAccepted: false },
          })),
        ),
        SessionError.mapArchive,
        SessionError.mapProtectedHistory,
      )
      return HttpApiSchema.NoContent.make()
    })

    const command = Effect.fn("SessionHttpApi.command")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof CommandPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* promptSvc
        .command({ ...ctx.payload, sessionID: ctx.params.sessionID })
        .pipe(SessionError.mapPromptRequest)
    })

    const shell = Effect.fn("SessionHttpApi.shell")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ShellPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* promptSvc.shell({ ...ctx.payload, sessionID: ctx.params.sessionID }).pipe(
        SessionError.mapBusy,
        SessionError.mapArchive,
        SessionError.mapProtectedHistory,
      )
    })

    const revert = Effect.fn("SessionHttpApi.revert")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* revertSvc.revert({ sessionID: ctx.params.sessionID, ...ctx.payload }).pipe(
        SessionError.mapBusy,
        Effect.catchTag("NoUndoSnapshot", () => Effect.fail(new HttpApiError.BadRequest({}))),
        SessionError.mapProtectedHistory,
      )
    })

    const applyRevert = Effect.fn("SessionHttpApi.applyRevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* revertSvc.apply(ctx.params).pipe(SessionError.mapBusy, SessionError.mapProtectedHistory)
    })

    const unrevert = Effect.fn("SessionHttpApi.unrevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* revertSvc.unrevert(ctx.params).pipe(SessionError.mapBusy, SessionError.mapProtectedHistory)
    })

    const permissionRespond = Effect.fn("SessionHttpApi.permissionRespond")(function* (ctx: {
      params: { sessionID: SessionID; permissionID: PermissionV1.ID }
      payload: typeof PermissionResponsePayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* permissionSvc.reply({ requestID: ctx.params.permissionID, reply: ctx.payload.response }).pipe(
        Effect.catchTag("Permission.NotFoundError", (error) =>
          Effect.fail(
            new PermissionNotFoundError({
              requestID: String(error.requestID),
              message: `Permission request not found: ${error.requestID}`,
            }),
          ),
        ),
      )
      return true
    })

    const deleteMessage = Effect.fn("SessionHttpApi.deleteMessage")(
      function* (ctx: { params: { sessionID: SessionID; messageID: MessageID } }) {
        yield* MessageHistoryState.assertWritable(yield* requireSession(ctx.params.sessionID))
        yield* SessionError.mapBusy(runState.assertNotBusy(ctx.params.sessionID))
        yield* session.removeMessage(ctx.params)
        return true
      },
      OwnerQuiescence.activity,
      SessionError.mapProtectedHistory,
    )

    const unqueue = Effect.fn("SessionHttpApi.unqueue")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* promptSvc.unqueue(ctx.params).pipe(
        Effect.catchTag("NotFoundError", (error) => Effect.fail(notFound(error.message))),
        Effect.catchTag("SessionPromptNotQueuedError", (error) =>
          Effect.fail(
            new PromptNotQueuedError({
              sessionID: error.sessionID,
              messageID: error.messageID,
              reason: error.reason,
              message:
                error.reason === "started"
                  ? "The running turn has already picked up this prompt"
                  : "This prompt is not queued behind a running turn",
            }),
          ),
        ),
        SessionError.mapProtectedHistory,
      )
    })

    const sendNow = Effect.fn("SessionHttpApi.sendNow")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      const messageIDs = yield* promptSvc.sendNow(ctx.params.sessionID).pipe(
        Effect.catchTag("SessionSendNowRefusedError", (error) =>
          Effect.fail(
            new SendNowRefusedError({
              sessionID: error.sessionID,
              reason: error.reason,
              message: {
                busy: "A turn is already running; it reads the queued messages itself",
                empty: "Nothing is queued: every message has already been read",
                paused: "The session is paused; unpause it first",
              }[error.reason],
            }),
          ),
        ),
        SessionError.mapProtectedHistory,
      )
      return { sessionID: ctx.params.sessionID, messageIDs }
    })

    // These routes take an empty body as well as JSON, so a bare POST pauses, unpauses or discards.
    const optionalBody = <A>(schema: Schema.Decoder<A>) =>
      Effect.fn("SessionHttpApi.optionalBody")(function* (request: HttpServerRequest.HttpServerRequest) {
        const body = yield* Effect.orDie(request.text)
        if (body.trim().length === 0) return undefined
        const json = yield* tryParseJson(body)
        return yield* Schema.decodeUnknownEffect(schema)(json).pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      })
    const pauseBody = optionalBody(PausePayload)
    const unpauseBody = optionalBody(UnpausePayload)

    const pause = Effect.fn("SessionHttpApi.pause")(function* (ctx: {
      params: { sessionID: SessionID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const payload = yield* pauseBody(ctx.request)
      yield* requireSession(ctx.params.sessionID)
      return yield* promptSvc.pause({ ...payload, sessionID: ctx.params.sessionID }).pipe(SessionError.mapProtectedHistory)
    })

    const unpause = Effect.fn("SessionHttpApi.unpause")(function* (ctx: {
      params: { sessionID: SessionID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const payload = yield* unpauseBody(ctx.request)
      yield* requireSession(ctx.params.sessionID)
      return yield* promptSvc.unpause({ ...payload, sessionID: ctx.params.sessionID }).pipe(
        SessionError.mapPauseChanged,
        SessionError.mapProtectedHistory,
      )
    })

    const discard = Effect.fn("SessionHttpApi.discard")(function* (ctx: {
      params: { sessionID: SessionID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const payload = yield* unpauseBody(ctx.request)
      yield* requireSession(ctx.params.sessionID)
      return yield* promptSvc.discard({ ...payload, sessionID: ctx.params.sessionID }).pipe(
        SessionError.mapBusy,
        SessionError.mapPauseChanged,
        SessionError.mapProtectedHistory,
      )
    })

    return handlers
      .handle("list", list)
      .handle("status", status)
      .handle("get", get)
      .handle("autoSwitchStatus", (ctx) => Provider.Service.use((provider) =>
        AutoSwitch.read(session, ctx.params.sessionID).pipe(Effect.provideService(AutoSwitch.Providers, provider)),
      ))
      .handle("autoSwitchUpdate", (ctx) =>
        Effect.gen(function* () {
          const provider = yield* Provider.Service
          const result = yield* AutoSwitch.mutate(session, ctx.params.sessionID, ctx.payload).pipe(
            Effect.provideService(AutoSwitch.Providers, provider),
          )
          if (result.statusCode === 409) return yield* new AutoSwitchConflict(result.status)
          if (result.statusCode === 503) return yield* new AutoSwitchUnavailable(result.status)
          return result.status
        }),
      )
      .handle("cybersecPreservationStatus", (ctx) =>
        Effect.gen(function* () {
          const current = yield* requireSession(ctx.params.sessionID)
          if (!(yield* AutoSwitch.inScope(session, current))) return yield* preservationUnavailable()
          return CybersecPreservation.stored(current)
        }),
      )
      .handle("cybersecPreservationUpdate", (ctx) =>
        AutoSwitch.withOwnerDispatch(
          Effect.gen(function* () {
            const sessionID = ctx.params.sessionID
            const result = yield* SessionError.mapStorageNotFound(
              session.setCybersecPreservation({
                sessionID,
                preference: ctx.payload.preference,
                current: (row) => AutoSwitch.inScope(session, row),
              }),
            )
            if (!result) return yield* preservationUnavailable()
            if (result.changed) {
              yield* events.publish(CybersecPreservationEvent.Updated, {
                version: 1,
                sessionID,
                revision: result.status.revision,
              })
            }
            return result.status
          }).pipe(Effect.uninterruptible),
        ),
      )
      .handle("children", children)
      .handle("todo", todo)
      .handle("diff", diff)
      .handle("messages", messages)
      .handle("message", message)
      .handleRaw("create", createRaw)
      .handle("remove", remove)
      .handle("update", update)
      .handleRaw("fork", forkRaw)
      .handle("abort", abort)
      .handle("init", init)
      .handle("share", share)
      .handle("unshare", unshare)
      .handle("summarize", (ctx) => OwnerQuiescence.activity(summarize(ctx)).pipe(SessionError.mapProtectedHistory))
      .handle("prompt", prompt)
      .handle("promptAsync", promptAsync)
      .handle("command", command)
      .handle("shell", shell)
      .handle("revert", revert)
      .handle("applyRevert", applyRevert)
      .handle("unrevert", unrevert)
      .handle("unqueue", unqueue)
      .handle("sendNow", sendNow)
      .handleRaw("pause", pause)
      .handleRaw("unpause", unpause)
      .handleRaw("discard", discard)
      .handle("permissionRespond", permissionRespond)
      .handle("deleteMessage", deleteMessage)
      .handle("deletePart", deletePart)
      .handle("updatePart", updatePart)
  }),
)
