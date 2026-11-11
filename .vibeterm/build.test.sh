#!/usr/bin/env bash
set -euo pipefail

SCRIPT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/build.sh}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$HERE/tmp"
ROOT="$(mktemp -d "$HERE/tmp/build-test.XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT
export GIT_MASTER=1 GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME='Build test' GIT_AUTHOR_EMAIL=build-test@example.invalid
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
SOURCE="$ROOT/source"
MANAGED="$SOURCE/.vibeterm/worktrees/v2-nowaker"
INSTALL_ROOT="$ROOT/opencode-build/bin"
mkdir -p "$SOURCE/.vibeterm" "$SOURCE/packages/opencode" "$ROOT/bin" "$INSTALL_ROOT"
cp "$SCRIPT" "$SOURCE/.vibeterm/build.sh"
git init -q "$SOURCE"
TREE="$(git -C "$SOURCE" hash-object -t tree -w --stdin </dev/null)"
commit() { git -C "$SOURCE" commit-tree "$TREE" -m "$1" "${@:2}"; }
FIRST="$(commit first)"
UPSTREAM="$(commit upstream -p "$FIRST")"
RELEASE="$(commit release -p "$UPSTREAM")"
FORK="$(commit fork -p "$UPSTREAM")"
HEAD="$(commit second-fork -p "$FORK")"
UNRELATED="$(commit unrelated)"
FUTURE="$(commit future -p "$UNRELATED")"
git -C "$SOURCE" update-ref refs/heads/fork "$HEAD"
git -C "$SOURCE" symbolic-ref HEAD refs/heads/fork
git -C "$SOURCE" update-ref refs/heads/dev "$UPSTREAM"
git -C "$SOURCE" update-ref refs/heads/v1 "$UPSTREAM"
git -C "$SOURCE" remote add github "$SOURCE"
git -C "$SOURCE" update-ref refs/tags/v2.2.6 "$FIRST"
git -C "$SOURCE" update-ref refs/tags/v2.2.7 "$RELEASE"
git -C "$SOURCE" update-ref refs/tags/v2.99.0 "$FUTURE"
git -C "$SOURCE" update-ref refs/tags/v2.100.0-rc "$RELEASE"
git -C "$SOURCE" update-ref refs/tags/v9.99.0 "$RELEASE"
git -C "$SOURCE" update-ref refs/tags/v1.99.0 "$HEAD"
git -C "$SOURCE" worktree add --quiet --detach "$MANAGED" "$HEAD"
mkdir -p "$MANAGED/packages/cli"
printf 'original lock\n' > "$MANAGED/bun.lock"
printf 'v1 sentinel\n' > "$INSTALL_ROOT/opencode"
inode() { node -e 'process.stdout.write(String(require("node:fs").statSync(process.argv[1]).ino))' "$1"; }
digest() { node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.argv[1])).digest("hex"))' "$1"; }
V1_INODE="$(inode "$INSTALL_ROOT/opencode")"

cat > "$ROOT/bin/bun" <<'BUN'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$PWD" == */packages/opencode ]]; then
  mkdir -p dist/opencode-native/bin
  printf '#!/usr/bin/env bash\nprintf "fixture-v1\\n"\n' > dist/opencode-native/bin/opencode
  exit 0
