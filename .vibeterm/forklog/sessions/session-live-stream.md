# Opt-in session live streaming

## Identity

- Workday: 2026-11-16.
- Session: [`ses_e1c8d67dbffeqlzOK8teK7Agt4`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1c8d67dbffeqlzOK8teK7Agt4).
- Parent: [`ses_e1c952bf0ffe83nzH8FOR8uzzX`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1c952bf0ffe83nzH8FOR8uzzX).
- Agent/platform: Hephaestus, OpenCode / darwin arm64, m4max.
- Integration branch: `dev-nowaker`; development branch: `session-live-stream`.
- Upstream base: `006d837c5022ea5278162307c04c78412cfae9f3`.
- Feature source: `b41fece7764b7a9bf3b7afd747483e064b926566`; combined source: `499ec1775d7e6a93166fb517550d86dd4c0a33ca`.
- Physical-directory correction: `6305b4bfa7d7c6d7cce09e6568a6c6073fa56a00`.

## Scope

The retained continuation says: "GOAL: opt-in per-session live output through vibeterm-api existing SSE, OFF unchanged." The initial prompt before the retained continuation is unavailable here.

Implement the optional plugin capability, authenticated owner transport, selected public SSE channel, real fixtures and verification. Complete integration and independent primary builds on m4max and desktop. Questions and blockers are routed to the parent session.

## Source and feature

- [Live session output for plugins](../features/session-live-stream.md): atomic snapshot cut, ordered private publication, pending tool input and retry prefix lifetimes.
- The development branch merged the delivered pause identity guard at `06067f4c27dea04b66e6be7ed999047362be9d65`; it was not rebased or force-pushed.
- opencode-tools landed on `origin/master` as `d59d27e7bfbf326231c1c48915a621d8b1fbf815`. All six rebased commits compare equal by range-diff, and the API, control, live-stream, plugin and helper production bytes match the accepted pre-landing receipt `73e48851a383bcd5d98221bf5917f88e1a73f6df`.
- User API syntax: authenticated `GET /event?stream=ses_ID` or `/global/event?stream=ses_ID`; ordinary subscribers retain their existing feed.

## Verification receipts

| Check | Observed result |
|---|---|
| Engine live-event, plugin, pause and HTTP tests | 102 passed, 554 assertions. |
| Engine package typecheck | Exit 0. |
| Symlink, foreign and missing directory correction | 102 total tests passed, 554 assertions; package typecheck exit 0. |
| API/control/browser-safe focused suite | 337 passed, 817 assertions. |
| Tools canonical typecheck | 0 errors across 4 projects. |
| Real corrected-candidate TUI/API and OFF checks | 4 passed, 23 assertions. |
| Final bounded Oracle reviews | Approved; no remaining source blockers in the three initial corrections, selected app-tool SSE wiring or physical-directory/error-boundary correction. |

Corrected scratch binary: `/Volumes/projects/nowaker/opencode-tools/.vibeterm/tmp/opencode/live-stream-candidate-final-e1c8d67d`, version `1.19.5-vt-509-006d837c50`, SHA256 `04ff7d2da44108390372d9ca2b5aea514e762accc1118c71fad600fec6a0443a`. Its canonical `.vibeterm/build.sh` run passed all 8 migration-guard checks. This artifact did not replace the installed host binary.

The separate immutable pre-extension engine is pinned by version `1.19.5-vt-504-006d837c50` and SHA256 `f497591102f91e7ad3b86c7f81fa46831c6051bf3aad542ef7dfd1f78defe1ae`; its exact built source is not inferred from its upstream merge-base stamp. The audit discovers all 24 ordinary tables and preserves complete normalized transcript mutation payloads, ordinary stepped frames and raw write chronology.

The rejected capture was traced to the upstream native shell's lazy output subscription after child close, which can lose stdout and one part update plus its event/event_sequence pair. The test workload now stays alive for 0.2 seconds after output; shared default and frozen performance workloads remain unchanged. Five pinned vt504 baseline runs and five corrected vt510 OFF runs passed exact payload/frame/count comparisons: all ten matched 24 frames, 37 transcript mutations and 99 database mutations, normalized bytes 12,610 before and 36,235 after. Four additional vt510 results are retained in `/Users/nowaker/.local/share/opencode/tool-output/tool_1e46b6ca0001QECs9Kl6vpR3ml`; the first is the OFF case of the final four-scenario runtime gate. No native shell fix or normalization exclusion is part of this streaming change.

