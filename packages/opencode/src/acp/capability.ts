/**
 * What the ACP client on the other end of this process can do, for the parts of
 * opencode that run in the same process but outside the ACP connection.
 *
 * One `opencode acp` process serves exactly one client over stdio, so a single
 * module-level record is the whole state. The tool registry needs it because
 * whether the `question` tool is worth offering the model depends on whether
 * the client can answer one, and that is only known once the client has sent
 * its capabilities in `initialize` - which always precedes `session/prompt`,
 * and therefore any tool resolution.
 */

const state = {
  questions: false,
}

/** Recorded from `initialize`, once the client's capabilities are known. */
export function setQuestions(supported: boolean) {
  state.questions = supported
}

/** Whether the client advertised a way to put a question in front of the user. */
export function questions() {
  return state.questions
}

export * as ACPCapability from "./capability"