fi
case "$HOME" in */.vibeterm/tmp/build-v2.*/home) ;; *) exit 40 ;; esac
ROOT="${HOME%/home}"
for key in XDG_DATA_HOME XDG_CONFIG_HOME XDG_CACHE_HOME XDG_STATE_HOME \
  OPENCODE_DB OPENCODE_CONFIG_DIR OPENCODE_TOOLS_DATA_DIR OPENCODE_PLUGINS_DATA_DIR TMPDIR; do
  case "${!key}" in "$ROOT"/*) ;; *) exit 41 ;; esac
done
[ -z "${BUILD_TEST_LIVE_SENTINEL-}${OPENCODE_CONFIG-}${OPENCODE_CONFIG_CONTENT-}${OPENCODE_TEST_HOME-}" ]
[ "$OPENCODE_CONFIG_PROJECT_DISABLE" = 1 ]
if [ "$1" = install ]; then
  [ "$2" = --frozen-lockfile ]
  exit 0
fi
[ "$*" = './script/build.ts --single' ]
printf 'build changed lock\n' > ../../bun.lock
[ ! -f ../../fail-build ] || exit 42
mkdir -p dist/cli-native/bin
cat > dist/cli-native/bin/opencode <<'BIN'
#!/usr/bin/env bash
set -euo pipefail
case "$HOME" in */.vibeterm/tmp/build-v2.*/home) ;; *) exit 43 ;; esac
ROOT="${HOME%/home}"
for key in XDG_DATA_HOME XDG_CONFIG_HOME XDG_CACHE_HOME XDG_STATE_HOME \
  OPENCODE_DB OPENCODE_CONFIG_DIR OPENCODE_TOOLS_DATA_DIR OPENCODE_PLUGINS_DATA_DIR TMPDIR; do
  case "${!key}" in "$ROOT"/*) ;; *) exit 44 ;; esac
done
[ -z "${BUILD_TEST_LIVE_SENTINEL-}${OPENCODE_CONFIG-}${OPENCODE_CONFIG_CONTENT-}${OPENCODE_TEST_HOME-}" ]
[ "$OPENCODE_CONFIG_PROJECT_DISABLE" = 1 ]
[ "$1" = --version ]
printf 'fixture-v2\n'
BIN
chmod +x dist/cli-native/bin/opencode
dist/cli-native/bin/opencode --version
BUN
chmod +x "$ROOT/bin/bun"
printf '#!/usr/bin/env bash\nexit 23\n' > "$ROOT/bin/guard"
chmod +x "$ROOT/bin/guard"
cat > "$ROOT/bin/probe" <<'PROBE'
#!/usr/bin/env bash
set -euo pipefail
[ "$#" = 3 ]
[ "$1" = --binary ]
[ "$2" = "$BUILD_TEST_EXPECTED_BINARY" ]
[ -x "$2" ]
[ "$3" = --text ]
[ ! -f "$BUILD_TEST_PROBE_FAILURE" ] || exit 17
PROBE
chmod +x "$ROOT/bin/probe"
PROBE_OVERRIDE="$ROOT/bin/probe"
SRC_OVERRIDE=""
INSTALL_OVERRIDE=""
VERSION_OVERRIDE=""
run() {
  STATUS=0
  OUT="$(cd "$HERE" && env -i PATH="$ROOT/bin:$PATH" HOME="$ROOT/live-home" \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null \
    OPENCODE_SRC="$SRC_OVERRIDE" OPENCODE_INSTALL="$INSTALL_OVERRIDE" \
    OPENCODE_VERSION="$VERSION_OVERRIDE" VIBETERM_V2_GUARD="$ROOT/bin/guard" \
    VIBETERM_V2_PROBE="$PROBE_OVERRIDE" BUILD_TEST_PROBE_FAILURE="$ROOT/fail-probe" \
    BUILD_TEST_EXPECTED_BINARY="${SRC_OVERRIDE:-$MANAGED}/packages/cli/dist/cli-native/bin/opencode" \
    XDG_DATA_HOME="$ROOT/live-data" XDG_CONFIG_HOME="$ROOT/live-config" \
    XDG_CACHE_HOME="$ROOT/live-cache" XDG_STATE_HOME="$ROOT/live-state" \
    OPENCODE_DB="$ROOT/live.db" OPENCODE_CONFIG_DIR="$ROOT/live-config" \
    OPENCODE_TOOLS_DATA_DIR="$ROOT/live-tools" OPENCODE_PLUGINS_DATA_DIR="$ROOT/live-plugins" \
    OPENCODE_CONFIG="$ROOT/live.json" OPENCODE_CONFIG_CONTENT='{"plugin":["live-plugin"]}' \
    OPENCODE_TEST_HOME="$ROOT/live-home" BUILD_TEST_LIVE_SENTINEL=live \
    bash "$SOURCE/.vibeterm/build.sh" "$@" 2>"$ROOT/error")" || STATUS=$?
}
status() {
  if [ "$STATUS" != "$1" ]; then
    printf 'FAIL: expected exit %s, got %s\n%s\n%s\n' "$1" "$STATUS" "$OUT" "$(<"$ROOT/error")" >&2
    exit 1
  fi
}
equal() { [ "$1" = "$2" ] || { printf 'FAIL: %s != %s\n' "$1" "$2" >&2; exit 1; }; }

for args in '--v2 --print-version' '--print-version --v2'; do
  read -r -a argv <<< "$args"
  run "${argv[@]}"
  status 0
  equal "$OUT" "2.2.7-vt-2-${UPSTREAM:0:10}"
done
printf 'PASS: v2 selects reachable v2 release and github/dev fork count in either option order\n'

for args in '--v2 --v2' '--print-version --print-version' '--bogus' '--v2 extra' \
  '--help extra' '--v2 --help' '--print-version --v2 extra'; do
  read -r -a argv <<< "$args"
  run "${argv[@]}"
  status 2
done
run ''
status 2
run --help
status 0
[[ "$OUT" == *'Usage: build.sh [--v2] [--print-version]'* ]]
printf 'PASS: parser rejects duplicates, unknown flags, extras and empty arguments\n'

git -C "$MANAGED" update-ref HEAD "$RELEASE"
SRC_OVERRIDE="$MANAGED"
run --v2 --print-version
status 0
equal "$OUT" "2.2.7-vt-1-${UPSTREAM:0:10}"
git -C "$MANAGED" update-ref HEAD "$HEAD"
VERSION_OVERRIDE=2.2.7-vt-test
run --v2 --print-version
status 0
equal "$OUT" "$VERSION_OVERRIDE"
VERSION_OVERRIDE=""
SRC_OVERRIDE=""
run --print-version
status 0
equal "$OUT" 1.99.0
git -C "$SOURCE" update-ref -d refs/tags/v1.99.0
run --print-version
status 0
equal "$OUT" "9.99.0-vt-2-${UPSTREAM:0:10}"
git -C "$SOURCE" update-ref refs/tags/v1.99.0 "$HEAD"
printf 'PASS: exact v2 releases keep the fork stamp; explicit and v1 exact-tag/fork versions retain precedence\n'

ln -s "$INSTALL_ROOT/opencode" "$ROOT/symlink"
ln "$INSTALL_ROOT/opencode" "$ROOT/hardlink"
ln -s "$INSTALL_ROOT" "$ROOT/alias-dir"
for INSTALL_OVERRIDE in "$INSTALL_ROOT/opencode" "$ROOT/symlink" "$ROOT/hardlink" \
  "$ROOT/alias-dir/opencode" "$INSTALL_ROOT/../bin/opencode"; do
  run --v2 --print-version
  status 1
  [[ "$(<"$ROOT/error")" == *'aliases the v1 binary'* ]]
done
INSTALL_OVERRIDE=""
mkdir -p "$ROOT/other-source/packages/cli"
git init -q "$ROOT/other-source"
SRC_OVERRIDE="$ROOT/other-source"
VERSION_OVERRIDE=2.2.7-vt-test
INSTALL_OVERRIDE="$INSTALL_ROOT/opencode"
run --v2 --print-version
status 1
[[ "$(<"$ROOT/error")" == *'aliases the v1 binary'* ]]
INSTALL_OVERRIDE=""
run --v2
status 0
[[ "$OUT" == *"path: $INSTALL_ROOT/opencode2"* ]]
SRC_OVERRIDE=""
VERSION_OVERRIDE=""
run --v2
status 0
[[ "$OUT" == *"path: $INSTALL_ROOT/opencode2"* ]]
[[ "$OUT" == *fixture-v2* ]]
equal "$(inode "$INSTALL_ROOT/opencode")" "$V1_INODE"
equal "$(<"$INSTALL_ROOT/opencode")" 'v1 sentinel'
equal "$(<"$MANAGED/bun.lock")" 'original lock'
PREVIOUS_INODE="$(inode "$INSTALL_ROOT/opencode2")"
run --v2
status 0
[ "$(inode "$INSTALL_ROOT/opencode2")" != "$PREVIOUS_INODE" ]
printf 'PASS: default v2 install uses isolated build/probes, restores lockfile and swaps only opencode2 inode\n'

PREVIOUS_INODE="$(inode "$INSTALL_ROOT/opencode2")"
PREVIOUS_DIGEST="$(digest "$INSTALL_ROOT/opencode2")"
touch "$ROOT/fail-probe"
run --v2
status 1
[[ "$(<"$ROOT/error")" == *'v2 runtime probes failed'* ]]
equal "$(inode "$INSTALL_ROOT/opencode2")" "$PREVIOUS_INODE"
equal "$(digest "$INSTALL_ROOT/opencode2")" "$PREVIOUS_DIGEST"
rm "$ROOT/fail-probe"
PROBE_OVERRIDE="$ROOT/bin/missing-probe"
run --v2
status 1
[[ "$(<"$ROOT/error")" == *'vibeterm-v2-probe not found'* ]]
equal "$(inode "$INSTALL_ROOT/opencode2")" "$PREVIOUS_INODE"
equal "$(digest "$INSTALL_ROOT/opencode2")" "$PREVIOUS_DIGEST"
PROBE_OVERRIDE="$ROOT/bin/probe"
printf 'PASS: failed or missing v2 runtime probe preserves the installed binary bytes and inode\n'

SRC_OVERRIDE="$MANAGED"
INSTALL_OVERRIDE="tmp/${ROOT##*/}/custom-opencode2"
run --v2
status 0
[ -x "$ROOT/custom-opencode2" ]
INSTALL_OVERRIDE="$ROOT/failed-opencode2"
touch "$MANAGED/fail-build"
run --v2
status 42
[ ! -e "$INSTALL_OVERRIDE" ]
equal "$(<"$MANAGED/bun.lock")" 'original lock'
rm "$MANAGED/fail-build"
printf 'PASS: explicit source/install overrides work; failed build restores lockfile and installs nothing\n'

SRC_OVERRIDE=""
INSTALL_OVERRIDE=""
run
status 1
[[ "$(<"$ROOT/error")" == *'v1 database guard does not hold'* ]]
equal "$(inode "$INSTALL_ROOT/opencode")" "$V1_INODE"
equal "$(<"$INSTALL_ROOT/opencode")" 'v1 sentinel'
printf '#!/usr/bin/env bash\nexit 0\n' > "$ROOT/bin/guard"
run
status 0
[[ "$OUT" == *"path: $INSTALL_ROOT/opencode"* ]]
[[ "$OUT" == *fixture-v1* ]]
printf 'PASS: v1 guard failure blocks install; passing guard keeps the v1 default install path\n'
printf 'BUILD SCRIPT TESTS PASSED\n'
