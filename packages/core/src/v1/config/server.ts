export * as ConfigServerV1 from "./server"

import { Schema } from "effect"
import { NonNegativeInt, PositiveInt } from "../../schema"

export const Server = Schema.Struct({
  port: Schema.optional(PositiveInt).annotate({
    description: "Port to listen on",
  }),
  hostname: Schema.optional(Schema.String).annotate({ description: "Hostname to listen on" }),
  mdns: Schema.optional(Schema.Boolean).annotate({ description: "Enable mDNS service discovery" }),
  mdnsDomain: Schema.optional(Schema.String).annotate({
    description: "Custom domain name for mDNS service (default: opencode.local)",
  }),
  cors: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Additional domains to allow for CORS",
  }),
  instanceIdleTimeout: Schema.optional(NonNegativeInt).annotate({
    description:
      "Dispose inactive HTTP directory instances after this many milliseconds in serve/web (default: 900000, 0 disables). Active requests, streams and session work keep their instance alive. Does not apply to TUI/private instances.",
  }),
}).annotate({ identifier: "ServerConfig" })
export type Server = Schema.Schema.Type<typeof Server>
