# Bounded native startup waiting and installed wordmark delivery

## Identity

- Workday: 2026-11-14, including the evening's work after midnight UTC.
- Session: [W1 `ses_e3832b1b0ffe6q98OeUzhgqhjQ`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ); agent/platform: Hephaestus, `openai/gpt-6.1-sol`, xhigh / Linux.
- Repository: `/home/nowaker/projekty/webapps/opencode`; source integration: `v2-nowaker`; forklog integration: `dev-nowaker`; development branches: `startup-wait`, `startup-wait-wordmark`; provenance branch: `w1-startup-record`.
- Upstream release base: `fedc6f208aa2bd54c1019227214568083f6380ad` (`v2.2.7`). The build stamp's `5f76acb125` is not the source result SHA.
- Source result: `0671d0161e7048e6847f5189357e5782f31a91eb` and `5321c3bb37f0e0af9b402a518454e3d8ba1bcdbd`, above W4's `25d9d35bb04beda2eeaff73c2eb262fb60d0e8b7` wordmark correction. Forklog commit: this file's introducing commit.

## User requests and delegated scope

The original human wording is TBD in this record. The retained [W15 contract request](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e2845e4cbffeAqWDJyjuBaYnox) (`msg_1d94245fb001jfKkhoZj9Hyc2z`) states:

> Startup waiting is for the exact requested owner/session, not a fallback engine or service discovery.

The [v2 coordinator](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC) revived W1 at 2026-11-14T22:32:05.639Z (`msg_1dc30e07a0011nlAmXOLBWm6Tr`) after the operator cut, requiring checkpoint publication, rebase onto W4, the same retained Oracle, both gated host installs, and preservation of the paused tool-search checkpoint. Its later build grant superseded the initial host order:

> SLOT 1 is m4max, granted now.

> SLOT 2 is desktop, granted after m4max is installed and verified.

## Goals and constraints

- Keep the native early editor live until the exact explicit server and reserved Session are ready; preserve Unicode text, UTF-16 caret, backward selection, paste, unread bytes and retained Enter through one native adoption.
- Bound readiness with one deadline and keep omission compatible. Recover an opt-in failed startup on its owned terminal without adding cross-process draft persistence or a second prompt sender.
- Include W4's published wordmark fix in the same build. At most two children and one focused test process; one build per host, explicit slots, mandatory probe, no copied cross-host binaries or dist.
- Preserve v1 executable identity, protected service PID/start snapshots, live sessions/databases/configuration, primary checkout's dirty retry-cap files and `.gitignore`. No protected serve-unit restart or default Vibeterm/Meridian restart.

## Branch and upstream movement

| Branch or repository | Before | After | Action |
|---|---|---|---|
| `startup-wait` | `c9ab8c9f1b` plus 11 saved paths | `2a71c564a347edcbf71ba9ed5c7d221991f9ba02` | Commit and publish the unchanged interrupted checkpoint to both feature mirrors |
| Combined startup source | W4 `25d9d35bb04b` | `0671d0161e` then `5321c3bb37` | Rebase, correct lossless recovery and publish the new `startup-wait-wordmark` ref; no forced update of the old feature ref |
| `v2-nowaker`, both mirrors | `25d9d35bb04b` | `5321c3bb37f0e0af9b402a518454e3d8ba1bcdbd` | Immediate fast-forward integration and normal publication; live refs independently matched |
| `native-tool-search`, both feature mirrors | 24 interrupted paths | `3e45f2b6e152e5654463b5a601ce52286c8e2075` | Preserve the unchanged checkpoint only; no integration, capability activation or installation |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Early native input](../features/2026-11-11-v2-early-input.md) | Exact-owner startup waiting, lossless failure recovery and the installed wordmark correction | Source, PTY, help and both-host receipts below |
| [Native plugin controls](../features/2026-11-10-v2-plugin-controls.md) | Re-verify ordered prompt parts, scoped browser attachment and native default variants in the retained vt-36 controller demo | Four isolated engine runs below; earlier both-host c9 evidence remains separately attributed |

## Native contract and source review

- Invocation: `opencode2 --server URL --server-wait MILLISECONDS --session SESSION_ID`. The integer is bounded to `1..2147483647`, requires explicit `--server`, and has no environment alias. Detect it through the literal installed `NO_COLOR=1 opencode2 --help` flag row; no new server capability or guessed version test is introduced.
- `packages/cli/src/services/server-wait.ts` uses the generated typed Effect client with redirects disabled. One scoped deadline spans `/api/info`, the exact selected-Session GET, requests and retry sleeps. Typed target-Session 404, selected connection errors and 502/503/504 retry; authentication and protocol refusals stop. Omission keeps the existing single info attempt and five-second abort deadline.
- `packages/tui/src/startup/index.ts` retains both `Transfer.snapshot` and `Transfer.bytes`. After restoring the terminal, it writes recovery to the owned stdout descriptor. An unfinished paste, UTF-8 character or control sequence remains lossless base64 rather than being silently dropped or executed as shell control bytes. Redirected stderr contains the error, not the draft.
- The same retained [Oracle](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e27290fd0ffe6QgTeVa7x9Z1Dd) found two required P2s: raw input remainder loss and use of unchecked stderr. Round two actually reread clean `5321` and the real PTY fixtures, closed both, and returned no required findings (`msg_1dc95dc92001Lx4P5sCjMTp9YG`, read receipt `tool_1dc9aeddd001uuYW5CTdlFI03s`). The generic background wrapper's historical `Aborted` result was stale, not a substitute for this stored review.

