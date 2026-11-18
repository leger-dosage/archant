---
title: 'Story 22.5: Dividends, interest, and lines that are trades'
type: 'feature'
created: '2026-10-04'
status: 'done'
baseline_commit: '29845c44418c45a558c0b4a9cbca45e50ca4e350'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A dividend or the interest a broker pays can only be typed as an ordinary transaction, and a broker's statement imported as transactions never becomes trades, so an investment account's history does not read as the broker's and its holdings ignore the imported buys.

**Approach:** « Dividende » and « Intérêts » join « Achat » and « Vente » in the trade form, as trades of quantity zero, as Sure's `Trade::CreateForm`, and count as income in reports, where Sure counts no trade. A transaction on an investment account converts to a trade as a split parent whose only child is the trade (AD-20). Story 22.5 of `epics.md` is the acceptance contract; this spec adds what reading the code and Sure settled. The owner authorised every decision below; each is an assumption the pull request lists.

## Boundaries & Constraints

**Always:**
- Schema (`trades`, rebuilt by migration `0053`, tested on existing rows): `income_kind` text, null for a buy or a sale, else `dividend` or `interest` (`INCOME_KINDS` in `@archant/data`); `security_id` nullable. Checks: quantity is zero exactly when `income_kind` is set; an income trade has price and fee zero; only an `interest` has no security. The entry's amount of an income trade is above zero (AD-5: money in), checked by the ledger.
- API side values become `buy`, `sell`, `dividend`, `interest` (the field keeps its name `side`). An income trade is `{ side, security: { source: "known", id } | null, date, amount }`: a dividend needs a security, an interest takes none for the account's cash. The security must have a buy on this account dated on or before the trade's date, else `not_held` on `security`, as Sure offers the account's holdings only. An edit changes date and amount, never the security or the kind; a buy and a sale never become income.
- Income trades only move cash: holdings, `heldSecurities`, the positions' `priceDate` and the quantity check read trades with a quantity, as Sure's `PortfolioCache` drops quantity-zero trades.
- Reports (AD-9): an income trade on a counted account counts as income, uncategorised, in `cashFlowByCategory` and `cashFlowByMonth`, hence in the month's breakdown, the budget's actual income and the history. A buy or a sale never counts.
- Conversion: `POST /api/transactions/:id/trade` takes `{ side, security, quantity, price }` for a buy or a sale and `{ side, security }` for income. The trade takes the transaction's date and amount exactly; a buy or a sale's fee is what is left, `-amount - quantity × price` for a buy and `quantity × price - amount` for a sale, refused below zero with `amount_mismatch` on `price`. A buy needs a transaction at or below zero, a sale at or above zero, income above zero, else `sign_mismatch` on `side`. `NOT_CONVERTIBLE` (409, new) for a transfer side, a pending, excluded or possible-duplicate row, a split parent or child; `NOT_AN_INVESTMENT_ACCOUNT` elsewhere; date, currency and quantity rules as a trade.
- The trade entry's `parent_entry_id` names the transaction (AD-20 reused): the transaction keeps its keys, gets `excluded` true and locked, and every reader that drops a split parent drops it, so balances count the trade alone and a re-import writes nothing. `splitOf`, `editSplit` and `unsplitTransaction` answer `NOT_FOUND` for a converted transaction; `splitTransaction` refuses it as a parent.
- Deleting a converted trade undoes the conversion: the transaction comes back, `excluded` false and still locked, as an unsplit. An edit of it that moves its date or amount is `TRANSACTION_SPLIT`. Deleting the transaction by any path deletes its trade first; `deleteSplitChildren` deletes `trades` rows, and a deletion that leaves a later sale short is `QUANTITY_UNAVAILABLE`.
- A transfer side is never converted, so a contribution matched as a transfer keeps its inflow as a transaction counted in the cash (AD-11).
- Export: `income_kind` joins `EXPORTED_COLUMNS`. Every `Trade` line carries `investment_activity_label`, Sure's `Buy`, `Sell`, `Dividend` or `Interest`, and `archant.parent_entry_id`; an interest on cash writes Sure's `Security.cash_for` ticker `CASH-<ACCOUNT ID>` upper-cased and name `Cash`, `security_id` null; `trades.csv` writes the same ticker, quantity and price `0`. A converted transaction leaves `all.ndjson` as an excluded `Transaction`, as Sure's own conversion leaves it, and stays out of `transactions.csv`.
- Interface: the trade form offers four types; income shows « Titre » (the account's positions, « Liquidités » first for an interest), date and « Montant ». Rows show « Dividende » or « Intérêts », « Liquidités » for cash, no quantity × price. A converted trade opens read-only with « Annuler la conversion ». The transaction sheet of an investment account offers « Convertir en ordre » to an administrator when the row is convertible, opening a dialog with type, security, quantity, unit price and the computed fees. A viewer sees neither; `viewerReadOnly` refuses the route.

**Never:** no category on a trade (Sure dropped it); no « Frais » or transfer types; no conversion of several lines at once; no new trade kind in `holdings`; no change to the import or the bank sync.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Dividend | 12,34 € on a held fund | trade quantity 0, amount +12,34; cash +12,34; holdings unchanged; month income +12,34 |
| Interest on cash | 3,00 €, no security | ticker `CASH-…` in the export |
| Not held | dividend on a security never bought here | `400`, `security` `not_held` |
| Convert buy | −6 126,50 €, 10 at 612,40 | fee 2,50; cash unchanged, the holding's value added; transaction hidden and excluded; re-import `present` |
| Fee below zero | −6 000 €, 10 at 612,40 | `400`, `price` `amount_mismatch` |
| Wrong sign | +50 € as a buy | `400`, `side` `sign_mismatch` |
| Transfer side | matched contribution inflow | `409 NOT_CONVERTIBLE`; cash keeps it |
| Undo | delete the converted trade | transaction back, counted again |
| Delete parent | converted buy before a later sale | `409 QUANTITY_UNAVAILABLE` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/trades.ts`, `schema/entries.ts` (comment on `parent_entry_id`), `types.ts`; `pnpm data generate --name add_trade_income` (`0053`, a `__new_trades` rebuild); `data/migrate.spec.ts`.
- `packages/api/src/domain/trades.ts` -- `TRADE_SIDES` stays the sign; add the income kinds, `conversionFee`; `sideOf` keeps quantity's sign.
- `services/ledger/trades.ts` -- `recordTrade` (income branch), `updateTrade`, `deleteTrade` (undo), new `convertTransaction`; `listTrades`/`findTrade` left join securities and the parent's `transactions.label`; `tradedSecurities` and `refuseShortfall` with a quantity only.
- `services/ledger/balances.ts:209` `recomputeHoldings` reads trades with a quantity; `ledger/holdings.ts:199` `lastTrade` likewise.
- `services/ledger/shared.ts:127` `deleteSplitChildren` -- delete children's `trades`, return touched securities for a shortfall check; callers `deleteTransactionRows`, `edits.ts:417` bulk delete, `import-revert.ts:217`.
- `services/ledger/splits.ts:50` `splitRow`/`parentOf` -- a converted parent is not a split.
- `services/ledger/queries.ts:512,541` `cashFlowByCategory`, `cashFlowByMonth` -- add income trades; `domain/cash-flow.ts` doc.
- `schemas/trades.ts` -- discriminated create body, income branch, patch `amount`, `convertTradeSchema(currency, amount)`; `services/trades.ts`, `services/transactions.ts` (conversion entry), `routes/transactions.ts`; `lib/errors.ts` `NOT_CONVERTIBLE`; `roles.spec.ts` writes list.
- `services/ledger/export.ts:126,585`, `services/export.ts:491,495,825`, `testing/sure-preflight.ts:338`, export specs.
- App: `TradeDialog.tsx`, `TradeList.tsx`, `PositionSheet.tsx` `PositionTrades`, `TransactionForm.tsx` (beside `SplitBlock`), new `ConvertTradeDialog.tsx`, `hooks/useTrades.ts`, `locales/fr.json`.
- e2e: `trades.spec.ts`, new `e2e/conversions.spec.ts`, `viewer.spec.ts`, `fixtures.ts` `recordTrade`.
- Docs: `docs/architecture.md` AD-9, AD-20, AD-21, AD-22, AD-23; `docs/sure-parity.md`; `EXPERIENCE.md`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data` schema, migration, `migrate.spec.ts` -- checks accept income rows, refuse a zero-quantity buy and a security-less dividend.
- [x] `domain/trades.spec.ts`, `domain/trades.ts` -- `conversionFee`, every branch.
- [x] `services/ledger/trades.spec.ts`, `trades.ts` -- matrix rows at ledger level, undo, edits.
- [x] `shared.ts`, `splits.ts`, `edits.ts`, `import-revert.ts`, specs -- deletion paths, split functions on a converted parent, re-import `present`.
- [x] `balances.ts`, `holdings.ts`, `securities.ts` -- income trades out of holdings, specs.
- [x] `queries.ts`, `services/reports.spec.ts`, `routes/budgets.spec.ts` -- income counted.
- [x] Schemas, services, routes, errors, `roles.spec.ts`, route specs; AD-11 transfer case.
- [x] Export ledger, service, preflight, specs.
- [x] App components, hooks, locales; e2e specs.
- [x] Docs; `sprint-status.yaml` story and `epic-22` done.

**Acceptance Criteria:**
- Given Story 22.5 of `epics.md`, when the story ships, then each of its criteria holds, with the revisions this spec records.
- Given a PEA with an imported buy line, when the owner converts it from « Opérations », then it leaves « Opérations », appears in « Ordres » and « Positions », and its cash is unchanged.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, `domain/**` and `services/ledger/**` at 100%
- `until mkdir /tmp/archant-e2e.lock 2>/dev/null; do sleep 10; done; pnpm test:e2e; rmdir /tmp/archant-e2e.lock` -- expected: green

## Implementation Notes

- `deleteSplitChildren` returns the positions its trades moved, and `refuseShortfalls` checks them once every chunk of a deletion is gone: a first version checked inside each chunk, which refused reverting a large import whose converted buy and converted sale fell in two chunks.
- The API parses a conversion with `convertTradeSchema(currency, null)`, leaving the sign and the fee to the ledger, so a line it cannot convert is `NOT_CONVERTIBLE` whatever the body; the dialog passes the line's amount and reports both on the field.
- The e2e conversion imports a statement with its closing balance, as a broker's export carries it: the reconciliation fixes the total, so the header balance stays where it was. Without one, cash stays and the holdings' value is added.
- A dividend or interest counts in the month's « Sans catégorie » income, but the category drill-down lists transactions only, so it does not show there.

- `INCOME_KINDS` lives in `@archant/data/income-kinds`, a module without Drizzle, as `transfer-kinds.ts`, so the domain, the schemas and the interface read the one list.
- The rule that an income's security was bought by its date is checked when the income is written or moved. Deleting or moving the buy leaves the income, as Sure leaves it, and its amount stays editable.
- The trade form's income picker lists today's positions, as Sure's offers the account's holdings; the API also takes a security sold since, so a dividend paid after a full sale goes through the API only.

## Spec Change Log

- Review, iteration 0. Finding: the matrix row « Convert buy » and the second acceptance criterion said the balance is unchanged, while a converted buy keeps the cash and adds the holding's value, as every investment balance is `cash + holdings value` (AD-22). Amended: both now say the cash is unchanged; the owner delegated the story's decisions, so the frozen row was corrected with this entry. Known-bad state avoided: a test written to the old row would have asserted a wrong balance. KEEP: the trade takes the transaction's date and amount exactly.

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind, edge | « Balance unchanged » in the matrix contradicts the tests | low | Cash is unchanged and the holding is valued, as AD-22 says; the e2e header stays because its statement carries a closing balance | spec corrected (Spec Change Log) |
| blind | Spec tasks unticked, Code Map naming files the diff leaves alone | low | Workflow state before review | patched: ticked; notes updated |
| blind, edge, verification, spec | Deleting or moving the buy leaves a dividend on a security not bought by its date, then any edit of it fails `not_held` | medium | `updateTrade` re-ran `refuseIncomeSecurity` on every edit | patched: checked only when the income's date moves; test |
| edge, spec | A bulk delete or a revert whose converted buy and covering sale fall in two chunks is refused | medium | `deleteSplitChildren` checked the shortfall per chunk of 500 | patched: `refuseShortfalls` after every chunk; test that fails without it |
| blind, edge | `amount_mismatch` says quantity × price exceeds the amount, wrong for a sale | low | A sale's fee is negative when quantity × price is below the amount | patched: neutral wording |
| edge | The income picker says « aucun titre » while positions load or fail | low | `noPositions` showed whenever the list was empty | patched: loading and failure messages |
| blind, edge | The income picker lists today's positions, the API any security bought by the date | low | As Sure's form, which offers holdings | rejected; Implementation Notes |
| blind, spec | AD-9 says the drill-down and the reports agree, now that dividends count | low | The drill-down lists transactions only | patched: AD-9 says so |
| blind, verification | No revert path in the « by any path » refusal | medium | Only `deleteTransaction` and the bulk delete were asserted | patched: revert asserted |
| blind | Stale JSDoc above `recordTrade` in `e2e/fixtures.ts` | low | Two comments in a row | patched |
| blind, edge | `trades.csv` shows no activity for an income | low | Sure's `trades.csv` columns, which carry none; `all.ndjson` carries the label | rejected |
| blind, verification | No e2e converts a line into a dividend | medium | `conversions.spec.ts` converted a buy only | patched: e2e conversion into a dividend |
| spec | No Playwright test shows a dividend in the month's income | medium | Income counted in Vitest only | patched: same e2e reads « Revenus » on the dashboard |
| verification | No test reads `priceDate` after a dividend | medium | Removing `movesQuantity` from `lastTrade` failed nothing | patched: `currentHoldings` test |
| blind | Converted line's attachments and notes unreachable while converted | low | Undoing the conversion brings the line back with them | rejected |
| blind, spec | The converted trade's dialog is read only, the ledger takes a balanced edit | false | The frozen intent says it opens read only; the ledger rule only guards date and amount | rejected |
| standards | `INCOME_SIDES` repeats `INCOME_KINDS` | low | The convention wants one const array in `@archant/data` | patched: `@archant/data/income-kinds` |
| standards | `formatMoney` for the computed fee, `tradedSecurityId` typed as never null, duplicated branches between recording and converting, `TRANSACTION_SPLIT` reused, `convertTransaction` in `services/transactions.ts`, a `null` amount mode of `convertTradeSchema` | low | Judgement calls following existing files (`GoalsSection.tsx`, AD-20's same-rules wording, the split routes) | rejected |
| spec | `sure-parity.md` misses that Sure converts into a buy or a sale only | low | The row named the parent model only | patched |
