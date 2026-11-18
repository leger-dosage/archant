---
title: 'Story 28.11: Crypto accounts'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_commit: '9a15b4049ccac91609bee10fe2f3c40006bcc15b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant has no account for coins held on a platform or in a wallet. Sure `00dd977fb` has `Crypto` (`app/models/crypto.rb`): subtypes `wallet` and `exchange`, a stored `tax_treatment` (`taxable` by default, `tax_deferred`, `tax_exempt`), balance type `:investment` (`account.rb:716`), trades only where `supports_trades?`, that is on an `exchange`. Sure stores `trades.qty` and `holdings.qty` as `decimal(34,18)` and `trades.price` as `decimal(19,10)` (`db/schema.rb`), where AD-22 keeps millionths: a 10 € buy at 60 000 € saves 0.000167 BTC instead of 0.000166666666666667.

**Approach:** Add `crypto` to `ACCOUNT_TYPES` with `balanceType: "investment"` and its tax treatment in `accounts.details`; replace every `type === "investment"` gate by one of two predicates in `@archant/data`: holding securities (balance type `investment`, Sure's `Investment || Crypto`) or taking new trades (Sure's `supports_trades?`); raise quantities to Sure's 18 decimals and a trade's price to its 10, stored as decimal text, by migration.

## Boundaries & Constraints