## Verification

- Focused CLI: 24 pass, 84 assertions (`tool_1dc555642001BVyiK6dt6WMYVe`); unchanged CLI files retain that evidence under `5321`. Existing TUI startup cases: 58 pass, 103 assertions (`tool_1dc86cc13001xLtV50N8Kq2Chy`), including W4's 44/100-column regressions.
- New real-owner `test/startup/recovery.test.ts` and `test/fixture/startup-recovery.ts`: all four cases fail before the correction and pass afterward, 16 assertions. Cases cover unfinished paste, split UTF-8, unfinished CSI and redirected stderr (`tool_1dc83f4c1001Ix4EK6v04SuZDr`, `tool_1dc855ea6001iuUtR3rLUnVZFz`).
- TUI types pass 1,972 files in two projects. All three correction-file diagnostics, focused lint/formatting and test-junk checks pass. Normal feature publication passes 34/34 workspace checks on both pushes. No public Protocol/HttpApi schema changed, so no client regeneration was required.
- One erroneous systemd test launch omitted WorkingDirectory and searched HOME; it was stopped after 9m25s, peak 19.2 GiB. It supplies no test evidence. Valid serialized runs use the exact package working directory and private HOME/XDG/config/database/tool/plugin roots.

## Build and install

Both hosts fetched the published clean `5321` source and independently ran their canonical `opencode-build/build.sh --v2` path with the mandatory `VIBETERM_V2_PROBE` gate. Neither a native binary nor dist was copied between hosts. Both slots were released when their builds ended.

| Host | Installed artifact | Native gate and preservation |
|---|---|---|
| m4max | `opencode v2.2.7-vt-36-5f76acb125`; inode `80600116`, 231819042 bytes; SHA-256 `764631f5365c4d4fcf339c2887d97ab82c81a310e60d369e4aff89f1e2f13941` | 12 pass, zero fail/skip; `tool_1dcb01d7d001j3xT0xszSpQuB5`; v1 SHA/inode `78838345` and 19 baseline v1 PID/start identities unchanged |
| desktop | Same version; inode `49950914`, 240520304 bytes; SHA-256 `848ab8df57bf5e989c050ef6b93803e1d0209987168c336ead73866a9e29b560` | 12 pass, zero fail/skip; `tool_1dcd671770016gBOyELLjhsWt7`; v1 SHA/inode `49951092` and protected service PID/start snapshots unchanged |

- Native probe reports: m4max `/Users/nowaker/.local/share/opencode/nowaker-opencode-tools/tmp/opencode-v2-probe/run-pVjuNZ/report.json`; desktop `/home/nowaker/.local/share/opencode/nowaker-opencode-tools/tmp/opencode-v2-probe/run-6GeL1k/report.json`.
- Mac preflight load was 8.03/7.76/9.01 with 75% free memory. Its build took 1m22s; its owned load monitor was stopped and exited zero. Unrelated stale PID `85583` was left alone.
- Desktop's fresh gate passed: MemAvailable 71.5777 GiB, memory PSI full avg60 1.59, load1/load5 36.98/46.91; the wrapper repeated the gate immediately before compilation. Build took 8m57s, peak 4.3 GiB; no waiting loop or duplicate build.

## Installed acceptance and demonstration

