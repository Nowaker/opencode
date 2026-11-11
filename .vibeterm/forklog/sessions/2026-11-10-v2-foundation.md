# W1 guarded v2 base and opencode2 build

## Identity and scope

- Workday: 2026-11-10, continuing after midnight UTC.
- Session: [ses_e3832b1b0ffe6q98OeUzhgqhjQ](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ).
- Coordinator: [ses_e383ee7faffe6JX8m2EP26dXUC](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC).
- Agent/platform: Hephaestus, `openai/gpt-6.1-sol`, xhigh, Linux. Repository: `/home/nowaker/projekty/webapps/opencode`.
- Source integration: `v2-nowaker`, pinned upstream `v2.2.7` (`fedc6f208a`), deliberately not rebased. Installer integration: `dev-nowaker`; feature worktree `v2-build`, rebased to local integration and fast-forward merged.

> You are worker W1 [v2-fork] of the opencode v2 Phase 0 effort.

> GOAL: the v2 fork base that every later phase builds on.

The assignment requested a pinned v2 branch on both mirrors, first-commit pre-push cap, pre-migration v1 database refusal, tracked `opencode2` installer, host-local builds on desktop/m4max and an isolated demo. The coordinator later took ownership of m4max's pending build because it went offline and explicitly directed desktop work to finish without waiting.

## Delivered source

| Branch | Commit | Result |
|---|---|---|
| `v2-nowaker` | `93f790182d` | First fork commit: retain lint, cap typecheck at two packages. |
| `v2-nowaker` | `84e23092d9` | Core guard before filesystem writes/migration, plus injected-client guard. |
| `v2-nowaker` | `d90d41a9071564ed14d532b34c33d46180a5fd70` | Explicit CLI selection, shared guard, tests and documentation. Both remote tips verified. |
| `dev-nowaker` | `ee1e5815cf798ca5c910f38418dd9d30c7796fa5` | Ordinary installer commit, fast-forward integrated and pushed to both mirrors. |

The cap commit initially had an incorrect harness trailer. The coordinator explicitly authorized its message-only amend while unpushed. `git diff e6d4a8c154 93f790182d` was empty. No source content changed and no `dev-nowaker` history was rewritten.

## Features touched

- [Guarded v2 foundation](../features/2026-11-10-v2-foundation.md): new customization and opening-path audit.
- [Tracked builder and version stamp](../features/2026-09-29-vt-version-stamp.md): v2 mode retaining v1 semantics and its existing migration guard gate.

## Verification and install

- Core database tests: 36 pass, 0 fail, 70 assertions. CLI resolver: 6 pass, 0 fail, 10 assertions. Both typechecks pass. Full lint exits 0 with 550 pre-existing warnings; changed guard/test files have 0 warnings and 0 errors.
- Four guard mutations fail and restore byte-identical owners. The dangling-link regression failed before correction; Oracle cleared the corrected path.
- Installer shell tests and syntax checks pass. V2 and v1 push hooks pass 34 and 30 workspace typecheck tasks respectively.
- `bash /home/nowaker/projekty/webapps/opencode-build/build.sh --v2` built the full native CLI and embedded app from desktop's own checkout, installing `opencode v2.2.7-vt-4-5f76acb125` at `opencode-build/bin/opencode2`.
- Installed proof: `.vibeterm/tmp/opencode/guard-smoke.ts` using both installed binaries. A scratch v1 server answered `/session` 200; unset/default/home-default/explicit/poisoned v1 cases were then refused byte-identically. Fresh v2 answered `/api/info` 200 on port `46583`; the owned process was stopped. Evidence: `.vibeterm/tmp/opencode/v2-guard-GKkwXN/result.json`.
- Desktop v1 inode/size remained `49984166` / `198708336`; v2 is `49972315` / `239963248`. Protected serve-unit status/PID/start fields remained unchanged. The primary checkout's unrelated `.gitignore` edit and deliberate retry patch were untouched.
- Node-driver guard execution was not separately exercised; shared implementation and readonly adapter configuration were source-reviewed and typechecked.
- `v2-build` was retired through the managed worktree tool after fast-forward integration.
- [Demonstration session](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e37fc6aa2ffeItmFQYimsW3v7l) ran from `/home/nowaker/projekty/tmp/vibeterm/opencode-omo-demos`. Its second isolated proof passed all five refusal cases and fresh `/api/info` 200 on port `42575`, then showed the actual multiline refusal from `debug paths db`. Main read its evidence: `/home/nowaker/projekty/tmp/vibeterm/opencode-omo-demos/tmp/v2-guard-XkeMLF/result.json`.

## m4max handoff

m4max had Bun 1.4.4 and Command Line Tools at preflight, then went offline; the source-update SSH command exited 255. No Mac build or installed version is claimed. The coordinator owns these commands when it wakes:

```sh
export PATH="/opt/homebrew/bin:$PATH"
repo="$HOME/projects/webapps/opencode"
git -C "$repo" fetch origin dev-nowaker v2-nowaker
test "$(git -C "$repo" symbolic-ref --short HEAD)" = dev-nowaker && git -C "$repo" merge --ff-only origin/dev-nowaker
"$HOME/projects/nowaker/opencode-tools/vibeterm-opencode-client/bin/vt-worktree-create" branch=v2-nowaker parent=origin/v2-nowaker directory="$repo" install=false
bash "$repo/.vibeterm/build.sh" --v2
mkdir -p "$repo/.vibeterm/tmp"
scratch="$(mktemp -d "$repo/.vibeterm/tmp/opencode2-version.XXXXXX")"
env -i PATH="$PATH" HOME="$scratch" XDG_DATA_HOME="$scratch/data" XDG_CONFIG_HOME="$scratch/config" XDG_CACHE_HOME="$scratch/cache" XDG_STATE_HOME="$scratch/state" OPENCODE_CONFIG_DIR="$scratch/config/v2" OPENCODE_DB=:memory: OPENCODE_TOOLS_DATA_DIR="$scratch/tools" OPENCODE_PLUGINS_DATA_DIR="$scratch/plugins" "$HOME/projects/webapps/opencode-build/bin/opencode2" --version
```

Each host builds its own checkout. Do not copy binaries, disturb the v1 retry patch, restart live processes or use live v2 data to finish this handoff.
