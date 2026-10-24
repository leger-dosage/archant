---
title: "Story 31.7: Categorise investment contributions"
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'a8e28a008f3132e3a364283a145269587e2f44d7'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-31-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) puts the outflow of every investment contribution in « Contributions aux investissements »: `Transfer::Creator#outflow_transaction` sets `category: investment_contributions_category` when the kind is `investment_contribution`, `Family::AutoTransferMatchable#auto_match_transfers!` sets it on a proposal's outflow whose `category_id` is blank, and `TransferMatchesController#create` does the same for a pair made by hand. `Family#investment_contributions_category` finds the category by name or creates it, colour `#0d9488`, icon `lucide trending-up`, even after the owner deleted it. Archant leaves every transfer side's category as it was: `createTransferBetween`, `matchTransfers` and `matchTransfer` in `packages/api/src/services/ledger/transfers.ts` write no category, so a contribution counts in « Dépenses » without a category until the owner picks one in the transfer's drawer.

**Approach:** `transfers.ts` gains `categoriseContributions`, which, for each transfer of kind `investment_contribution`, gives its outflow « Contributions aux investissements » when it has no category, finding the category case aside or creating it with Sure's colour and icon. `createTransferBetween`, `matchTransfers` and `matchTransfer` call it in their transaction. `feesCategoryId` becomes `categoryIdFor(tx, category, now)`, shared by « Frais » and the contribution category, whose preset is exported from `services/default-categories.ts`. The pairing mutation refreshes the categories. AD-11, AD-12 and `docs/sure-parity.md` change with the code.

## Boundaries & Constraints

**Always:**
- Only the outflow, only kind `investment_contribution` (an investment or crypto account receiving from an account that is neither, `transferKindOf`), only when its `category_id` is null, as Sure's `category_id.blank?`. A category already there stays, locked or not.
- The category is found by name, case aside, as « Frais » is, else created top-level with `#0d9488` and `trending-up`; it is created only when an outflow needs it.
- No lock: Sure's `update!(category:)` locks nothing, so a rule or a sync may still change it (AD-10). `category_origin` is the write's origin: `user` for the form and a pair by hand, `rule` for the matcher, which runs from imports, syncs, rules and splits alike.
- Rejecting, unpairing or deleting the transfer leaves the category on the outflow, as Sure's `Transfer#destroy!` resets the kind alone.
- Same immediate database transaction as the transfer write.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no category on the inflow; no change to the drawer's category field (Story 31.6); no category from the Sure import's `DataImporter` or a rule's `set_as_transfer_or_payment` action, which Archant does not have; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Created | « Virement » from a checking account to a PEA | outflow in « Contributions aux investissements », inflow without category | none |
| Proposed | an outflow without category, its inflow on a PEA, within 4 days | pending transfer, outflow in « Contributions aux investissements » | none |
| By hand | the same pair 20 days apart, paired from the picker or `pair_transfer` | confirmed transfer, outflow in « Contributions aux investissements » | none |
| Kept | the outflow already in « Épargne » | stays in « Épargne » | none |
| Deleted | the owner deleted the category, or every category | created again, `#0d9488`, `trending-up`, once for every outflow of the write | none |
| Other kinds | internal move, card or loan payment, PEA to PEA | no category written | none |
| Undone | the proposal rejected | the outflow keeps the category | none |
| Upgrade | a contribution paired before, without category, the household holding the category | migration 0093 gives it the category, origin `rule`, as Sure's backfill; nothing when the household has none | none |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb`: `app/models/transfer/creator.rb` (`outflow_transaction`), `app/models/family/auto_transfer_matchable.rb`, `app/controllers/transfer_matches_controller.rb` (`create`), `app/models/family.rb` (`investment_contributions_category`), `app/models/category.rb`, `config/locales/models/category/fr.yml`.
- `packages/api/src/services/default-categories.ts` -- exports `INVESTMENT_CONTRIBUTIONS_CATEGORY`, used in `DEFAULT_CATEGORIES`.
- `packages/api/src/services/ledger/transfers.ts` -- `categoryIdFor` from `feesCategoryId`, `categoriseContributions`, called by `createTransferBetween`, `matchTransfers`, `matchTransfer`.
- `packages/app/src/hooks/useTransfers.ts` -- `useMatchTransfer` refreshes the categories, which a pair may create.
- Tests: `services/ledger/transfers.spec.ts`, `services/ledger/transfers-create.spec.ts`, `packages/app/e2e/transfers.spec.ts`.
- `packages/data/drizzle/0093_contribution_categories.sql` -- Sure's backfill, tested in `packages/data/migrate.spec.ts`.
- `packages/api/src/mcp/transfers.ts` -- `pair_transfer`'s description; `useCreateTransaction`, `useConfirmImport`, `invalidateSynced` refresh the categories.
- Docs: `docs/architecture.md` AD-11 and AD-12, `docs/sure-parity.md` « Automatic « Investment contributions » category » and « Category of a transfer side ».

## Tasks & Acceptance