- [QA child](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e23490c9cffebdQW6LV3qFnR3Q) final `msg_1dcef2282001JUpopgL6yy3jjN`: desktop 14/14, all 13 PTYs restore exact Linux stty and the normal screen, binary identity unchanged. Parent independently read actual results and the corrected ownership/boundary code; visual inspection stays with the child. Receipt: `.vibeterm/tmp/opencode/w1-startup-acceptance/desktop-receipt.json`; raw results: `desktop-runs/run-aBWMIY/results.json` under that same parent.
- Late engine and reserved Session cases preserve `/owner` and the requested ID, make only GETs before the Session exists, then produce exactly one successful prompt POST, one stored user and one real local provider dispatch. Parsed stored/provider text matches exactly, including combining marks, emoji, backward selection and paste; the exact stored assistant reply renders in the TUI.
- Timeout/auth/Ctrl+C/SIGHUP exit 1/1/130/143 with exact editor snapshot after restoration. All three unfinished-input remainders decode to precisely the sent bytes. Omission preserves both the one-request failure and the ready-owner path. `/api/info` reports vt-36 and 17 capabilities, all true; `toolDeferral` remains absent.
- The original Mac receipt and 13 non-help cases remain unchanged in `.vibeterm/tmp/opencode/w1-startup-acceptance/receipt.json` and `mac-run-QOhUCV/results.json`. A narrow new Mac help-only control closes the old synchronous counter gap: the async child leaves the listener live, receives zero requests, and creates only the named CLI log/native library. Desktop has the same zero-contact result and exact help hash `cf62172f22f5b8c3600afe35713c695d7d73afc38b1645c6e05545d9e008c085`; control copy: `mac-help-control/results.json`.
- The frozen prototype's Linux stty parser could accept a changed ICANON bit. The new private `linux-harness/stty.ts` requires exact non-Darwin equality and narrowly permits only the kernel PENDIN bit in valid Darwin gfmt1 states. Its real-PTY self-check rejects `-icanon`; parsed exact-text checks reject prefix/trailing-space false positives. The 11 TypeScript owners are at most 154 nonblank lines; Bun checking passes 1,470 files. The optional no-excuse audit could not run because its caller project lacked `typescript`; no install was authorized. Product checks above passed.
- Actual 44/100-column desktop wordmark frames are byte-identical to the Mac captures. Child xterm replay shows unchanged centering, two dim shadow cells and zero-pixel logo-crop difference from W4's reviewed source frame. The coordinator accepted startup PASS and closed vt-33's interim wordmark limitation at 2026-11-15T02:33:40.721Z.
- The retained [c9 controller demonstration](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37fc6aa2ffeItmFQYimsW3v7l) reran on desktop vt-36 using the unchanged W1 drivers. Parent read all four `result.json` files beneath `/home/nowaker/projekty/tmp/vibeterm/opencode-omo-demos/tmp/c9-vt36/`: info `info-sLSYUQ` reports 17/17 capabilities; default `w1-default-9kysjo` passes six native default cases plus six unknown-variant refusals with zero child dispatches per refusal; browser `w1-browser-ADrj02` passes four external/catalog/attachment grant-revoke controls; `prompt-parts-installed-tF9vBS` preserves ordered same-message parts and excludes ignored parts from all seven provider requests. Built-in browser executor and actual Chrome remain unverified by this demo. The coordinator reports all four engines exited zero.

## Other delivered work and cleanup

- Tools master contains [deterministic replacement fixture `b9fb3f3d35d2`](https://gitlab.com/Nowaker/opencode-tools/-/commit/b9fb3f3d35d274500c394a2a4bd34dcdf6949916) and [safe numeric-signal formatter `bc7c10984328`](https://gitlab.com/Nowaker/opencode-tools/-/commit/bc7c10984328a7c443ddd50ec31a52f280220800). Atomic replacement is test setup only; production path trust and rejection assertions are unchanged. Final landed suites: 57 pass, four Darwin-only skips, 177 assertions; actual imported installed-proof typing reports zero errors. Receipts: `tool_1dced7fe9001Md8DSyImFC748T`, `tool_1dcf1d651001ihWEZEzWip5RUW`. No real email was sent.
- The mail completion record `a05fff17a40` was preserved on `w1-mail-record` after an immediate normal primary push lost a concurrent remote update. The coordinator assigned W19 to preserve both unpublished commits during reconciliation; its rebased record `1a78b82eeba` is published on tools master, with the coordinator independently confirming origin and m4max at tip `c27fd7c0f06`. No forced primary push or discarded peer work; the old published feature ref remains intact.
- QA reports all owned processes reaped: original Mac phase 16, corrected desktop phase 20, narrow Mac help control four. Short socket/temporary roots and newly used Chrome scratch were removed; final runtime boxes, captures, hashes and probe reports are retained as evidence. No owned build or QA unit remains running.
- Original deletion call `toolu_019zX6QrprvSXM5wUepH6rTB` was denied by the bash `rm -rf /*` rule. The coordinator explicitly accepted retaining these exact three directories; no alternate command, tool, host or path was used to retry: desktop `/home/nowaker/projekty/webapps/opencode/.vibeterm/tmp/opencode/w1-startup-acceptance/wordmark/.home` (136K); m4max `/Users/nowaker/projects/webapps/opencode/.vibeterm/tmp/opencode/w1-startup-acceptance/run-Dc1LL0` (2.9M); m4max `/Users/nowaker/projects/webapps/opencode/.vibeterm/tmp/opencode/w1-startup-acceptance/run-QOhUCV/boxes` (2.8M).

## Scope limits and historical evidence

- Failure recovery is an inspectable copy on the restored owned terminal, not persistence or automatic reconstruction after exit. A destroyed terminal, SIGKILL or worker crash cannot return that copy. No Windows packaging/terminal acceptance or performance-speedup claim is made.
- Source review is distinct from installed acceptance; both are closed for `5321`. The c9 controller's vt-36 results do not relabel the earlier per-host vt-33 proofs in the [November 13 delivery record](./2026-11-13-v2-plugin-controls.md).
- The tool-search checkpoint is published but unfinished and uninstalled at this record. The coordinator explicitly makes its resumed implementation the next item after this provenance delivery; new native builds require new slots.
- Required trailer: `AI-Session-ID:` [ses_e3832b1b0ffe6q98OeUzhgqhjQ](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ). Resolve this record's introducing commit through its path history; it cannot contain its own eventual hash.
