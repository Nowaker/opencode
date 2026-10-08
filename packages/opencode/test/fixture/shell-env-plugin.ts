// Exposes the ids the `shell.env` hook received to the command it decorates, so a
// test can assert them from the command's output.
export default async () => ({
  "shell.env": async (
    input: { sessionID?: string; messageID?: string; callID?: string },
    output: { env: Record<string, string> },
  ) => {
    output.env.HOOK_IDS = [input.sessionID, input.messageID, input.callID].join("|")
  },
})
