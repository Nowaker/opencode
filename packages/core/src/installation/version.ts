declare global {
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
}

// Fork builds stamp `<release>-vt-<fork commits>-<upstream sha>` (see
// .vibeterm/build.sh), a semver prerelease of the upstream release they sit
// on. Registry pins, semver ranges and "already on the latest release" checks
// need that upstream release, not the stamp: no npm package is published under
// the stamp, and a prerelease never satisfies a plain range like ">=1.0.0".
export function baseVersion(version: string) {
  return version.replace(/-vt-\d+-[0-9a-f]{10}$/, "")
}

export const InstallationVersion = typeof OPENCODE_VERSION === "string" ? OPENCODE_VERSION : "local"
export const InstallationBaseVersion = baseVersion(InstallationVersion)
export const InstallationChannel = typeof OPENCODE_CHANNEL === "string" ? OPENCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
