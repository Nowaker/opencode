import type {
  AgentSideConnection,
  CreateElicitationRequest,
  ElicitationContentValue,
  ElicitationPropertySchema,
} from "@agentclientprotocol/sdk"
import type { Event, OpencodeClient, QuestionAnswer, QuestionInfo } from "@opencode-ai/sdk/v2"
import { Effect } from "effect"
import { ACPCapability } from "./capability"
import type { ACPSession } from "./session"

type QuestionEvent = Extract<Event, { type: "question.asked" }>
type QuestionRequest = QuestionEvent["properties"]
type Connection = Partial<Pick<AgentSideConnection, "unstable_createElicitation">>

/**
 * Puts a pending question in front of the ACP client and settles it.
 *
 * This is keyed on the `question.asked` event rather than on the built-in
 * `question` tool, so anything that asks through the question service reaches
 * the client the same way - exactly how `permission.asked` already works.
 */
export class Handler {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly input: {
      sdk: OpencodeClient
      connection: Connection
      session: ACPSession.Interface
    },
  ) {}

  handle(event: QuestionEvent) {
    const question = event.properties
    const previous = this.queues.get(question.sessionID) ?? Promise.resolve()
    const next = previous
      .then(() => this.process(event))
      .catch(() => {})
      .finally(() => {
        if (this.queues.get(question.sessionID) === next) {
          this.queues.delete(question.sessionID)
        }
      })
    this.queues.set(question.sessionID, next)
  }

  private async process(event: QuestionEvent) {
    const question = event.properties
    const session = await Effect.runPromise(this.input.session.tryGet(question.sessionID))
    if (!session) return

    // A client with nowhere to show the question is not asked, and the request
    // is refused at once: the tool reports a dismissed question instead of the
    // agent waiting on an answer that cannot arrive.
    if (!ACPCapability.questions() || !this.input.connection.unstable_createElicitation) {
      await this.reject(question.id, session.cwd)
      return
    }

    const result = await this.input.connection
      .unstable_createElicitation(elicitation(question, session.id))
      .catch(() => undefined)

    if (!result || result.action !== "accept") {
      await this.reject(question.id, session.cwd)
      return
    }

    await this.input.sdk.question.reply({
      requestID: question.id,
      directory: session.cwd,
      answers: answers(question.questions, result.content),
    })
  }

  private async reject(requestID: string, directory: string) {
    await this.input.sdk.question.reject({ requestID, directory })
  }
}

/** One request asks every one of its questions as a single form. */
function elicitation(question: QuestionRequest, sessionId: string): CreateElicitationRequest {
  return {
    mode: "form",
    sessionId,
    ...(question.tool ? { toolCallId: question.tool.callID } : {}),
    message: question.questions.map((item) => item.question).join("\n\n"),
    requestedSchema: {
      type: "object",
      properties: Object.fromEntries(question.questions.map((item, index) => [field(index), property(item)])),
      required: question.questions.map((_, index) => field(index)),
    },
  }
}

/**
 * A question's options become a closed set of choices - `oneOf` for one answer,
 * `items.anyOf` for several - because those options are the answer the tool
 * asked for, and a client renders them as a picker. A form field has no
 * equivalent of the free-text answer `custom` allows in the TUI, so each
 * option's own explanation is carried in the field description instead.
 */
function property(question: QuestionInfo): ElicitationPropertySchema {
  const choices = question.options.map((option) => ({ const: option.label, title: option.label }))
  const description = [
    question.question,
    ...question.options.map((option) => `- ${option.label}: ${option.description}`),
  ].join("\n")
  if (question.multiple) return { type: "array", title: question.header, description, items: { anyOf: choices } }
  return { type: "string", title: question.header, description, oneOf: choices }
}

function answers(
  questions: ReadonlyArray<QuestionInfo>,
  content: { readonly [key: string]: ElicitationContentValue } | null | undefined,
): QuestionAnswer[] {
  return questions.map((_, index) => answer(content?.[field(index)]))
}

/** A field the user left out answers nothing, which the tool reports as unanswered. */
function answer(value: ElicitationContentValue | undefined): QuestionAnswer {
  if (value === undefined) return []
  if (Array.isArray(value)) return [...value]
  return [String(value)]
}

function field(index: number) {
  return `q${index}`
}

export * as ACPQuestion from "./question"
