#!/usr/bin/env bash
# Isolated smoke of an installed opencode binary: serve, session create,
# background-style fork (caller-chosen id + unsettled=settle), reader-only
# notice, and `opencode session list`. Scratch HOME/XDG, loopback only,
# no LLM call (noReply), cleans up its own server and scratch dir.
set -euo pipefail
BIN="$1"
S="$(env -u TMPDIR mktemp -d /tmp/oc-smoke.XXXXXX)"
mkdir -p "$S/home" "$S/work"
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$S"
}
trap cleanup EXIT
CFG='{"$schema":"https://opencode.ai/config.json","autoupdate":false,"share":"disabled","model":"mock/m","provider":{"mock":{"npm":"@ai-sdk/openai-compatible","name":"Mock","options":{"baseURL":"http://127.0.0.1:9/v1","apiKey":"x"},"models":{"m":{"name":"m"}}}}}'
ENVV=(PATH="$PATH" HOME="$S/home" XDG_CONFIG_HOME="$S/home/.config" XDG_DATA_HOME="$S/home/.local/share"
  XDG_STATE_HOME="$S/home/.local/state" XDG_CACHE_HOME="$S/home/.cache" TERM=dumb
  OPENCODE_CONFIG_CONTENT="$CFG" OPENCODE_DISABLE_MODELS_FETCH=1)
run() { env -i "${ENVV[@]}" "$@"; }
echo "version: $(run "$BIN" --version)"
cd "$S/work"
# An explicit free port: `--port 0` makes opencode try 4096 first, the port every
# portless opencode tells its plugins a server is on.
PORT="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
# `exec ... &`, not `run ... &`: a backgrounded function is a subshell, so `$!`
# would be that subshell and the cleanup's kill would orphan the server. That is
# how this script left an opencode serve on m4max's 127.0.0.1:4096 for four days.
exec env -i "${ENVV[@]}" "$BIN" serve --hostname 127.0.0.1 --port "$PORT" > "$S/serve.log" 2>&1 &
SERVER_PID=$!
URL=""
for _ in $(seq 1 150); do
  URL="$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$S/serve.log" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 0.2
done
[ -n "$URL" ] || { echo "server did not start"; cat "$S/serve.log"; exit 1; }
echo "serve: up at loopback port ${URL##*:} (pid $SERVER_PID)"
Q="directory=$(printf %s "$S/work" | jq -sRr @uri)"
SRC="$(curl -fsS -X POST "$URL/session?$Q" -H 'content-type: application/json' -d '{"title":"smoke source"}' | jq -r .id)"
echo "created: $SRC"
curl -fsS -X POST "$URL/session/$SRC/message?$Q" -H 'content-type: application/json' \
  -d '{"noReply":true,"parts":[{"type":"text","text":"hello from the smoke test"}]}' > /dev/null
FORK_ID="ses_1997ffffffffSmokeForkBg01"
FORK="$(curl -fsS -X POST "$URL/session/$SRC/fork?$Q" -H 'content-type: application/json' \
  -d "{\"id\":\"$FORK_ID\",\"unsettled\":\"settle\"}")"
echo "fork: id=$(jq -r .id <<<"$FORK") parent=$(jq -r .parentID <<<"$FORK")"
[ "$(jq -r .id <<<"$FORK")" = "$FORK_ID" ] || { echo "fork did not take the caller id"; exit 1; }
SRC_N="$(curl -fsS "$URL/session/$SRC/message?$Q" | jq length)"
FORK_N="$(curl -fsS "$URL/session/$FORK_ID/message?$Q" | jq length)"
echo "messages: source=$SRC_N fork=$FORK_N"
[ "$FORK_N" = "$SRC_N" ] && [ "$FORK_N" -ge 1 ] || { echo "fork copied the wrong history"; exit 1; }
curl -fsS -X POST "$URL/session/$SRC/message?$Q" -H 'content-type: application/json' \
  -d "{\"noReply\":true,\"parts\":[{\"type\":\"text\",\"text\":\"Forked this session into $FORK_ID\",\"ignored\":true}]}" > /dev/null
echo "notice: source now has $(curl -fsS "$URL/session/$SRC/message?$Q" | jq length) messages"
kill "$SERVER_PID"; wait "$SERVER_PID" 2>/dev/null || true; SERVER_PID=""
LIST="$(run "$BIN" session list --format json 2>&1)"
echo "session list: $(jq -r '[.[] | .id] | sort | join(" ")' <<<"$LIST")"
jq -e --arg a "$SRC" --arg b "$FORK_ID" '[.[].id] | index($a) and index($b)' <<<"$LIST" > /dev/null || { echo "list misses a session"; echo "$LIST"; exit 1; }
echo "SMOKE OK"
