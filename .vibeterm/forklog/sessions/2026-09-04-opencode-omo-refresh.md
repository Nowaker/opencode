# 2026-09-04 - macOS OpenCode and OMO refresh

## Identity

- Workday: 2026-09-04
- Session: `ses_fb9a784deffe7zkW0r8oo25Nkg`
- Agent/platform: OpenCode through Vibeterm / macOS
- Repository: `/Volumes/projects/webapps/opencode`
- Related tooling: `/Volumes/projects/nowaker/opencode-tools`
- Integration branch: `master-nowaker`
- Prior upstream base: `f12e14cf1` (`v1.18.27`)
- Intermediate upstream base: `5cf9f517c` (`v1.18.28`)
- Final upstream base: `16747470f` (`v1.18.29`)
- Source result commit: `9f8f2b0b5`
- Forklog commit: resolve this file's introducing commit through its
  `AI-Session-ID` trailer

## User request

> bump omo and opencode here + reintegrate any patches. execute omo agents ls
> and make proper fixes. in summary, say what go adjusted after omo bump, if
> anything.

## Goals

- Integrate upstream `v1.18.29` into the macOS fork without losing local
  behavior.
- Reapply and verify the canonical retry-header delay cap.
- Install the native arm64 build used by new Vibeterm tabs.
- Refresh OMO and report every effective model or variant change.

## Constraints and non-goals

- Keep the retry-header cap as the canonical uncommitted two-file divergence.
- Preserve unrelated dirty files in the tools checkout.
- Do not restart a protected OpenCode serve process.
- Do not inspect, edit, or restart Meridian.
- Preserve `disabled_providers: ["google"]` and accept no Gemini assignment.
- Use one unsquashed forklog commit for this session and user workday.

## Branch and upstream movement

| Repository | Branch | Before | After | Action |
|---|---|---|---|---|
| OpenCode | `master-nowaker` | `aec696629` | `9f8f2b0b5` | Merge upstream `v1.18.28`, then exact tag `16747470f` (`v1.18.29`), while preserving the canonical retry patch |
| OpenCode origin | `master-nowaker` | `aec696629` | this record's commit | Publish the verified merge and forklog |
| opencode-tools | `master` | `7f129c7fe` | `5fb19df46` | Canonicalize two subprocess-sensitive native-command test fixtures and migrate the OMO policy/audit |

## Features touched

| Feature | Outcome | Evidence |
|---|---|---|
| [Global memory diagnostics](../features/2026-05-13-global-memory-diagnostics.md) | preserved | Integration seam audit and package typecheck pass |
| [Message shape normalization](../features/2026-05-23-message-shape-normalization.md) | preserved | Integration seam audit and package typecheck pass |
| [Interrupted assistant tail](../features/2026-05-29-interrupted-assistant-tail.md) | preserved | Integration seam audit and package typecheck pass |
| [Sync hot path](../features/2026-05-29-sync-hot-path.md) | preserved | Integration seam audit and package typecheck pass |
| [Alternate provider clones](../features/2026-05-30-alt-provider-clones.md) | preserved | Integration seam audit and package typecheck pass |
| [Compaction tracing](../features/2026-06-16-compaction-decision-tracing.md) | preserved | Integration seam audit and package typecheck pass |
| [Global bus typing](../features/2026-07-21-global-bus-typing.md) | preserved | `packages/opencode` typecheck passes |
| [Retry-header cap](../features/2026-08-06-retry-header-delay-cap.md) | reapplied | Focused tests, bytewise comparison, and binary marker pass |
| [Native tool commands](../features/2026-08-08-native-tool-commands.md) | preserved | Focused command tests and package typecheck pass |
| [TUI stream throttle](../features/2026-08-25-tui-stream-throttle.md) | preserved | Full TUI suite and typecheck pass |
| [Prompt input latency](../features/2026-08-31-prompt-input-latency.md) | preserved | Full TUI suite and typecheck pass |

## OpenCode verification

- Focused Codex-provider and retry gate: 105 pass / 0 fail.
- Two full `packages/opencode` attempts progressed through 3616 and 3615
  passing tests. The first ended on one five-second PTY timeout; the second
  ended on two processor-state timing assertions.
- The PTY file then passed 4 / 4 in isolation. The exact processor assertion
  passed 1 / 1, and its full file passed 17 / 17 on the next isolated run.
- A serialized full-suite attempt ran for 15 minutes before the harness stopped
  it on an unrelated snapshot timeout; that snapshot case passed 1 / 1 in
  isolation. These moving, isolated-green failures were not in the Codex or
  retry seams changed by this integration, so no source change was justified.
- Full `packages/tui` suite: 196 pass / 1 skip / 0 fail across 21 files.
- `packages/opencode` and `packages/tui` typechecks exit 0.
- JavaScript SDK and client generators leave no diff.
- The reapplied source diff equals both canonical patch copies byte for byte.

## Build and install

- Build command: `/Volumes/projects/webapps/opencode-build/build.sh`.
- Artifact: `/Volumes/projects/webapps/opencode-build/bin/opencode`, version
  `1.18.30`, arm64, device/inode `16777235:15291198`.
- The untagged fork build increments the upstream package version `1.18.29` to
  `1.18.30` by the build wrapper's existing policy.
- The installed binary contains one
  `OPENCODE_RETRY_MAX_HEADER_DELAY_MS` marker.
- The build wrapper's installed-binary smoke test observes version `1.18.30`.
- Throwaway-tmux CLI QA observes version `1.18.30`, rendered help, and missing
  `attach` URL input exiting 1.
- No protected headless `opencode serve` process was present or restarted.

## OMO outcome

- The registry and PATH-level installation both report `4.19.4`; installing
  `oh-my-openagent@latest` therefore changed no version.
- OMO's completed migration markers caused `config migrate --dry-run --json`
  to skip every step, so the live unified config and repository policy were
  migrated directly from deprecated `variant` keys to canonical `reasoning`.
- Five existing reasoning choices changed schema only: Hephaestus `max`,
  Prometheus `high`, Ultrabrain `xhigh`, Artistry `high`, and Unspecified High
  `high`. No model assignment or reasoning value changed.
- OMO 4.19.4 applies canonical `reasoning` at runtime but omits it from the
  assignment summary emitted by `doctor --json`. Override mode now reconciles
  only entries from the exact policy it just applied; legacy policy input is
  normalized, while writing emits only `reasoning`.
- Refreshed and no-refresh override audits each report 19 assignments, zero
  findings, and zero Google assignments. The pre/post
  `{kind,name,providerID,modelID,variant}` tuples are identical; Hephaestus and
  Ultrabrain alone changed from false to correct true `userOverride` markers.
- The mode-0600 live config hash is
  `4abad12590350691eb61d970626a05daf76b0f4de06947663a69439d15d413db`.
- The redundant legacy config was retired to the mode-0700 rollback directory
  `/Users/nowaker/.omo/migration-backup-2026-09-04-opencode-tools`, which also
  preserves the original unified config and its prior backup.
- Live CLI QA confirms the override is idempotent, both corrected reasoning
  assignments render as overrides, and the report ends with `Findings: none`.

## Commit provenance

- `a438486ba` - merge upstream `v1.18.28` into `master-nowaker`.
- `9f8f2b0b5` - merge exact upstream tag `v1.18.29` into
  `master-nowaker`.
- `5fb19df46` - land the Darwin fixture and OMO reasoning migration in
  `opencode-tools` `master`.
- This record's commit carries
  `AI-Session-ID: ses_fb9a784deffe7zkW0r8oo25Nkg`.