**Always:**
- Order as Sure's `Accountable::TYPES`: `crypto` right after `investment` in `ACCOUNT_TYPES` and `ACCOUNT_KINDS`. Subtypes `wallet`, `exchange`, `subtypeOptional: true`.
- Words from Sure's `fr.yml`: the type « Cryptomonnaie » (`models/account/fr.yml`), the group « Cryptomonnaies » (`accounts.types_plural.crypto`); in the selects the long labels « Portefeuille crypto », « Plateforme d'échange crypto » and « Aucun », elsewhere the short « Portefeuille », « Plateforme d'échange », and « Cryptomonnaie » without subtype; « Traitement fiscal » with « Imposable », « Imposition différée », « Exonéré d'impôt », in that order, and under it Sure's `cryptos.form.tax_treatment_hint`: « La plupart des cryptomonnaies sont détenues dans des comptes imposables. Sélectionnez une autre option si elles sont détenues dans un compte fiscalement avantageux. » Both selects in the creation and edit dialogs.
- Details: `CryptoDetails` `{ taxTreatment }`, `TAX_TREATMENTS` in `account-types.ts`, stored on every crypto account, `taxable` when the request omits it; an unknown value is refused.
- `supportsTrades({ type, subtype })`: true for any investment account and a crypto `exchange`. It gates creating a trade and converting a transaction (AD-20), and the « Ordres » tab. Everything else in the trade path (editing or deleting a trade, holdings recompute, positions, cost-basis lock, delete and remap, `get_holdings`) gates on `holdsSecurities(type)`, balance type `investment`, so a crypto account switched from exchange to wallet keeps its trades and positions, as Sure's.
- `NOT_AN_INVESTMENT_ACCOUNT` becomes `TRADES_NOT_SUPPORTED`, Sure's API wording « Account does not support trades », and its French text follows.
- Tax-advantaged: `isTaxAdvantaged` takes the account (`type`, `subtype`, `details`): an investment subtype in `TAX_ADVANTAGED_SUBTYPES` as today, or a crypto account whose `taxTreatment` is `tax_deferred` or `tax_exempt`, as Sure's `Family#tax_advantaged_account_ids`. `cashFlowAccounts` (`services/reports.ts`) and `taxAdvantagedAccountIds` (`services/ledger/queries.ts`) both call it; net worth still counts them.
- Transfer kind as Sure's `Transfer.kind_for_account`: into a crypto or an investment account, `internal_move` when the outflow is either, else `investment_contribution`.
- Recurring detection skips crypto accounts as investment ones, Sure's #3565.
- `get_accounts` and the export write Sure's `Crypto`; the export's `accountable` carries `subtype` and `tax_treatment`; valuations named as an investment's, Sure's `Valuation::Name`.
- Tint `#737373`, lucide `BitcoinIcon`, Sure's `bitcoin`; `--type-crypto` in `styles.css` and DESIGN.md.
- Precision as Sure's `db/schema.rb`: `trades.quantity` and `holdings.quantity` 18 decimals with at most 16 integer digits, `decimal(34,18)`; `trades.price` 10 decimals with at most 9 integer digits, `decimal(19,10)`. `security_prices.price`, `holdings.price` and `cost_basis_locks.cost_basis` stay millionths, above Sure's four decimals; a day's last trade price carried into `holdings.price` rounds half to even to the millionth.
- Storage: those three columns become `text` holding a canonical decimal: no exponent, no `+`, no leading zero beyond one, no trailing fractional zero, `0` for zero, a leading `-` for a negative. An integer cannot hold them: 18 decimals overflow SQLite's 64-bit integer past 9.22 units, and 10 decimals overflow a JavaScript safe integer past 900 719 per unit, a Bitcoin in yen. `packages/data/decimals.ts`, beside `micros.ts`, brands `Quantity` and `TradePrice` and gives their `parse*`, `read*`, `format*` and scaled-`BigInt` helpers; every computation on them is in `BigInt`, never `Number`. SQL reads the sign from the text, zero as `= '0'` and a negative as `like '-%'`, through helpers in `services/ledger/shared.ts`: `movesQuantity`, the reads of `services/ledger/holdings.ts` and `services/ledger/trades.ts`, the partial index `holdings_not_held` (`quantity = '0' or quantity like '-%'`, the quantity still covered) and the checks of `trades` and `holdings`.
- Typed input: a quantity takes up to 18 decimals and a price up to 10, the French or the English way as `readMicros`; one more is refused, never rounded. `quantity × price`, a trade's amount and `conversionFee` stay exact in `BigInt`, rounded half to even to the minor unit (AD-22). A value or an amount past `MAX_MINOR_UNITS` is refused as today.
- Migration `0080`, after `0079`'s accounts, rebuilds `trades` and `holdings` and converts each millionths integer to its exact canonical text in SQL, no float on the way: every quantity and price reads back the same value, and holdings are not recomputed.
- The API, `get_holdings`, `trades.csv` and the `Trade` and `Holding` lines of `all.ndjson` write the canonical text as is, Sure's decimal. The interface shows up to 18 and 10 decimals, trailing zeros dropped, through `lib/trade-format.ts`.
- Edits: AD-6, AD-8, AD-9, AD-11, AD-20, AD-22 in `docs/architecture.md` name crypto where they name investment, and AD-22 states the new precision and the text storage; `docs/sure-parity.md` « Crypto » row to Parity, and the recurring row drops « Archant has no crypto account ».

**Never:** no crypto provider or sync, no bank link (`BANK_ACCOUNT_TARGETS` unchanged); no change to the precision of `security_prices.price`, `holdings.price` or a cost basis; no `Number` arithmetic on a quantity or a trade price; no `FUNDABLE_ACCOUNT_TYPES` change, Sure's goals take `Depository` and `Investment` only; no step-by-step creation (Story 28.16); no change to Yahoo's search.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Exchange created | « Plateforme d'échange crypto », 1 000 € | `details.taxTreatment` `taxable`; « Ordres » shown | none |
| Buy on exchange | 0.01 BTC at 50 000 €, fee 2 € | cash −502 €, position 500 €, balance unchanged | none |
| Buy on wallet | `POST /api/accounts/:id/trades` | refused | `409` `TRADES_NOT_SUPPORTED` |
| Convert on wallet | transaction → trade | refused | `409` `TRADES_NOT_SUPPORTED` |
| Exchange → wallet | subtype edited after a buy | « Ordres » hidden, position stays, trade editable | none |
| Tax-exempt | crypto `tax_exempt`, income 100 € | out of cash flow and list totals, in net worth | none |
| Transfer | checking → exchange 200 € | kind `investment_contribution` | none |
| Small buy | exchange, 0.000166666666666667 at 60 000 € | stored as typed; position 10,00 € | none |
| Large quantity | 12 345.123456789012345678 units | kept exactly | none |
| Too precise | quantity with 19 decimals, or price with 11 | refused | `400` `VALIDATION_ERROR` on `quantity` or `price` |
| Migrated | existing trade 1.5 at 612.4 | `"1.5"` and `"612.4"` after `0080`; balances and holdings unchanged | none |
| Bad treatment | `taxTreatment: "tax_advantaged"` | refused, as Sure's enum | `400` `VALIDATION_ERROR` |