**Execution:**
- [x] `transfers.spec.ts`, `transfers-create.spec.ts` -- tests first: the matrix.
- [x] `INVESTMENT_CONTRIBUTIONS_CATEGORY`, `categoryIdFor`, `categoriseContributions` and its three callers.
- [x] `useMatchTransfer` invalidates the categories.
- [x] e2e: pair a contribution by hand and see its category on the row; the PEA drawer test starts from it.
- [x] AD-11, AD-12, parity rows, story, epic 31 and sprint status to done.

**Acceptance Criteria:**
- Given a transfer to an investment account created from « Virement », when it is saved, then its outflow is in « Contributions aux investissements ».
- Given a proposal or a pair by hand whose kind is `investment_contribution`, when it is written, then an outflow without category takes « Contributions aux investissements » and one with a category keeps it.
- Given a household without that category, when a contribution needs it, then it is created with `#0d9488` and `trending-up`.

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure:

- The category is looked up by its French name only: Sure's `all_investment_contributions_names` gathers its locales' names because a family's locale may change; Archant stores default names as French data (AD-12), so a renamed category is the owner's own and a new one is created, as Sure does once the name differs.
- The matcher writes `category_origin` `rule`: the category comes from Archant's own automatic classification, not from the bank; neither origin carries a lock, so nothing else differs.
- A category locked as empty by the owner still takes the contribution category, as Sure reads `category_id` alone, never `locked_attributes`.

## Spec Change Log

- Review finding (Blind Hunter): contributions paired before the upgrade keep no category, where Sure ships `BackfillInvestmentContributionCategories`. Amended, the frozen « Never » included, under the brief's rule that Sure settles what the unavailable owner would: migration `0093_contribution_categories.sql` gives each uncategorised contribution outflow the household's « Contributions aux investissements » when it has one, origin `rule`, as Sure's backfill, which skips a family without the category. Known-bad state avoided: old contributions under « Sans catégorie » beside new ones categorised. KEEP: the service code, its three callers and every test as built.

## Review Triage Log

First pass, `bmad-build` review (Blind Hunter, Edge Case Hunter, Verification Gap).

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | The matcher overwrites a category the owner cleared and locked | low | reject | Sure's `auto_match_transfers!` and `TransferMatchesController#create` read `category_id` alone, never `locked_attributes`; recorded in Design Notes. |
| 2 | `pair_transfer`'s description still says no category changes | low | patch | `mcp/transfers.ts` names the contribution category. |
| 3 | A typed line, an import or a sync that recreates the category leaves the client's categories stale, a row reading « Catégorie inconnue » up to 30 s | low | patch | `useCreateTransaction`, `useConfirmImport` and `invalidateSynced` refresh the categories; `useInvalidateAccount` is left alone, as sheet edits call it under an open picker. |
| 4 | AD-12 « Prevents » still promises no default category comes back | low | patch | It names the exception. |
| 5 | Contributions already paired keep no category | medium | patch | Migration 0093 with two `migrate.spec.ts` tests, as Sure's backfill; see Spec Change Log. |
| 6 | No test reads « Virement »'s `category_origin` | low | patch | `transfers-create.spec.ts` checks `user`. |
| 7 | No test for a crypto destination, `pair_transfer` or a bank sync | low | reject | The kind comes from `transferKindOf`, tested in `transfer-matching.spec.ts`; `pair_transfer` calls `matchTransfer` and a sync calls `matchTransfers`, both tested. |
| 8 | The new ledger tests depend on their order | false | reject | Each test that needs the category absent deletes it first. |
| 9 | The spec is missing from the diff | false | reject | Untracked planning file, reviewed apart. |
| 10 | One read and one update per chunk | low | reject | The read decides whether the category must be created at all, as Sure's lazy load. |
| 11 | Origin `user` without a category lock breaks « user goes with a lock » | low | reject | Fee lines from « Virement » already carry `user` without a lock; Sure locks neither. |
| 12 | A `maintenance` origin would throw in `categoryOriginOf` | false | reject | No caller of `createTransferBetween` or `matchTransfer` passes it. |
| 13 | The recreation and the client refresh are not exercised end to end | low | reject | The ledger tests cover the recreation; deleting a default category in the shared `chromium` database would disturb other specs. |

Second pass, `bmad-code-review`: the three layers above had already reported on this diff, so only its Acceptance Auditor ran.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Migration 0093 breaks the frozen « no migration » | low | patch | Sure ships the backfill; the frozen block and the matrix now say so, logged in the Spec Change Log. |
| 2 | AD-12 names migration 0093 | false | reject | Follows from 1, which stays. |
| 3 | « Undone » is tested on a confirmed pair, not a proposal | low | patch | The proposal test now rejects the pending transfer and checks the category stays. |
| 4 | « PEA to PEA » is tested as PEA to crypto | low | patch | Both pairs are tested. |
| 5 | Sprint status reads `review` while the spec reads `done` | low | patch | Set to `done` with Epic 31. |
| 6 | `pair_transfer`'s category origin is unproven | false | reject | `services/transfers.ts` `createTransfer` calls `matchTransfer` with `origin: "user"`, which the ledger test checks. |
