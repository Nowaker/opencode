#!/usr/bin/env bash
# Canonical opencode-from-source build + install for this host.
#
# Tracked in the fork at .vibeterm/build.sh on dev-nowaker.
# ~/projekty/webapps/opencode-build/build.sh is a shim that execs the
# primary checkout's copy, so the old path keeps working.
#
# Source tree:    the checkout this script lives in (the primary
#                 checkout ~/projekty/webapps/opencode, branch
#                 dev-nowaker, when run through the shim).
#                 OPENCODE_SRC overrides it, e.g. to build a worktree.
# Install target: opencode-build/bin/opencode beside the primary
#                 checkout (found through the git common dir, so a
#                 worktree installs to the same place):
#                 ~/projekty/webapps/opencode-build/bin/opencode on
#                 Linux, ~/projects/webapps/opencode-build/bin/opencode
#                 on the Macs. OPENCODE_INSTALL overrides it.
#                 This path is what opencode-serve-tailscale.service
#                 ExecStarts from. (opencode-serve-lan.service is off-
#                 limits and must not be restarted by this workflow.)
#
# Version stamp: <base>-vt-<seq>-<sha>, e.g. 1.18.32-vt-48-2406400f0a
#   - OPENCODE_VERSION overrides detection when set, verbatim.
#   - Otherwise, version tags are fetched from OPENCODE_TAG_REMOTE
#     (default: the upstream remote, `github`, or `upstream` where a
#     checkout names it that).
#   - If HEAD is exactly on a vX.Y.Z tag, build as plain X.Y.Z: that is
#     an upstream release build, not a fork build.
#   - Otherwise:
#     - base: the newest release HEAD contains - the highest vX.Y.Z tag
#       whose release commit's parent is an ancestor of HEAD. dev past
#       v1.18.32 has base 1.18.32; a v2.x tag cut from another line is
#       never picked.
#     - seq: fork commits on top of upstream,
#       git rev-list --count $(git merge-base HEAD <upstream>)..HEAD
#     - sha: first 10 hex chars of that merge-base, the upstream commit
#       dev-nowaker is reintegrated onto.
#     <upstream> is OPENCODE_UPSTREAM_REF, default <tag remote>/dev.
#   The stamp is a semver prerelease of <base>, so an upstream release on
#   the system (1.18.33) is detectable as newer than the fork's base.
#   opencode itself strips the suffix (InstallationBaseVersion) wherever a
#   registry pin or semver range needs the release.
#
# The Script module (packages/script/src/index.ts) infers
# OPENCODE_CHANNEL="latest" when OPENCODE_VERSION is set and does NOT
# start with "0.0.0-". Without OPENCODE_VERSION, channel falls back to
# `git branch --show-current` -> a preview/dev build with branch name
# embedded in the version string. We do NOT want that. Always set
# OPENCODE_VERSION to a real semver value.
#
# OPENCODE_INSTALL_METHOD=unknown stamps the binary as unmanaged: it never
# infers an install method from an npm or Homebrew opencode elsewhere on the
# machine, never checks for or offers upstream updates, and never upgrades
# itself. Rebuilding with this script is its only update path.
#
# v1 database guard gate: before installing, the built binary is handed to
# opencode-tools' `vibeterm-v2-guard gate --v1 <built>`. In scratch
# directories it creates a blank v1 database with the built binary and with
# npm's newest opencode-ai 1.x, adds the guard that keeps a vanilla opencode
# v2 from migrating a v1 database, runs npm's newest @opencode/cli on it, and
# requires v2 to fail naming the guard with the database's full logical
# dump unchanged, and the v1 binary to still serve it. A failing gate
# installs nothing. The guard command is VIBETERM_V2_GUARD, else
# `vibeterm-v2-guard` on PATH. OPENCODE_SKIP_V2_GUARD_GATE=1 skips the gate,
# loudly; it is for a host without opencode-tools, never for a failing gate.
#
# The running opencode-serve units keep the OLD binary via still-open
# file descriptors after this script swaps the on-disk inode (mv+cp).
# New binary activates on the NEXT service restart (do that yourself;
# this script does not restart the units - that aborts in-flight
# sessions and is bound by the do-not-restart-AI-side rule).
#
# Usage: build.sh [--print-version]
#   --print-version  fetch tags, print the stamp this build would use, and
#                    exit without building or installing.

set -euo pipefail

PRINT_VERSION=0
case "${1-}" in
  "") ;;
  --print-version) PRINT_VERSION=1 ;;
  -h | --help)
    sed -n '2,/^$/s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"
    exit 0
    ;;
  *)
    echo "error: unknown argument: $1" >&2
    echo "       run with --help for full usage" >&2
    exit 2
    ;;
esac
if [ "$#" -gt 1 ]; then
  echo "error: unexpected extra argument: $2" >&2
  echo "       run with --help for full usage" >&2
  exit 2
fi

SRC="${OPENCODE_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
if [ ! -d "$SRC/packages/opencode" ]; then
  echo "error: opencode source not found at $SRC" >&2
  exit 1
fi

GIT_COMMON="$(git -C "$SRC" rev-parse --path-format=absolute --git-common-dir)"
BUILD_ROOT="$(dirname "$(dirname "$GIT_COMMON")")/opencode-build"
INSTALL="${OPENCODE_INSTALL:-$BUILD_ROOT/bin/opencode}"
if [ -z "${OPENCODE_TAG_REMOTE-}" ] && ! git -C "$SRC" remote get-url github >/dev/null 2>&1 \
  && git -C "$SRC" remote get-url upstream >/dev/null 2>&1; then
  OPENCODE_TAG_REMOTE=upstream
