import { RouteSwitch } from "@opencode/schema/route-switch"
import { Schema } from "effect"

export class AutoSwitchConflict extends Schema.TaggedError<AutoSwitchConflict>()(
  "AutoSwitchConflict",
  { data: RouteSwitch.Status },
  { httpApiStatus: 409 },
) {}

export class AutoSwitchUnavailable extends Schema.TaggedError<AutoSwitchUnavailable>()(
  "AutoSwitchUnavailable",
  { data: RouteSwitch.Status },
  { httpApiStatus: 503 },
) {}
