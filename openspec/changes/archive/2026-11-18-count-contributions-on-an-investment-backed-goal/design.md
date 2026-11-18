## Approach

Default to current market value. Existing Archant goals already use account balances, so the new default preserves their figures. Persist the selected basis and lock it while a completion amount is frozen. Compute market movements from ledger balance inputs, including holdings and valuations, because Archant's `balances` rows store total and cash without Sure's `net_market_flows`. Reuse the result for contribution-based progress and the valuation pace fallback if `a-goals-pace-and-history-as-sure` has shipped. Keep the shared account allocation rules for both figures.

## Source

Story 35.8 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria. [Sure #4026](https://github.com/we-promise/sure/pull/4026) adds the basis choice and locks it after completion.
