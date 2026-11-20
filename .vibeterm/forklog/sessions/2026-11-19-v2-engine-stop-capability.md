# W28 advertises native v2 engine stop

## Identity

- Workday: 2026-11-19 (America/Chicago).
- Session: [`ses_e3832b1b0ffe6q98OeUzhgqhjQ`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ).
- Repository: `Nowaker/opencode`, source on `v2-nowaker` via `engine-stop-capability`; companion `Nowaker/opencode-tools`, source on `master` via `probe-engine-stop`.
- Upstream base: `v2.2.7` (`fedc6f208a`); v2 fork base before W28: `fbf2fbe0fd`.

## Request and outcome

The [v2 coordinator](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC) assigned the missing `/api/info` capability after W15's E1-14 real-engine restart row refused with `native engine stop unsupported; closure is not authorized`. W24 (`2f2c119414`) defined the optional engine stop capability and wired the seal and routes, but the info handler did not advertise it. W28 adds `engineStop: true` to that handler; both the native and embedded route sets require the seal service. The protocol schema and generated clients are unchanged.

| Repository | Branch | Before | After | Outcome |
|---|---|---|---|---|
| `Nowaker/opencode` | `v2-nowaker` | `fbf2fbe0fd` | `f16dced8fc` | Fast-forwarded and verified on both mirrors |
| `Nowaker/opencode-tools` | `master` | `c00ccfd7205` | `bf0f8b35b44` | Fast-forwarded and verified on GitLab |

Feature: [native v2 engine stop](../features/2026-11-18-v2-engine-stop.md). The companion probe reads authenticated `/api/info`; when support is advertised, it reads the stop state and requires `open` with zero claims. It never prepares a stop. The general probe allows older engines to skip; the vt-52 packet requires the row to pass.

## Verification

- `bun test test/engine-stop.test.ts` from `packages/server`: unfixed handler returned `undefined` for the new assertion (5 pass, 1 fail); fixed handler passed 6/6. Both ran under `w1-check.lock` and the desktop resource gates.
- Source packet `f3687555` passed 6/6 rows: server typecheck, 20 server tests, 64 core engine-stop tests, and exact before/after source hashes. The GitHub push hook passed 34/34 workspace tasks. The server suite emitted `MaxListenersExceededWarning` in the existing OAuth fallback tests; those tests passed.
- `bun run typecheck` in opencode-tools: zero errors across four projects. `bun test _lib/opencode-v2-probe/`: 101 passed, including eight engine-stop fixture cases; zero failures.

## Build and install

- Desktop packet `8d37d61fb08aed2e67038d28b760b2afb674a2dbc41e6f2812b9927688d681f5` pinned the source and probe commits, all 790 build assets and three source blobs. Synthetic execution through the canonical gate refused an `engine-stop` skip or failure before reaching the swap; the positive control reached it. The installed-path probe separately passed the authenticated fixture and refused skip/fail fixtures.
- The v2 coordinator granted one desktop attempt for that digest. The pinned waiter started `w1-w28-desktop-admission.service` (invocation `a04fe66ea8864779b6fc19218d45d107`) and the build reached the final gate in `vibeterm-jobs.slice`: load 11.92, MemAvailable 83,749,572 KiB, memory PSI full avg60 0.05, slice I/O PSI some avg10 0.00.
- The candidate passed 13/0/0, including the named `engine-stop` row. A separate scratch engine launched from installed `opencode2` reported authenticated `/api/info` `capabilities.engineStop: true`; `GET /api/experimental/server/stop` returned `open` with zero claims. No stop was prepared.
- Installed `opencode2` reported `opencode v2.2.7-vt-52-5f76acb125`; device:inode `64512:49985807`, 240,843,888 bytes, SHA-256 `73ee338364580a6c2cb5c2dd98093f13b2a290d2751974dd97916f8242deda6e`, equal to the probed candidate. Rollback archive `opencode2.prev-1795142663` retained vt-51 device:inode `64512:49951211` and SHA-256 `f68bf3471541c2257ef1f77397398bc544b3cfb8511a7eda7f936964cef94634`. Both identities were checked again on disk after exit.
- `W28_EXIT stage=verified-install status=0`; admission exit 0 at 2026-11-20T02:44:29Z. Protected v1 and system/user service identities were unchanged, both units settled and the shared lock was free. The raw receipt and slot release were sent to the coordinator and W15. Evidence: `.vibeterm/tmp/opencode/w28-build/w28-desktop-admission.log` and `attempt/evidence.hjczQy/` under that same packet directory.
- No tab or service restarts, Stage 2 activation, E1-15, or Mac work is authorized by the packet. The coordinator independently verifies the executable before W15 can run E1-15.

## Commit provenance

- Source commits `f16dced8fc` and `bf0f8b35b44` were committed during this session's GPT continuation. Their `AI-Harness` trailer records `c00ccfd7205` in error; the session's supplied harness was `Vibeterm bf0f8b35b44`. Published history is unchanged.