</frozen-after-approval>

## Code Map

- `packages/data/account-types.ts:22-86,132-167` -- `ACCOUNT_TYPES`, `TAX_ADVANTAGED_SUBTYPES`, `isTaxAdvantaged`; add `CryptoDetails`, `TAX_TREATMENTS`, `supportsTrades`, `holdsSecurities`, the `*DetailsOf` guard on `taxTreatment`.
- `packages/data/schema/accounts.ts:41-62` -- constraints derive from `ACCOUNT_TYPES`; `pnpm data generate` writes `0079`, a table rebuild like `0078`.
- `packages/data/micros.ts` -- the model for `decimals.ts`; `Micros` stays for stored prices and cost bases.
- `packages/data/schema/trades.ts:34-60`, `schema/holdings.ts:102-125` -- `text` columns, checks and `holdings_not_held`; `0080` generated, then its data conversion written by hand.
- `services/ledger/shared.ts:145`, `services/ledger/holdings.ts:195,225,318,388,470`, `services/ledger/trades.ts:166` -- sign predicates on text.
- `domain/trades.ts:43-60`, `domain/holdings/forward.ts:90-103`, `domain/holdings/positions.ts`, `schemas/trades.ts:98-190`, `schemas/holdings.ts`, `mcp/holdings.ts`, `services/holdings.ts`, `services/trades.ts` -- `Quantity` and `TradePrice` through every computation.
- App: `lib/trade-format.ts`, `TradeDialog.tsx`, `ConvertTradeDialog.tsx`, `TradeList.tsx`, `PositionList.tsx`, `PositionSheet.tsx` -- input and display at the new precision.
- `packages/api/src/schemas/accounts.ts:513-616,735-745,796` -- crypto details schema, `DETAILS_BY_TYPE`, default `taxable`.
- Gates on `"investment"`: `services/trades.ts:45`, `services/ledger/trades.ts:103` (split into the two predicates), `services/ledger/balances.ts:342,374`, `services/ledger/holdings.ts:111,456,587,659`, `services/holdings.ts:160`, `services/recurring/series.ts:213`, `services/transactions.ts:840`.
- `lib/errors.ts` -- the code rename; `app/src/locales/fr.json` its text.
- `services/reports.ts:108-112`, `services/ledger/queries.ts:438-445` -- tax-advantaged by account; select `type`, `subtype`, `details` and filter with `isTaxAdvantaged`.
- `domain/transfer-matching.ts:83-104`, `mcp/accounts.ts:15-24`, `services/export.ts:85-150,861-905`, `testing/sure-preflight.ts:264-292` -- records, `tax_treatment`.
- App: `routes/_authed.accounts.$accountId.tsx:501-507` (tabs), `components/TransactionForm.tsx:301` (`ConvertBlock`), `CreateAccountDialog.tsx`, `EditAccountDialog.tsx` (a `CryptoFields` beside `LoanFields`), `lib/account-kinds.ts`, `lib/tint.ts:51-60`, `components/BalanceSheetSection.tsx:21-30`, `styles.css:56-63,131-138`, `locales/fr.json` (`dashboard.balanceSheet.types`, `accounts.subtypes`, `accounts.subtypeLongs`).
- Tests to model on: `routes/trades.spec.ts`, `services/ledger/trades.spec.ts`, `services/ledger/holdings.spec.ts`, `services/reports.spec.ts` (Story 28.5's pillar 3a case), `services/export.spec.ts`, `mcp/server.spec.ts`, `domain/transfer-matching.spec.ts`, `routes/accounts.spec.ts`, `e2e/trades.spec.ts:33,391`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/account-types.spec.ts`, `routes/accounts.spec.ts`, `routes/trades.spec.ts`, `services/ledger/trades.spec.ts`, `services/ledger/holdings.spec.ts`, `services/reports.spec.ts`, `domain/transfer-matching.spec.ts`, `services/export.spec.ts`, `mcp/server.spec.ts` -- every matrix row, failing first.
- [x] `packages/data/decimals.spec.ts`, `packages/data/migrate.spec.ts`, `domain/holdings/forward.spec.ts`, `schemas/trades.spec.ts` -- the precision rows of the matrix, the canonical form, the exact migration of existing rows, failing first.
- [x] `packages/data/account-types.ts`, then `pnpm data generate` -- type, details, predicates, migration `0079`.
- [x] `packages/data/decimals.ts`, the `trades` and `holdings` schemas, then `pnpm data generate` -- `Quantity`, `TradePrice`, migration `0080` with its conversion.
- [x] Every file of the Code Map that reads a quantity or a trade price -- `BigInt` throughout, sign predicates on text.
- [x] `schemas/accounts.ts`, `lib/errors.ts` and every gate of the Code Map -- the two predicates, the rename.
- [x] `services/reports.ts`, `services/ledger/queries.ts` -- tax-advantaged by account.
- [x] `domain/transfer-matching.ts`, `mcp/accounts.ts`, `services/export.ts`, `testing/sure-preflight.ts` -- the records.
- [x] App files of the Code Map -- dialogs, tabs, tint, labels.
- [x] `packages/app/e2e/trades.spec.ts` -- create an exchange through the dialog, record a buy of 0.000166666666666667 from « Ordres », read the position and the balance; a wallet has no « Ordres ».
- [x] `docs/architecture.md`, `docs/sure-parity.md`, DESIGN.md.

**Acceptance Criteria:**
- Given an instance with accounts, when migration `0079` runs, then every row survives and the constraint accepts `crypto` with `wallet`, `exchange` or no subtype.
- Given an instance with trades and holdings, when migration `0080` runs, then every quantity and price reads back the same value as canonical text, and the balances and holdings stored before match those computed after.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, and screenshots of both dialogs with the tax select and an exchange's « Ordres » and « Positions », light and dark, are reviewed.

## Implementation Notes

- The matrix row « Buy on exchange » reads « balance unchanged »; with a 2 € fee the balance falls by the fee, as Sure's (cash −502 €, position 500 €). The tests assert that.
- The creation dialog's crypto choice without subtype reads « Cryptomonnaie », as the investment one reads « Investissement »; « Aucun » is the edit dialog's.
- The matrix row « Exchange → wallet » reads « « Ordres » hidden »; review finding 4 keeps « Ordres » on an account that holds securities once it has traded, without the action that records a new trade, as Sure's activity feed lists a wallet's trades and hides only « Nouvelle activité ». Its trades stay editable in the interface.
- A cost basis typed by hand keeps millionths, so it reports `invalid_cost_basis` with its own text rather than the trade price's `invalid_price`, which now allows ten decimals.
- `get_holdings` returns the quantity as a JSON number read from the stored text, as Sure's `to_f`; the API, `trades.csv` and `all.ndjson` write the text.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Trade validation texts still say six decimals | medium | patch | `fr.json` `trades.errors.invalid_quantity` and `invalid_price` read « six décimales au plus » while the server takes 18 and 10; the typed-price text (`price.errors`) is right, prices stay millionths. |
| 2 | Cost basis per unit can pass a safe integer | medium | patch | `forward.ts` `toMicros(Number(position.costBasis))` throws when `(quantity × price + fee) / quantity` passes 2⁵³ millionths, reachable now that a quantity can be 10⁻¹⁸ with a 1 € fee; every recompute of the account then answers 500. A weighted average never passes its largest buy, so refusing that buy suffices. |
| 3 | Holding amount and summed quantity unbounded | medium | defer | A position's amount or a quantity summed past 16 digits throws in `forward.ts`; the same overflow existed with integer millionths past `MAX_SAFE_INTEGER`, so it predates the story. |
| 4 | A wallet that was an exchange hides its trades | medium | patch | « Ordres » is gated on `supportsTrades`, and `PositionSheet` lists trades without opening them, so the matrix's « trade editable » holds through the API only; Sure's activity feed still lists a wallet's trades and hides only « Nouvelle activité ». |
| 5 | No CHECK on the canonical text | low | reject | The ledger is the only writer, through `formatQuantity` and `formatTradePrice`; a GLOB check adds complexity for a write nobody makes. |
| 6 | Matrix « balance unchanged » and tracking out of step | low | reject | The fix edits this spec; the behaviour follows Sure (Implementation Notes), and tracking moves to `done` with the story. |
| 7 | Error rename needs `breaking-change` | false | reject | The interface translates the code; no self-hoster action is needed on upgrade, which is what the label announces. |
| 8 | Parity row hides Yahoo's `CCC` gap | low | patch | `docs/sure-parity.md` « Crypto » says Parity while a coin from the search has no venue or currency (Design Notes); a direct correction to the row. |
| 9 | A wallet's use is unexplained | false | reject | Sure's wallet without sync tracks value by valuations too; nothing in Sure's form explains it. |
| 10 | Code Map files untouched, `0080` pragmas | false | reject | `TradeDialog` and the lists send and show text through `trade-format.ts`, which changed; no table references `holdings`, so its rebuild needs no `foreign_keys` toggle. |
| 11 | Sub-millionth trade price values a holding at 0 | false | reject | The spec keeps `holdings.price` in millionths, above Sure's four decimals, which round the same price to 0. |
| 12 | Refusal message names exchanges on the holding path | low | patch | `tradesNotSupported` adds « (investment or crypto exchange only) » to Sure's « Account does not support trades », the spec's wording. |
| 13 | Tax treatment never set through a dialog in a test | medium | patch | Only `e2e/trades.spec.ts` opens the field, keeping « Imposable »; dropping `case "crypto"` from `chosenDetails` passes every test. |
| 14 | Conversion on an exchange untested in the interface | medium | patch | `conversions.spec.ts` opens a `pea` only; restoring `type === "investment"` in `TransactionForm.tsx` passes every test. |
| 15 | « Positions » after exchange → wallet untested | medium | patch | Grouped with 4: same screen, same fix. |

## Design Notes

Sure's activity feed hides « Nouvelle activité » on every crypto account (`activity_feed.html.erb:21`), so in Sure an exchange gets trades from sync, trade import or conversion only. Archant has neither sync nor trade import for coins, so the epic's criterion, « Ordres » on an exchange as on an investment account, follows `supports_trades?` and Sure's API (`api/v1/trades_controller.rb:44-48`) rather than that menu.

Quantities and trade prices are text rather than two integer columns or a scaled `blob`: SQLite compares and indexes text as is, the sign reads from its first character, Sure's own export writes decimals as text, and one canonical form makes equality exact. A stored price stays millionths: Sure keeps four decimals there, and raising it would rewrite every price row for no figure Sure shows.

Yahoo lists coins under exchange code `CCC`, which `EXCHANGE_MICS` does not map, so a coin from the search has no MIC and no venue currency; the e2e test types the security by hand, as `trades.spec.ts` does.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
