# build.sh: never install a v1 binary without the retry-header cap

## Identity

- Workday: 2026-11-17
- Session: [`ses_e1d8f706fffePfigPdqMDaPxVT`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e1d8f706fffePfigPdqMDaPxVT), for coordinator [`ses_ef8235798ffejGr4sa22eXmVNv`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_ef8235798ffejGr4sa22eXmVNv)
- Agent/platform: opencode Sisyphus, `anthropic/claude-opus-5-5` / linux (desktop)
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch: `fix/build-retry-cap-gate`
- Source result commit: `build: apply the retry-header cap to a tree without it, refuse a binary without it`

## Regression

The retry-header cap (opencode-tools `docs/opencode-patches/retry-header-delay-cap.patch`) is kept applied but uncommitted in the primary checkout's `packages/opencode/src/session/retry.ts`, because it is reversed for every upstream merge. The vt-517 and vt-521 builds of 2026-11-16/17 were made with `OPENCODE_SRC=<clean worktree>` and so lost it: `grep -c -a OPENCODE_RETRY_MAX_HEADER_DELAY_MS` counted 0 in the installed vt-521 on desktop and m4max and in the archived vt-517, against 1 in vt-518, vt-514, vt-504 and vt-501. Every tab started on those builds waits out a provider's `retry-after` literally (8 h observed).

## Change

- `.vibeterm/build.sh` (v1): a source whose `retry.ts` lacks `OPENCODE_RETRY_MAX_HEADER_DELAY_MS` gets the canonical patch (`OPENCODE_RETRY_CAP_PATCH`, else the opencode-tools checkout found the way the guard is) applied for the build and reversed on exit; a missing or non-applying patch builds nothing. A built binary without the marker is not installed. `OPENCODE_ALLOW_MISSING_RETRY_CAP=1` skips both, with a warning.
- `.vibeterm/build.test.sh`: one case for all of it; it fails against the previous build.sh (which installed a capless binary).

## Validation

- `bash .vibeterm/build.test.sh`: BUILD SCRIPT TESTS PASSED; with the previous build.sh: `FAIL: expected exit 1, got 0`.
- desktop: built from a clean worktree at `771279cf22`, "Applied the retry-header cap for this build", v2 guard gate PASSED, installed `1.19.5-vt-522-006d837c50`, marker count 1, the worktree's `retry.ts` reverted afterwards, `smoke.sh` SMOKE OK.
