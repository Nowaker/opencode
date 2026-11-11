# @opencode/client

Private generation target for clients derived directly from OpenCode's authoritative Effect `HttpApi`.

## Entrypoints

- `@opencode/client`: zero-Effect Promise client using `fetch`.
- `@opencode/client/effect`: rich Effect network client using an environment-provided `HttpClient`.

The generated surface includes every standard HTTP group from Server's concrete API. The build compiler reads `@opencode/server/api`; the generated Effect runtime imports a client-local projection built from Protocol, with a generation-equivalence test preventing transport drift. Custom transports such as the PTY WebSocket connection remain outside the generic HTTP client. Run `bun run generate` after changing the contract and `bun run check:generated` to detect committed-output drift.

The Effect entrypoint uses canonical decoded values such as `Session.ID`, `Location.Ref`, and `Prompt`. These datatypes come from the lightweight `@opencode/schema` package and are re-exported so callers depend only on the client surface. Protocol owns endpoint construction and middleware placement; Server supplies the concrete middleware keys used by the build-time API.

The Promise root remains structural and has no Core or Effect runtime dependency. `/effect` depends only on Effect, Schema, and Protocol and is browser-bundle safe. Bundle-boundary tests enforce both import graphs.

Effect consumers construct canonical decoded inputs:

```ts
import { AbsolutePath, Location, OpenCode, Prompt } from "@opencode/client/effect"

const client = yield * OpenCode.make({ baseUrl: "https://opencode.example" })
yield *
  client.sessions.create({
    location: Location.Ref.make({ directory: AbsolutePath.make("/workspace") }),
  })
yield * client.sessions.prompt({ sessionID, prompt: Prompt.make({ text: "Hello" }) })
```

## Synthetic notes

Use `client.session.synthetic` to add application context or a human-visible note to an existing session. Set `ignored: true` for a note that must stay out of model input, including compaction requests and the retained conversation text rebuilt after compaction:

```ts
yield * client.session.synthetic({
  sessionID,
  text: "Deploy paused while you review the changes.",
  ignored: true,
})
```

Ignored notes are stored in the transcript immediately and published as `session.synthetic` events. They do not enter the inbox or start model execution, even with `resume: true` or `delivery: "queue"`. The web and terminal timelines show a nonblank `description` when supplied, otherwise the note's `text`. Transcript and event readers can still read the complete note; `ignored` controls model input, not access to the data.

Omitting `ignored`, or setting it to `false`, preserves normal synthetic input: it enters the inbox, is sent to the model when delivered, and schedules execution unless `resume: false`. Use `description` to show normal synthetic context in the timeline. `resume: false` alone does not exclude input from a later model call.

Supply an `id` when you need idempotent retries. For the same session and synthetic ID, the first saved payload wins, including its `ignored` value; a retry cannot turn a note into model input or replace its text. Reusing the ID for another session or a user prompt returns a conflict. The HTTP equivalent is `POST /api/session/{sessionID}/synthetic` with the same fields in its JSON body.
