# Re-check: does a 4.3 KB inline `--prompt` hang a new-session start?

## Identity

- Workday: 2026-10-17
- Session: `ses_eebf9a83fffeIQQwW9gVFo5jaO`
- Agent/platform: `Sisyphus` on `anthropic/claude-opus-5-5` (variant high) / linux, Vibeterm
- Repository: `~/projekty/webapps/opencode`
- Integration branch: `dev-nowaker`
- Development branch(es): none
- Upstream base: `dfb56f76c7` (upstream `v1`, `v1.19.0`); unchanged
- Source result commit(s): none
- Forklog commit: this file's introducing commit

## User requests

The coordinator `ses_ef8235798ffejGr4sa22eXmVNv`, re-sending a 2026-10-14
task whose delivery was lost:

> Problem seen on 10-13: spawning a new session with a specific 4.3 KB
> pure-ASCII brief passed inline as `--prompt` hung before the first frame and
> before any session row was created. It happened twice (pids 3673949 and
> 4142227; both tabs are gone now).

> Reproduce it first on the CURRENT installed opencode (vt-343) [...] If it no
> longer reproduces, say which version and run you tested and stop there; no
> fix needed.

## Goals

- Establish whether the brief's text, rather than startup timing, makes a
  new-session start with `--prompt` hang.

## Constraints and non-goals

- Scratch `XDG_*`, `OPENCODE_TOOLS_DATA_DIR`, `OPENCODE_PLUGINS_DATA_DIR`,
  `OPENCODE_DB`; providers pointed at a closed port; throwaway tmux sockets
  `spawnlat` and `vtqa-hang`. The live database was never opened.
- No source change unless it reproduced.

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Deliver and settle TUI worker requests without startup races](../features/2026-10-12-tui-worker-error-reply.md) | re-verified on `vt-343`; the reported text dependence does not exist | runs below |

## Findings

- Pids 3673949 and 4142227 are the two specimens the
  [2026-10-13 spawn-hang record](./2026-10-13-tui-spawn-hang.md) traced to Bun
  1.4.x dropping worker requests during top-level awaits, fixed by
  `95113b27bc` (`vt-285`). `tmp/spawn-hang/argv.hung-linux2.bin` is 4142227's
  exact argv; its prompt is the brief
  (`opencode-tools/tmp/click-linux-brief.md`).
- The prompt text plays no part: on `vt-275` a one-line prompt hangs exactly
  like the brief under the same startup latency.

## Verification

- Bare replay of the exact hung argv (`tmp/spawn-hang/lat.sh`, a scratch git
  project, the data directory's `mkdir` delayed by `strace`), state 50 s after
  launch, load average 55-73:

  | Binary | Prompt | Delay | Result |
  |---|---|---|---|
  | installed `1.19.0-vt-343-dfb56f76c7` | the brief | 0 ms | 4/4 drawn |
  | installed `vt-343` | the brief | 3000 ms | 3/3 drawn |
  | `vt-275` (`opencode.prev-1791962101`) | the brief | 0 ms | 2/2 drawn |
  | `vt-275` | the brief | 3000 ms | 2/2 blank, no session |
  | `vt-275` | one line pointing at the brief file | 3000 ms | 2/2 blank, no session |

  The scratch database held 9 sessions, one per drawn run.
- Through `vt-spawn-session` on a throwaway Vibeterm instance
  (`tmp/spawn-hang/spawn-rig.sh`: socket `vtqa-hang`, `VIBETERM_OPENCODE_CMD`
  the installed `vt-343`, the brief as the prompt): 3/3 tabs drawn, 3 sessions
  created, each holding the brief whole (5021-character user text: the brief
  plus the spawn's metadata header).

## Build and install

- Build command: none. Desktop has `1.19.0-vt-343-dfb56f76c7` installed; m4max
  not touched.

## Commit provenance

- Required trailer: `AI-Session-ID: ses_eebf9a83fffeIQQwW9gVFo5jaO`

## Unknowns and blocked verification

- None new; the unknowns in the 2026-10-13 record stand.
