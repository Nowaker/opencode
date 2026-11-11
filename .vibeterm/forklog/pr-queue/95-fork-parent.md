# Holding - session.fork parentID

Status: NOT QUEUED - the implementation owner explicitly reports this v1 feature is not ready or suitable as an upstream head. This holding record is inventory only, not an instruction to port or narrow it.

- Candidate behavior: explicit `session.fork` parent identity.
- Owner: [ses_e3b66e073ffeBjngD0B2e6LCl8](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3b66e073ffeBjngD0B2e6LCl8), detailed reply on November 11, 2026.
- Fork branch reported by owner: `feat/fork-as-child`, tip `d6ec184270`, on both mirrors. Source changes are `db917f0795` (parent/title/permission) and `d6ec184270` (context-only history and zeroed copied usage).
- Upstream merge base: `006d837c50`, but the branch is cut from `dev-nowaker` and carries 432 commits above it. It cannot be used directly as a PR head.
- Live target refs at `2026-11-11T12:12:12Z`: `v1` is `acc8c26da40f918e1ce222cb03c3342242c3ed6a`; `dev` is `611cee9d4b667b459f19ca0cbf6e76d8647535fb` (`git ls-remote`). No latest-base compatibility or upstream QA is claimed.
- Hard dependency: the fork-only background-fork behavior (`unsettled`, explicit IDs, provenance copying and fork tests). The owner reports conflicts in the session handler, session implementation and generated SDK, plus a deleted upstream test. V1 is maintenance-only.
- Overlap reported by owner: open [#47576](https://github.com/anomalyco/opencode/pull/47576) proposes experimental subagent context forking; [#61915](https://github.com/anomalyco/opencode/pull/61915) and [#61081](https://github.com/anomalyco/opencode/pull/61081) concern fork context. Closed [#43645](https://github.com/anomalyco/opencode/pull/43645) overlaps copied-usage accounting. These are owner-reported leads, not independently verified dispositions or equivalence findings here.
- Fork QA reported by owner: red 6 pass/3 fail followed by 25 passing fork/lineage/provenance tests; combined merge checks 47 pass, typecheck/SDK clean, isolated copied-versus-own usage proof, vt-452 installed on both hosts. This does not verify an upstream-scoped head.
- Filing priority: after the already assigned entries 01-05, unless the TUI coordinator supplies a different order. No relative order among additional candidates is implied by this holding filename.
- Next step: a separately authorized scope decision and upstream overlap check are required. A potential copy-usage-only bug fix is not approved or selected by this queue. No dependency on the bash-background candidate was reported.

No filing command is supplied for an unverified head.
