import { Effect, Schema } from "effect"
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { McpOAuthPendingProvider } from "./oauth-provider"

export const AuthStartOptions = Schema.Struct({
  callbackMode: Schema.Literal("external"),
  redirectUri: Schema.String.check(
    Schema.makeFilter((value) => {
      if (!URL.canParse(value)) return false
      const url = new URL(value)
      return (
        !url.username &&
        !url.password &&
        !value.includes("#") &&
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            (url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(url.hostname))))
      )
    }),
  ),
})
export type AuthStartOptions = typeof AuthStartOptions.Type

export interface AuthCompletion {
  readonly state?: string
  readonly error?: string
  readonly errorDescription?: string
}

export class AuthFlowError extends Schema.TaggedErrorClass<AuthFlowError>()("MCP.AuthFlowError", {
  message: Schema.String,
}) {}

interface Flow {
  readonly directory: string
  readonly oauthState: string
  readonly redirectUri: string
  readonly expiresAt: number
  readonly timer: ReturnType<typeof setTimeout>
  readonly abort: AbortController
  transport?: StreamableHTTPClientTransport
  provider?: McpOAuthPendingProvider
  phase: "starting" | "pending" | "completing"
}

export class ExternalAuth {
  private readonly flows = new Map<string, Flow>()

  constructor(private readonly now: () => number = Date.now) {}

  active(name: string) {
    return this.flows.has(name)
  }

  owns(name: string, flow: Flow) {
    return this.flows.get(name) === flow && this.now() < flow.expiresAt
  }

  reserve(name: string, directory: string, redirectUri: string) {
    return Effect.suspend(() => {
      if (this.flows.has(name)) return new AuthFlowError({ message: "OAuth flow already pending" })
      const flow: Flow = {
        directory,
        redirectUri,
        oauthState: crypto.randomUUID() + crypto.randomUUID(),
        expiresAt: this.now() + 300_000,
        phase: "starting",
        abort: new AbortController(),
        timer: setTimeout(() => {
          void this.release(name, flow)
        }, 300_000),
      }
      flow.timer.unref()
      this.flows.set(name, flow)
      return Effect.succeed(flow)
    })
  }

  claim(name: string, directory: string, state: string | undefined) {
    return Effect.suspend(() => {
      const flow = this.flows.get(name)
      if (!flow || flow.directory !== directory || !state || state !== flow.oauthState)
        return new AuthFlowError({ message: "Invalid OAuth callback state or owner" })
      if (this.now() >= flow.expiresAt) {
        void this.release(name, flow)
        return new AuthFlowError({ message: "OAuth flow expired" })
      }
      if (flow.phase !== "pending") return new AuthFlowError({ message: "OAuth callback already claimed or not ready" })
      flow.phase = "completing"
      return Effect.succeed(flow)
    })
  }

  ready(name: string, flow: Flow) {
    return Effect.suspend(() => {
      if (!this.owns(name, flow)) return new AuthFlowError({ message: "OAuth flow expired" })
      flow.phase = "pending"
      return Effect.void
    })
  }

  cancel(name: string, directory: string) {
    return Effect.suspend(() => {
      const flow = this.flows.get(name)
      if (!flow) return Effect.void
      if (flow.directory !== directory) return new AuthFlowError({ message: "Invalid OAuth flow owner" })
      if (flow.phase === "completing") return new AuthFlowError({ message: "OAuth callback already claimed" })
      return Effect.promise(() => this.release(name, flow))
    })
  }

  async release(name: string, flow: Flow) {
    if (this.flows.get(name) === flow) this.flows.delete(name)
    clearTimeout(flow.timer)
    if (flow.transport) {
      flow.abort.abort()
      await Promise.allSettled([flow.transport.close()])
    }
  }

  async releaseDirectory(directory: string) {
    await Promise.all(
      [...this.flows]
        .filter(([, flow]) => flow.directory === directory)
        .map(([name, flow]) => this.release(name, flow)),
    )
  }
}

export const externalAuth = new ExternalAuth()