The combined API-created-session proof then exposed a distinct alias bug: a stored `/var/folders/.../project` directory was rejected against the same physical engine instance at `/private/var/folders/.../project`. Changing only the creation directory to its realpath changed both private and public 500 responses to 200. Native correction `6305b4bfa7d7c6d7cce09e6568a6c6073fa56a00` compares physical identity and returns explicit directory errors. New immutable scratch binary `/Volumes/projects/nowaker/opencode-tools/.vibeterm/tmp/opencode/live-stream-candidate-directory-e1c8d67d` is `1.19.5-vt-510-006d837c50`, SHA256 `6f0c47f872dc7617e1cf9d8eeb3059644dfb583f408cf8c36ec1a3b7c56400ad`, with all 8 migration-guard checks passed. Matching API/control handling is landed and verified; the app consumer owns the unchanged alias, disconnected approval, reconnect and Node acceptance runs.

## Build and delivery

- Primary source fast-forwarded to `6305b4bfa7d7c6d7cce09e6568a6c6073fa56a00`; GitLab and GitHub `dev-nowaker` tips were independently queried and matched it. Each push hook passed all 30 workspace typechecks.
- m4max primary build/install completed at 2026-11-16T12:56:31Z, from feature source `6305b4bfa7d7c6d7cce09e6568a6c6073fa56a00` with the deliberate retry patch preserved. Installed `/Volumes/projects/webapps/opencode-build/bin/opencode` reports `1.19.5-vt-510-006d837c50`; all eight migration-guard checks passed. Full build log: `/Volumes/projects/nowaker/opencode-tools/.vibeterm/tmp/opencode/live-stream-build-primary-m4max-e1c8d67d.log`.
- The independently developed shell stdout fix `1a4cba2fbef71633e3734fc17e197b2c607d5dce` was committed at 2026-11-16T12:57:08Z and reached primary after this build. This provenance commit preserves that source; it does not claim vt510 contains the later fix.
- The shell-fix owner subsequently built primary at 2026-11-16T12:58:57Z-12:59:25Z and reported a passing guard plus `SMOKE OK`, installing `1.19.5-vt-511-006d837c50` from `1a4cba2fbef71633e3734fc17e197b2c607d5dce` with the deliberate retry patch. This session independently invoked the installed binary and observed vt511. Performance acceptance continues to use the immutable scratch vt510 artifact, never the replaced PATH binary; the exact later build interval was supplied to its owner to reject any overlapping pair.
- App consumer acceptance on its own two commits atop landed tools `d59d27e7b` passed three real tests and 75 assertions in 147.71 seconds: native naming, Node v26.13.1, and disconnected approval/reconnect/restart through production SSE. Its `/var` alias fixture remained unchanged. The retained receipt is `/Users/nowaker/.local/share/opencode/tool-output/tool_1e46d54680016EFCZuYc2Y2jCX`; the consumer's bounded namespace gate and its own landing remain separate.
- Desktop's shared build is owned by [`ses_e1c704309ffe9QEvj69IIxmKNZ`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1c704309ffe9QEvj69IIxmKNZ), coordinated with [`ses_e383ee7faffe6JX8m2EP26dXUC`](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC). Its last observed gate refused at load 96.85 with no build started. It will use the newest published shared tip and provide its own built-SHA, version and guard receipt.
- App consumer [`ses_e1c8d1fbbffeDRqJPdoDPiJqkU`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1c8d1fbbffeDRqJPdoDPiJqkU) and performance worker [`ses_e1c8c5894ffev5AZef6yecmm4P`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e1c8c5894ffev5AZef6yecmm4P) received the exact accepted source and immutable scratch binary. The app worker owns both API activations after combined acceptance and both host installs. The parent retains final cross-repository delivery receipts.
- The deliberate uncommitted primary retry-header patch remains untouched. Primary installs must build each host's own merged checkout so the patch remains in its installed binary.
