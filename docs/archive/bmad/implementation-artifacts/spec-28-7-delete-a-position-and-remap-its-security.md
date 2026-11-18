---
title: 'Story 28.7: Delete a position and remap its security'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: '2097b172a7a820e5b240c22e309aa2120fa45c0b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A position recorded under the wrong security can only be fixed by deleting and re-entering every trade; Sure (`00dd977fb`) deletes a holding with its trades (`HoldingsController#destroy`, `Holding#destroy_holding_and_entries!`) and moves a holding's trades to another security (`HoldingsController#remap_security`, `Holding#remap_security!`) from its drawer.

**Approach:** Two admin writes on a position, `DELETE /api/accounts/:id/holdings/:securityId` and `PATCH /api/accounts/:id/holdings/:securityId/security`, each rewriting the account's trades of that security in one transaction and recomputing balances and holdings; the sheet offers them as Sure's drawer does.

## Boundaries & Constraints

**Always:**
- Delete removes every `trades` row of that security on the account and its `entries` row, buys, sales and dividends alike, as Sure deletes every `Trade` entry of the security (dividends are trades there too). A converted transaction's parent comes back as `deleteTrade` brings it back: `excluded: false`, the exclusion locked by the origin. The account's `cost_basis_locks` row for that security goes with it, since no zero day would otherwise end it.
- Remap moves every trade of the old security on the account to the new one with one `update`; holdings merge by themselves because the recompute derives them. A lock on the old security moves to the new one when the new one has none, else it is dropped, as Sure's merge keeps the existing row's cost basis. The old security and its prices stay (AD-22).
- The new security is picked with `SecurityCombobox` (known securities and provider listings) and resolved by `resolveSecurity`, so a new listing is written in the same transaction and a security in another currency is refused with `currency_mismatch` on `security` (AD-6). Remapping to the same security writes nothing and answers 200, as Sure's early return.
- Both writes recompute once with `recomputeBalances` from the earliest trade date involved: the old security's for delete, the earlier of the old and the new security's on the account for remap. Rows are selected by subquery on account and security, never by an id list held in memory.
- Sheet layout follows Sure's drawer: in « Aperçu », a « Titre » row with the ticker, else the name, and a pencil button named « Modifier le titre » that opens an inline form, « Rechercher un titre », with « Annuler » and « Enregistrer »; after « Ordres », a « Paramètres » section with « Supprimer la position », « Cela supprimera la position et toutes vos transactions boursières associées sur ce compte. Cette action ne peut pas être annulée. » and a « Supprimer » button, confirmed by `ConfirmDialog` in Sure's localised defaults: « Êtes-vous sûr ? », « Cette action ne peut pas être annulée. », « Confirmer ». On success the sheet closes, as Sure redirects to the account, with Sure's notices as toasts: « Position supprimée », « Titre mis à jour avec succès. ».
- A viewer sees neither control (`canWrite`); `viewerReadOnly` refuses both methods with 403 `FORBIDDEN`.
- AD-22 in `docs/architecture.md` and the Investment row of `docs/sure-parity.md` change with the code.

