import { EngineStop } from "@opencode/schema/engine-stop"

export const EngineStopControlError = EngineStop.ControlError.annotate({
  identifier: "EngineStopControlError",
  httpApiStatus: 409,
})

export const EngineStopRefusedError = EngineStop.RefusedError.annotate({
  identifier: "EngineStopRefusedError",
  httpApiStatus: 503,
})
