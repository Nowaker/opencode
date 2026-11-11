import type { ServerInfoOutput } from "@opencode/client/effect/api"

export interface App {
  readonly name: string
  readonly version: string
  readonly channel: string
  readonly capabilities?: NonNullable<ServerInfoOutput["capabilities"]>
}
