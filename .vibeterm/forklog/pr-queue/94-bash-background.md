# Holding - bash run_in_background

Status: NOT QUEUED - the implementation owner explicitly reports this v1 feature is not ready or suitable as an upstream head. This holding record is inventory only, not an instruction to port it.

- Candidate behavior: bash `run_in_background` support.
- Owner: [ses_e3b66e073ffeBjngD0B2e6LCl8](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b66e073ffeBjngD0B2e6LCl8), detailed reply on November 11, 2026.
- Fork branch reported by owner: `feat/bash-background`, tip `2e8e50f138`, on both mirrors. Source changes are `5cc30c46fb` and the exit-duration correction `2e8e50f138`.
- Upstream merge base: `006d837c50` (`v1.19.5`), but the branch is cut from `dev-nowaker` and carries 429 commits above that base. It cannot be used directly as a PR head.
- Live target refs at `2026-11-11T12:12:12Z`: `v1` is `acc8c26da40f918e1ce222cb03c3342242c3ed6a`; `dev` is `611cee9d4b667b459f19ca0cbf6e76d8647535fb` (`git ls-remote`). No latest-base compatibility or upstream QA is claimed.
- Blockers reported by owner: replay conflicts in config, generated SDK and docs; deleted upstream run-state test; v1 is maintenance-only, so the feature requires a v2 design and port. The owner retains implementation ownership and is not preparing an upstream head.
- Related context reported by owner: closed feature request [#24885](https://github.com/anomalyco/opencode/issues/24885), closed PRs [#47187](https://github.com/anomalyco/opencode/pull/47187), [#47231](https://github.com/anomalyco/opencode/pull/47231), and [#33310](https://github.com/anomalyco/opencode/pull/33310). Their closure reasons must be understood before another proposal. These are owner-reported leads, not independently verified issue dispositions in this queue session.
- Fork QA reported by owner: shell-background tests 7 pass, typecheck clean, isolated OMO notification/timeout/cancel harness, installed smoke on desktop and m4max. This is fork-build evidence, not upstream-head verification.
- Filing priority: after the already assigned entries 01-05, unless the TUI coordinator supplies a different order. No relative order among additional candidates is implied by this holding filename.
- Next step: a separately authorized v2 proposal must settle upstream acceptance and scope before an upstream head is prepared. No dependency on the fork-parent candidate was reported.

No filing command is supplied for an unverified head.
