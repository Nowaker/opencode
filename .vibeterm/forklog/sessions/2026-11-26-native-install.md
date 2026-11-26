# Desktop and m4max vt-58; m4max v1 vt-617

## Identity

- Workday: 2026-11-26 (America/Chicago). Delivery session: [`ses_e3832b1b0ffe6q98OeUzhgqhjQ`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ).
- Scope: the [Mac approval](https://portal.vibeterm.desktop.ts.nowaker.net/question/qst_1f475a977001fAkk2WkkAb5c0i) lifts the travel hold. The [v2 coordinator](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC) superseded the older build targets with m4max v1 vt-617 and v2 vt-58, desktop first. No source or runtime configuration was changed.

## Source and deployment

- m4max `dev-nowaker`: `1737d7ac79` fast-forwarded to `65c0184cb3`. The deliberate retry-header cap passed `git apply --reverse --check`; the three tracked dirty files and two untracked logs remained byte-identical after the pull and build.
- `v2-nowaker` on both hosts: `bbbaf4ecdd` (upstream merge base `5f76acb125`, count 58). Since vt-55 (`2c000ae41b`), `073974e79d` adds purpose/client/session attribution for eligible native Meridian requests, `d0c1935697` includes the bare `/messages` endpoint and `bbbaf4ecdd` adds the validated machine name as `x-meridian-device`. Existing OpenCode forklog searches found no hold; the [Meridian coordinator](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_fe8a27c6effe6KEx3TRNvOLgUo) reported that the receiver was deployed and cleared activation. No live Meridian request was sent as part of these install checks.
- Canonical builders: `.vibeterm/build.sh` for v1 and `.vibeterm/build.sh --v2` for v2. Desktop v2 finished its installed-path probe before the m4max v2 build started. No existing tab or serve process was restarted.

| Host / binary | Installed version | SHA-256 | Device:inode | Previous binary archive |
|---|---|---|---|---|
| m4max `opencode` | `1.19.5-vt-617-006d837c50` | `a1b67a81f897c536a83b042a186f1cea911f14f6634d4a37ea9c978703fae45f` | `16777234:175097437` | `opencode.prev-1795688482` |
| desktop `opencode2` | `v2.2.7-vt-58-5f76acb125` | `3412e75cc284b4521f542eb92c87a28f94cbe4f582bcd55f7fe0b2ac9ca2f093` | `64512:49941626` | `opencode2.prev-1795690597` |
| m4max `opencode2` | `v2.2.7-vt-58-5f76acb125` | `452f589fce021f99e1622fb6c99e8a1bf62107667491148a9b58b53fce731e8b` | `16777234:175781400` | `opencode2.prev-1795690997` |

## Verification

- m4max v1: canonical migration guard passed eight checks. The upstream v2 input was cached `@opencode/cli@2.3.2`; the guard refused to download `2.4.2` under the disk-reserve rule. The installed `.vibeterm/smoke.sh` check returned `SMOKE OK` after isolated session creation, fork, notice and listing.
- Both v2 builds: `vibeterm-v2-probe` passed 13/0/0 before the swap and again against the installed path on each host. The named checks include advertised engine stop and the TUI reload log. Both v1 binaries were unchanged during their host's v2 install. This is not a new end-to-end test of live Meridian attribution.
- Receipts: `.vibeterm/tmp/opencode/nov26-mac-v1.log`, `nov26-desktop-v2.log` and `nov26-mac-v2.log` in the same scratch directory.
- Separate documentation-only queue commit `4a19a524b2` records the approvals in [entry 13](../pr-queue/13-cold-submit.md) and [entry 14](../pr-queue/14-prompt-keyboard-selection.md). No upstream PR was filed.