**Never:** no « Saisir un titre manuellement » choice in the remap (Sure offers provider results only); no price fetch triggered by a remap, the new listing is priced by the next daily run or the button, as any new security; no `reset_security`, provider security or `security_locked` (no investment account is linked); no MCP tool; no migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delete | 2 buys, 1 sale, 1 dividend of S | 200; no trade of S, no holding of S, balance recomputed | none |
| Delete converted | a buy converted from a transaction | parent transaction no longer excluded | none |
| Delete locked | lock on S | lock row gone; a later buy of S reads the calculated basis | none |
| Delete absent | no trade of S on the account | nothing written | 404 `NOT_FOUND` |
| Remap to new listing | trades of S, choice a listing not stored | security inserted, trades on it, holdings of S gone | none |
| Remap merge | account holds S (10) and T (5) | one position T at 15, cost basis from all buys | none |
| Remap lock | lock on S, none on T | lock now on T | none |
| Remap same | choice resolves to S | nothing written | 200 |
| Remap currency | T in USD, account in EUR | nothing written | 400 `currency_mismatch` on `security` |
| Viewer | either method | nothing written | 403 `FORBIDDEN` |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger/trades.ts:259` -- `resolveSecurity`: export for the remap; `deleteTrade:546` is the single-trade model to follow (parent restore, `recomputeBalances`, `behavior: "immediate"`).
- `packages/api/src/services/ledger/holdings.ts` -- add `deletePosition` and `remapPosition` beside `lockCostBasis`/`unlockCostBasis`; do not reuse `heldToday`, a short position may be deleted or remapped.
- `packages/api/src/services/ledger/balances.ts:307` -- `recomputeBalances`, the only writer of `holdings`; `recomputeHoldings` stays private.
- `packages/api/src/services/holdings.ts` -- service wrappers beside `setCostBasis`, `NOT_FOUND` through `notHeld()`.
- `packages/api/src/schemas/trades.ts` -- export the security choice schema (only `SecurityChoiceInput` is exported) for a body `{ security }`.
- `packages/api/src/routes/accounts.ts:88-124` -- the two routes beside the cost basis routes, `validated("json", …)`, `{ data }`.
- `packages/data/schema/holdings.ts` -- `cost_basis_locks` PK `(account_id, security_id)`; `trades.security_id` restricts, nothing blocks the update.
- `packages/app/src/components/PositionSheet.tsx` -- « Titre » row in « Aperçu », « Paramètres » section last, both behind `canWrite`; `ConfirmDialog` call as `TradeDialog.tsx:428`; `SecurityCombobox` from `components/SecurityCombobox.tsx` without the manual choice (add a prop to leave it out).
- `packages/app/src/hooks/useHoldings.ts` -- `useDeletePosition`, `useRemapPosition`, invalidating as `useInvalidateTrades` in `hooks/useTrades.ts:34` (balances and transactions move too).
- `packages/app/src/routes/_authed.accounts.$accountId.tsx:768` -- the sheet closes when the position leaves the refreshed holdings; close it explicitly on success.
- `packages/app/src/locales/fr.json:850` -- `positions.sheet.security`, `positions.remap.*`, `positions.delete.*`; reuse `trades.security.search`, `common.cancel`.
- `docs/architecture.md:215-219` AD-22; `docs/sure-parity.md:64` drop « Later. Story 28.7 », describe both writes as Parity.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/ledger/holdings.spec.ts` -- every matrix row but the viewer, through `useLedgerDatabase()`, failing first.
- [x] `services/ledger/holdings.ts`, `services/ledger/trades.ts`, `services/holdings.ts` -- `deletePosition`, `remapPosition`, export `resolveSecurity`.
- [x] `packages/api/src/routes/accounts.spec.ts` -- both routes: 200 shapes, 404, `currency_mismatch`, viewer 403 (pattern at 2049-2075); then `schemas/trades.ts`, `routes/accounts.ts`.
- [x] `hooks/useHoldings.ts`, `SecurityCombobox.tsx`, `PositionSheet.tsx`, `fr.json` -- the controls and toasts.
- [x] `packages/app/e2e/positions.spec.ts` -- delete one position after confirming, remap another onto a known security and find one merged row; `e2e/viewer.spec.ts:267-279` and `~590-612` -- no « Modifier le titre » or « Supprimer », `DELETE` refused with 403.
- [x] `docs/architecture.md`, `docs/sure-parity.md` -- AD-22 and the Investment row.

**Acceptance Criteria:**
- Given a deletion or a remap, when it commits, then « Positions », the balance chart and `get_holdings` read the recomputed rows with no reload of the page.
- Given a remap failing on currency, when the form shows the refusal, then the field error names it and the sheet stays open.

## Implementation Notes

