# Holding - v2 read-only plugin message projection

Status: FORK IMPLEMENTATION DELIVERED; UPSTREAM PORT NOT READY - not admitted to the ordered filing queue. The v2 coordinator reports that the plugin message API was merged and pushed on `v2-nowaker` at `398e98d11c`, together with a fork-only guard fix. Neither change belongs in the two independently prepared heads for entries 01 and 02.

- Upstream target line: `dev`.
- Live target check: `611cee9d4b667b459f19ca0cbf6e76d8647535fb` at `2026-11-11T12:12:12Z` (`git ls-remote`). No upstream candidate, latest-base compatibility test or QA is claimed for this holding record.
- Local branch: `plugin-messages`, observed at `457cab7c5e20795e6b03b9f0b132989fba16adea`. The coordinator reports one implementation commit above the shared `v2-nowaker` source stack; this is not an upstream-scoped head.
- Delivery update: the coordinator's November 11 `12:22:58Z` message reports the fork delivery. The queue owner independently confirmed `398e98d11caadbf20ba9544fcf251a15805e77a0` on both mirrors through `git ls-remote` at `2026-11-11T12:26:07Z`. No upstream-scoped branch or port QA has been supplied; fork delivery is not upstream readiness.
- Implementation owner: [W1 ses_e3832b1b0ffe6q98OeUzhgqhjQ](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e3832b1b0ffe6q98OeUzhgqhjQ), confirmed by [v2 coordinator ses_e383ee7faffe6JX8m2EP26dXUC](https://portal.vibeterm.desktop.ts.nowaker.net/session/ses_e383ee7faffe6JX8m2EP26dXUC) on November 11, 2026.
- Scope reported by the owner: read-only `ctx.session.messages` projection of `MessageApi.list`, paging, `ctx.app.capabilities.sessionMessages`, and an `/api/info` capability. No ready upstream QA result is claimed here.
- Filing order: unassigned; entries 01-05 retain their requested order.
- Next step: the implementation owner supplies its upstream disposition and port evidence. Only then prepare an upstream-only head, docs, verified regression coverage and the full filing body before admitting it.

The implementation remains with its existing owner. This file authorizes no implementation changes, upstream writes or route decision.