fi
TAG_REMOTE="${OPENCODE_TAG_REMOTE:-github}"
UPSTREAM_REF="${OPENCODE_UPSTREAM_REF:-$TAG_REMOTE/dev}"
LOCKFILE="$SRC/bun.lock"
LOCKFILE_BACKUP=""

restore_lockfile() {
  if [ -n "$LOCKFILE_BACKUP" ] && [ -f "$LOCKFILE_BACKUP" ]; then
    cp "$LOCKFILE_BACKUP" "$LOCKFILE"
    rm -f "$LOCKFILE_BACKUP"
  fi
}

version_from_tag() {
  local tag="$1"
  if [[ "$tag" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    printf '%s.%s.%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
    return 0
  fi
  return 1
}

fetch_version_tags() {
  if git remote get-url "$TAG_REMOTE" >/dev/null 2>&1; then
    git fetch "$TAG_REMOTE" --tags --prune
    return
  fi

  git fetch --tags --prune
}

detect_version() {
  (
    cd "$SRC"
    fetch_version_tags

    local tag
    local version
    while IFS= read -r tag; do
      if version="$(version_from_tag "$tag")"; then
        printf '%s\n' "$version"
        return 0
      fi
    done < <(git describe --tags --exact-match --match 'v[0-9]*.[0-9]*.[0-9]*' HEAD 2>/dev/null || true)

    # Upstream cuts each release as a single "release: vX.Y.Z" commit on
    # top of dev, so the tag itself is never an ancestor of dev. The
    # release HEAD contains is the highest tag whose parent is an ancestor.
    local base=""
    while IFS= read -r tag; do
      if version="$(version_from_tag "$tag")" \
        && git merge-base --is-ancestor "$tag^" HEAD 2>/dev/null; then
        base="$version"
        break
      fi
    done < <(git tag --list 'v*' --sort=-v:refname)

    if [ -z "$base" ]; then
      echo "error: no vX.Y.Z version tags found in $SRC" >&2
      return 1
    fi

    local upstream
    if ! upstream="$(git merge-base HEAD "$UPSTREAM_REF")"; then
      echo "error: HEAD shares no history with $UPSTREAM_REF in $SRC" >&2
      return 1
    fi

    local seq
    seq="$(git rev-list --count "$upstream..HEAD")"
    printf '%s-vt-%s-%s\n' "$base" "$seq" "${upstream:0:10}"
  )
}

VERSION="${OPENCODE_VERSION:-$(detect_version)}"

if [ "$PRINT_VERSION" = 1 ]; then
  printf '%s\n' "$VERSION"
  exit 0
fi

if [ -f "$LOCKFILE" ]; then
  mkdir -p "$BUILD_ROOT"
  LOCKFILE_BACKUP="$BUILD_ROOT/.bun.lock.before-build.$$"
  cp "$LOCKFILE" "$LOCKFILE_BACKUP"
  trap restore_lockfile EXIT
fi

echo "Building opencode @ $VERSION from $SRC ..."
(
  cd "$SRC/packages/opencode"
  OPENCODE_VERSION="$VERSION" OPENCODE_INSTALL_METHOD=unknown bun ./script/build.ts --single
)

shopt -s nullglob
BUILT_CANDIDATES=("$SRC"/packages/opencode/dist/opencode-*/bin/opencode)
shopt -u nullglob
if [ "${#BUILT_CANDIDATES[@]}" -ne 1 ]; then
  echo "error: expected one native binary under $SRC/packages/opencode/dist, found ${#BUILT_CANDIDATES[@]}" >&2
  exit 1
fi
BUILT="${BUILT_CANDIDATES[0]}"

v2_guard_gate() {
  if [ "${OPENCODE_SKIP_V2_GUARD_GATE-}" = 1 ]; then
    echo "WARNING: OPENCODE_SKIP_V2_GUARD_GATE=1 - installing $VERSION without proving the v1 database guard" >&2
    return 0
  fi
  local guard="${VIBETERM_V2_GUARD:-$(command -v vibeterm-v2-guard || true)}"
  if [ -z "$guard" ] || [ ! -x "$guard" ]; then
    echo "error: vibeterm-v2-guard not found; set VIBETERM_V2_GUARD to opencode-tools'" >&2
    echo "       vibeterm-opencode-client/bin/vibeterm-v2-guard (or OPENCODE_SKIP_V2_GUARD_GATE=1)" >&2
    return 1
  fi
  echo "Proving the v1 database guard against $BUILT ..."
  if ! "$guard" gate --v1 "$BUILT"; then
    echo "error: the v1 database guard does not hold for $VERSION or the newest opencode releases;" >&2
    echo "       NOT installing. Fix the guard in opencode-tools (_lib/v2-migration-guard) first." >&2
    return 1
  fi
}
v2_guard_gate || exit 1

mkdir -p "$(dirname "$INSTALL")"

# mv + cp inode swap: the running serve unit keeps its file descriptor
# pointing at the old inode (so it keeps working with the old binary
# until restarted), while the new binary lands at the same path for the
# next restart to pick up. A plain `cp` over the running file fails
# with "Text file busy".
if [ -f "$INSTALL" ]; then
  ARCHIVE="$INSTALL.prev-$(date +%s)"
  mv "$INSTALL" "$ARCHIVE"
  echo "archived previous binary to $ARCHIVE"
fi
cp "$BUILT" "$INSTALL"
chmod +x "$INSTALL"

echo ""
echo "=== installed ==="
"$INSTALL" --version
echo "path: $INSTALL"
echo ""
echo "Restart the serve unit yourself when you're ready to pick this up:"
echo "  systemctl --user restart opencode-serve-tailscale.service"
echo ""
echo "Do NOT restart opencode-serve-lan.service from this workflow."
