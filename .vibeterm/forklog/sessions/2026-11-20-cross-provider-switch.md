# Phase 1 native v1 cross-provider switching

- Session: [`ses_e042fa91bffecOvYIQCsl4mxhD`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e042fa91bffecOvYIQCsl4mxhD)
- Coordinator: [`ses_e043139c8ffefHb1ufDvWhIfc8`](https://portal.vibeterm.m4max.ts.nowaker.net/session/ses_e043139c8ffefHb1ufDvWhIfc8)
- Integration: `dev-nowaker`; development: `cross-provider-switch`; managed landing: `land-provider-switch`.
- Verified fork base `830bf1d14dc5b6459082f54d48d79cdf2ff45437` was the tip of both mirrors and an ancestor of Phase 1 source `1398232d0217ad21930705dcf4341ffb085aa7e1`. No source rebase, published feature rewrite, Phase 2, or native v2 change.
- Feature and sanitized on-call command: [Meridian refusal parking and exact Phase 1 recovery](../features/2026-11-16-park-no-routable-account.md#native-v1-cross-provider-switching-phase-1).
- Refreshed gates on exact source: 129 OpenCode tests (refusal, transport, safe projection, inheritance, pause, owner HTTP); 33 native TUI tests; TUI typecheck. Historical first Junior park remained unexplained after three distinct controlled reproductions and passing controls; coordinator approved rollout accepting the safe park.
- Distribution requires each host's tracked `.vibeterm/build.sh`, mandatory retry-cap and v1 database migration guards, and an isolated installed-binary smoke. Running TUIs and servers are not restarted by this change.