- Both routes answer `{ data: { securityId } }`: the security deleted, or the one the trades are now in. Another account type is refused with `NOT_AN_INVESTMENT_ACCOUNT`, as the cost basis lock is.
- `listedSecurityChoiceSchema` in `schemas/trades.ts` refuses a hand-typed security at the route, and its output type bounds the ledger's `remapPosition`.
- A lock already ended by a day at zero is deleted, for both securities, before a remap moves the live one: kept, it would come back on a merged history that never reaches zero.
- `SecurityCombobox` takes `manual={false}`; its notices then drop « et la saisie manuelle » (`trades.security.offKnown`, `unavailableKnown`, `failedKnown`), a mismatch the visual check found.
- The confirmation button keeps the default colour, as Sure's generic dialog; Archant's other deletions use a red one.
- `e2e/positions.spec.ts` reads the last price as the sheet's second figure, « Titre » being first; the viewer route test joined the existing viewer block, since `addViewer` creates one email per database.

## Spec Change Log

## Review Triage Log

| Source | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| edge-case | Remap moves a source lock already ended by a zero day; it revives on the merged history | medium | `liveCostBasisLocks` derives the end from holdings; a merged history without a zero day ends nothing | patch: ended locks of both securities deleted before the move, tests |
| edge-case | A target's ended lock blocks the source's live lock, and may revive | medium | the `not exists` checked any row, ended or not | patch: same fix |
| edge-case, blind | Remap form stays open after Escape and reopening the same position | low | `remapping` was reset by « Annuler » only | patch: reset on close |
| edge-case | Delete answering 404 from another tab leaves the stale sheet open | low | rare; the toast reads « Cette ressource n'existe pas. » and the next refetch closes the sheet; fix adds a branch | rejected |
| blind | Ledger `remapPosition` accepts a `manual` choice the route refuses | low | the type allowed it, AD-22 says never typed by hand | patch: typed on `listedSecurityChoiceSchema` |
| blind | `_options` unused in `remapPosition` | low | direct deletion | patch |
| blind, verification-gap | `investmentAccount` duplicates `trades.ts:100` | low | identical text | patch: exported and reused |
| blind, verification-gap | `stampedLocks` in bulk where `deleteTrade` uses `lockedBy` | false | `lockedBy` merges one row's JSON in memory; a subquery update needs SQL `json_set`, the test proves earlier locks are kept | rejected |
| blind | AD-22 omits that only `origin: "user"` locks the exclusion | false | AD-22 says « as `deleteTrade` brings it back », which locks by origin | rejected |
| blind | Entry deletion removes any trade entry of the account without a `trades` row | false | the ledger writes both rows in one transaction and `trades.entry_id` restricts, so no orphan exists; entries cannot go first | rejected |
| blind | Route specs miss the PATCH 404, the manual body's code and path, the viewer PATCH code | medium | the money path is covered in the ledger spec, the route contract was not | patch: tests |
| blind | Remap branches untested: non-investment account, unknown known id, short position, earlier target | medium | money paths are covered to the branch | patch: tests |
| blind | Recomputing from the target's first trade widens the recompute for nothing | false | the frozen intent asks for the earlier of both; the result is the same, only the cost | rejected |
| blind | No test reads `get_holdings` and the chart after a write without reload | low | both read the recomputed tables; the hooks invalidate the account queries through `useInvalidateTrades`, as every trade write | rejected |
| blind | Generic confirmation labels kept under `positions.delete` rather than `common` | low | no second user of them yet | rejected |
| blind | Spec `in-review` while sprint status says `in-progress` | false | the workflow sets both to `done` at completion | rejected |
| verification-gap | The delete confirmation's failure path has no test | low | defensive, rare; an e2e forcing a refusal costs more than it protects | defer |

## Design Notes

The epic's criterion put Sure's subtitle in the confirmation dialog. Sure's drawer shows it on the « Paramètres » row and confirms with the generic dialog, whose French defaults are in `layout.shared.confirm_dialog`; Sure's JavaScript overrides them in English, a bug not followed. Sure's « holding » becomes « position », its « l'holding » being a mistranslation.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- clean, knip finds nothing unused.
- `pnpm test` and `pnpm test:e2e` -- pass.

**Manual checks (if no CLI):**
- Screenshot the sheet with the remap form open, the « Paramètres » row and the confirmation, light and dark; and « Positions » after a merge.
