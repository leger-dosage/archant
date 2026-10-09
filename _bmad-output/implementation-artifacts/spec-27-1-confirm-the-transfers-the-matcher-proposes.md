---
title: 'Story 27.1: Confirm the transfers the matcher proposes'
type: 'feature'
created: '2026-10-09'
status: 'done'
baseline_commit: '1d30a5e0e6e41a94648ecb01372b91890ca3b598'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The matcher links two lines of opposite equal amounts as a final transfer without the owner's say: on 3 October it made eight false pairs. It also reads only new lines, gives up when a line has two candidates, and the hand picker is held to the matcher's 4 days, where Sure proposes, ranks, scans every unmatched line and lets a hand pair span 30 days.

**Approach:** Sure's `Transfer#status`: the matcher creates `pending` transfers, chosen as Sure's `auto_match_transfers!` ranks them over every unmatched line; the owner confirms or rejects them from the list row, as Sure's `_transfer_match`; a hand pair is `confirmed` at once within 30 days. Story 27.1 of `epics.md` is the acceptance contract; where it departs from Sure, Sure wins, as recorded below.

## Boundaries & Constraints

**Always:**
- `transfers.status`, `pending` or `confirmed`, not null, default `pending`, with a check. Every existing transfer becomes `pending`. A pending transfer counts exactly as a confirmed one everywhere (totals, kinds, recurring, bills, exports): Sure reads `status` only to show it.
- Automatic candidates are Sure's: opposite equal amounts, same currency, different active accounts, at most 4 days apart, neither side excluded, a split child or in a transfer, the pair never rejected. A line whose rule names an expected account keeps only candidates in that account (`narrowToExpected`, unchanged). Ranked by date difference (Sure's `match_rank` is 0 for every same-currency pair), ties broken by outflow then inflow id for a stable result; the first candidate whose two sides are both free wins. Mutual uniqueness goes.
- Matching reads every unmatched transaction of the household, from every `ingest` (import, sync, typed line) and from `applyRulePlanToHistory`, as Sure's family sync after each of those. It reads all candidates before writing any.
- `NFR10` holds: `history-volume.spec.ts` still passes, and asserts the new candidate query reads `entries_kind_amount_date`.
- Hand pairs (« Rapprocher un virement », `POST /api/transfers`, the assistant's `pair_transfer`): `confirmed`, sides at most 30 days apart, rejected pairs allowed, as Sure's `transfer_match_candidates(date_window: 30)`. The picker and `get_transfer_candidates` list candidates within 30 days, closest date first.
- `POST /api/transfers/:id/confirm` sets `confirmed`, idempotent; unknown id `NOT_FOUND`. Reject stays `POST /api/transfers/:id/reject`: deletes the transfer and records the pair in `rejected_transfers`.
- List row of a pending side: Sure's pill « Correspondance automatique » (icon below `md`, as the other badges); for an administrator, two icon buttons beside the row button, never inside it, named « Confirmer la correspondance » (check) and « Rejeter la correspondance » (cross). A viewer sees the pill only. Confirming toasts « Virement mis à jour », Sure's `transfers.update.success` with the word a French user expects; rejecting keeps the existing rejected toast.
- The transaction payload's `transfer` gains `status`.
- The « possible transfer » suggestion goes: with greedy ranking a free line never keeps a free candidate, and Sure has none. `transferSuggested`, `suggestedAmong`, the `transferSuggested` badge, the sheet's suggestion text and the assistant's `transfer_suggested` are removed; `INSTRUCTIONS` says matching proposes the closest candidate and the owner confirms it.
- Archant's export carries `status`; a restore of a file without it reads `pending`. The Sure export writes each transfer's real status instead of `"confirmed"`, and `sureAcceptsTransfer` takes Sure's 4 days for a pending transfer and 30 for a confirmed one.

**Never:** no cross-currency matching (Later, with exchange rates); no confirm or reject in the transaction sheet, which keeps « Dissocier » and « Ne plus proposer » as today, since Sure shows the proposal in the list only; no new assistant tool and no `status` in assistant outputs (Stories 27.10 and 27.13); no label test; no change to `rule-plans` beyond calling the new matcher.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Two candidates | −100 on A day 10; +100 on B day 11 and on C day 13 | A↔B `pending`; C stays free |
| Shared candidate | −50 A day 1 and −50 C day 3; +50 B day 2 | both one day away: the lower outflow id pairs with B; the other stays free |
| Old lines | −80 A and +80 B imported before this story, unmatched; any later ingest | A↔B `pending` |
| Rejected | a pending pair rejected; next ingest | the pair is never proposed again |
| Confirm | admin clicks « Confirmer la correspondance » | `confirmed`; pill and buttons gone |
| Hand pair | two lines 20 days apart | picker lists them; pairing gives `confirmed` |
| Hand 31 days | two lines 31 days apart | not listed; `POST` answers `VALIDATION_ERROR` `counterpartId` `not_a_candidate` |
| Migration | a transfer before this story | `status = 'pending'`, still counted as a transfer |
| Viewer | pending side, viewer | pill only; `POST /confirm` refused by `viewerReadOnly` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/transfers.ts:14` -- add `status` and its check; types in `packages/data/types.ts:73` follow. Migration through `pnpm data generate` into `packages/data/drizzle/` (next after `0064_loan_subtypes_as_sure.sql`); `packages/data/migrate.spec.ts` covers it.
- `packages/api/src/domain/transfer-matching.ts` -- `TRANSFER_WINDOW_DAYS` (4) stays for proposals; add a 30-day constant for hand pairs; replace `mutualMatches:101` with a greedy ranking; `isTransferCandidate:47` takes the window; `narrowToExpected:137` stays.
- `packages/api/src/services/ledger/transfers.ts` -- `matchNewTransfers:261` becomes a household-wide matcher; `candidateOf:73` and `candidatePairQuery:154` stop requiring a given id; `matchTransfer:364` inserts `confirmed` with the 30-day window and rejected pairs allowed; `transferCandidates:322` likewise; add `confirmTransfer`. Callers: `services/ledger/ingest.ts:981`, `services/ledger/rule-plans.ts:225`.
- `packages/api/src/services/transfers.ts`, `routes/transfers.ts` -- `confirmTransfer` service and route beside `rejectTransfer`.
- `packages/api/src/services/ledger/queries.ts:61,123-145,253,357` and `shared.ts:274` `transferColumns` -- drop the suggestion, add `status` to `transfer`. `testing/app.ts:193` follows.
- `packages/api/src/services/ledger/export.ts:246` `EXPORTED_COLUMNS.transfers` and its restore; `services/export.ts:427` `sureAcceptsTransfer`, `:1000` the hard-coded `"confirmed"`.
- `packages/api/src/mcp/transactions.ts:76,121`, `mcp/server.ts:172`, `mcp/transfers.ts:20,58` -- drop `transfer_suggested`, rewrite the transfer line, 30 days through the services.
- `packages/app/src/hooks/useTransfers.ts` -- add `useConfirmTransfer` beside `useRejectTransfer:53`.
- `packages/app/src/components/TransactionList.tsx:349-353,410`, `StatusBadge.tsx:34-38`, `TransactionLinks.tsx:28,103` -- pending pill and actions; suggestion removed.
- `packages/app/src/locales/fr.json:367` `transactions.transfer` (and the English file beside it) -- add `autoMatched`, `confirmMatch`, `rejectMatch`, `confirmed`; drop `suggested`, `suggestion`.
- `docs/architecture.md:149` AD-11; `docs/sure-parity.md:156-161`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/transfer-matching.spec.ts` -- first, failing: greedy ranking with two candidates, shared candidate, tie order, 30-day hand window -- the money path to the branch.
- [x] `packages/data/schema/transfers.ts`, migration, `packages/data/migrate.spec.ts` -- the column; an existing transfer reads `pending`.
- [x] `packages/api/src/domain/transfer-matching.ts` -- greedy ranking; windows as parameters.
- [x] `packages/api/src/services/ledger/transfers.ts`, `transfers.spec.ts`, `ingest.spec.ts`, `rule-plans.spec.ts` -- household-wide matcher creating `pending`; old lines matched on the next ingest; hand pair `confirmed` within 30 days; `confirmTransfer`; a rejected pair never proposed again.
- [x] `packages/api/src/services/history-volume.spec.ts` -- plan assertion for the candidate query; NFR10 timings unchanged.
- [x] `packages/api/src/services/transfers.ts`, `routes/transfers.ts`, `routes/transfers.spec.ts` -- confirm route; candidates within 30 days.
- [x] `packages/api/src/services/ledger/queries.ts`, `shared.ts`, `testing/app.ts`, `queries.spec.ts` -- `status` in the payload; suggestion removed.
- [x] `packages/api/src/services/ledger/export.ts`, `services/export.ts` and their specs -- status exported and restored; Sure export's status and windows.
- [x] `packages/api/src/mcp/transactions.ts`, `mcp/server.ts`, `mcp/transfers.ts` and specs -- suggestion removed, 30-day candidates, hand pair confirmed.
- [x] `packages/app/src/hooks/useTransfers.ts`, `TransactionList.tsx`, `StatusBadge.tsx`, `TransactionLinks.tsx`, locales, `lib/transfers.spec.ts` -- pending pill, admin actions, suggestion removed.
- [x] `packages/app/e2e/transfers.spec.ts`, `transaction-rows.spec.ts` -- confirm a proposal and reject one from the list; the « possible transfer » cases become proposals.
- [x] `docs/architecture.md`, `docs/sure-parity.md` -- AD-11 as Sure: a status, greedy ranking over every unmatched line, 4 days for a proposal, 30 for a confirmed transfer; « Automatic window », « Manual picker window », « Several candidates », « When matching runs » read Parity; cross-currency stays Later.

**Acceptance Criteria:**
- Given a transfer made before this story, when the owner opens the list, then both sides show « Correspondance automatique » and still count as a transfer until rejected.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, and screenshots of a pending row as administrator and as viewer, at desktop and narrow width, are checked in self-review.

## Design Notes

Greedy order, as Sure's loop: sort candidate pairs by `|date difference|`, then outflow id, then inflow id; walk them, keep a set of used ids, take a pair only when neither side is used. Computed over the whole household, the result never depends on which account synced first, which is what AD-11 guarded with mutual uniqueness.

Unlinking with « Dissocier » records no rejection, as Sure's `Transfer#destroy!`, so the next matching run may propose the pair again; « Ne plus proposer » is the way to stop it.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean, knip finding nothing left of the suggestion.
- `pnpm test` -- expected: both Vitest projects pass, `volume` included.
- `pnpm test:e2e` -- expected: all five Playwright projects pass.

## Implementation Notes

- Migration `0065_transfer_status.sql`: drizzle-kit's rebuild read a `status` column the old table lacks; its `INSERT` writes `'pending'` instead.
- Tests that unlink a pair now reject it (`unpair`, `unlinkTransfer(id, { never: true })`), since « Dissocier » lets the next ingest propose it again.
- `applyRulePlan` no longer returns `marked`: matching reads the whole household.
- No code restores an Archant archive; the column default is what a file without `status` would read.
- The review diff left out `packages/data/drizzle/meta/0065_snapshot.json`, generated.
- On a phone the two buttons sit under the amount, on the row's second line: beside it they left the label a few letters and pushed the amount out of its column; from 768 px they keep a 64 px column on every row of a list holding a proposal.
- `confirmTransfer` runs in an immediate transaction, as AD-2 asks of every ledger function.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Upgrade turns old unmatched pairs into proposals, shifting past totals, with no upgrade note | low | Real: the first ingest after `0065` proposes over the whole history; nothing for a self-hoster to do, so no `breaking-change`. | patch (pull request description says it) |
| Single-line ingest pays a household-wide candidate scan, untimed | medium | Real: `proposalCandidateQuery` reads every unmatched outflow on each `ingest`; only the 24,000-line import is timed. | patch |
| `matchTransfers` runs even when an ingest wrote nothing | low | Sure matches on every sync too; a guard would skip a pair freed by an edit. | rejected |
| `docs/deployment.md` export paragraph still says 30 days | low | Real: `sureAcceptsTransfer` now takes 4 days for a pending transfer. | patch |
| Spec promises a restore reading `pending` that no code has | low | Archant never reads its archive back; only the column default holds it. Fix would edit this spec. | rejected |
| Export test checks only half of a refused pending pair | low | Real: it never asserts the pair stays under `archant.transfer`. | patch |
| « Rejeter la correspondance » asks no confirmation | false | Sure's `_transfer_match` reject button asks none either. | rejected |
| No filter to find pending proposals | low | Sure's interface has none; outside the intent. | rejected |
| Spec header and sprint tracking disagree; English locale named | false | Tracking moves to `done` at completion; wording of this spec. | rejected |
| Leftover suggestion names in `history-volume.spec.ts` and an e2e comment | low | Real, direct renames. | patch |
| `rules.spec.ts` deletes transfers with raw SQL | low | Real; the route undoes them as elsewhere. | patch |
| No end-to-end hand pair beyond 4 days | low | Real: Vitest covers 20 days, Playwright never pairs by hand at that distance. | patch |
| Rule application count leaves proposals out | low | The count is rows a rule changed, as before. | rejected |
| `confirmTransfer` skips Sure's validations | low | A pending side redated past 30 days is rare; fix adds guards. | rejected |
| Legacy transfers redated 5 to 30 days leave the Sure export until confirmed | low | Old windows were 4 days both ways; only a later redate reaches it. | rejected |
| Below 768 px a pending row's amount sits left of the others | low | Real, on the proposed row only. Patched, then reverted: a slot on every phone row left a label beside two badges 40 px wide, failing `transaction-rows.spec.ts`. | rejected |
| Inflow-side narrowing tested only by random UUID ties | medium | Real: both tests date the three lines the same day. | patch |
