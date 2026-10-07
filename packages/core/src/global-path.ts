export * as GlobalPath from "./global-path"

import path from "path"
import os from "os"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"

// The directories opencode keeps its files in, without global.ts's side
// effects (directory creation, flock setup, Effect services). The instant
// startup prompt reads these before the rest of the CLI loads.
const app = "opencode"
const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)
const tmp = path.join(os.tmpdir(), app)

export const paths = {
  get home() {
    return process.env.OPENCODE_TEST_HOME ?? os.homedir()
  },
  data,
  bin: path.join(cache, "bin"),
  log: path.join(data, "log"),
  repos: path.join(data, "repos"),
  cache,
  config,
  state,
  tmp,
}
