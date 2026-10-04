---
title: 'Story 22.2: Record trades'
type: 'feature'
created: '2026-10-04'
status: 'done'
baseline_commit: 'dedc1299293f0440190f37e14380b89aacc8bcfb'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An investment account holds securities, but Archant cannot record buying or selling one, so it never knows what the household holds.

**Approach:** `entries.kind` admits `trade`, with its columns in `trades`, written by `services/ledger/trades.ts`; an « Ordres » tab on an investment account lists, adds, edits and deletes buys and sells, the security picked from Story 22.1's search, from the securities already known, or typed by hand. Balances move by the trade's cash amount, and the export carries trades as Sure's. Story 22.2 of `epics.md` is the acceptance contract; this spec adds what reading the code and Sure settled. The owner authorised every decision below; each is an assumption the pull request lists.

## Boundaries & Constraints

**Always:**
- `trades`: `entry_id` (primary key, references `entries` `ON DELETE RESTRICT`), `security_id` (references `securities` `ON DELETE RESTRICT`, indexed), `quantity` (millionths, signed, never zero, positive for a buy), `price` (millionths of the major unit, `>= 0`, a free share being a real buy), `fee` (minor units, `>= 0`). `entries_valuation_kind_check` gains `kind = 'trade' and valuation_kind is null`; the migration rebuilds `entries` (drizzle-kit's table copy, every index and the self reference kept) and is tested on existing rows.
- Amount (AD-22, AD-5): `−(quantity × price + fee)` in `BigInt`, the product rounded half to even to the minor unit, as Sure's `signed_qty * price + fee` with AD-5's sign. A result past `MAX_MINOR_UNITS` is a `too_big` field error on `quantity`. Currency: the account's.
- Only an `investment` account takes a trade: any other is `409 NOT_AN_INVESTMENT_ACCOUNT`. Date after the opening date and not after today, as a snapshot (`not_after_opening_date`, `date_in_future`): the opening anchor fixes its own day.
- Quantity: after any create, edit or delete, the account's running quantity of that security, summed per day in date order, is never below zero, else `409 QUANTITY_UNAVAILABLE` and nothing is written. This refuses a sale above what is held on its date, and also an edit or a deletion that leaves a later sale short, where Sure's `CostBasisTracker` silently caps; holdings in 22.3 never go negative. The error carries `{ path: "quantity", code: "quantity_unavailable" }` for the form.
- Security choice, one of: `{ source: "known", id }`; `{ source: "listing", ticker, mic, name, currency, provider }` from search, found or created on `upper(ticker), coalesce(mic, '')` and stored upper-cased as Yahoo's symbol with its suffix (`MC.PA`), the only form a search returns, which settles the `MC`/`MC.PA` deferral; `{ source: "manual", isin?, name }`, a security with no provider and no ticker, reused when one without ticker has the same ISIN. The ISIN is optional, since a fonds euros has none; when given it passes ISO 6166's check digit. A manual security takes the account's currency; a listing without a currency takes it too, the price fetch then flagging a mismatch as 22.1 does. A known security or listing in another currency is a `currency_mismatch` field error on `security`. The security and the trade are written in the same immediate transaction.
- Edit changes side, date, quantity, price and fee, never the security, as Sure's drawer. Balances recompute from the earlier of the old and new dates; a deletion from its date.
- Balances: `bookedMovements` counts every entry that is not a valuation, a transaction only when booked; trades count as cash, nothing else changes until 22.3. `deleteAccount` deletes the account's `trades` before its entries.
- Search (`GET /api/securities?q=`) answers `{ enabled, known, items, unavailable }`: `known` the securities whose name, ticker or ISIN contains the text, case-insensitive, ten at most, read even when fetching is off; `items` the provider's listings not already known, without Yahoo's `INDEX` and `CURRENCY` quote types, which no account holds; a `PRICE_PROVIDER_ERROR` gives `items: []` and `unavailable: true` rather than failing the known part.
- `heldSecurities` returns each traded security from its first trade's date, as Sure's `MarketDataImporter` asks from an account's first trade, sold ones included since 22.3 values the past.
- Routes: `GET`, `POST /api/accounts/:id/trades` (paged as snapshots), `PATCH`, `DELETE /api/trades/:id`. Quantity and price cross as decimal strings, typed the French or English way; the record answers them as plain decimal strings. A viewer reads the list; writes are refused by `viewerReadOnly`.
- Export, as Sure's `data_exporter.rb`: `trades.csv` after `transactions.csv`, header `date,account_name,ticker,quantity,price,amount,currency`; a `Trade` line after `RejectedTransfer` with `id`, `entry_id`, `account_id`, `security_id`, `ticker`, `security_name`, `exchange_operating_mic`, `date`, `qty`, `price`, `amount`, `currency`, `created_at`, `updated_at`, and `archant: { isin, fee }`. Amount in Sure's sign, `qty` signed. A security without ticker writes its ISIN as `ticker`, else `null`, which Sure's importer skips. `trades` joins `EXPORTED_COLUMNS`; `securities` moves from a whole-table reason to per-column ones.
- Interface: « Ordres » tab (`?tab=trades`) on every investment account, beside « Soldes »; « Ajouter un ordre » there for an administrator; a dialog with « Achat » / « Vente », a security combobox (known, then provider listings, then « Saisir un titre manuellement » revealing ISIN and name; when fetching is off it says so and offers known securities and manual entry), date, quantity, unit price, fees. A row shows date, side, security, quantity × price and the amount through `<Money>`; an administrator opens it to edit or delete. A viewer sees the list, no button, rows that open nothing.

**Never:** no holdings, cash column or holdings value (22.3); no positions tab (22.4); no dividend, interest or conversion of a transaction (22.5); no trade on an import or a bank sync; no currency conversion; no request to Yahoo from the browser.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Buy | 10 at 612.40, fee 2.50, EUR | amount −6 126.50 €, quantity +10, balance −6 126.50 from its date |
| Sale | held 10, sell 4 at 650, fee 0 | amount +2 600.00 €, quantity −4 |
| Rounding | 3 at 0.333335 | product 1.000005 → 1.00 (half to even) |
| Oversell | held 10 on its date, sell 11 | `409 QUANTITY_UNAVAILABLE`, nothing written |
| Later short | buy 10 d1, sell 10 d5, sell 5 on d3 | refused; deleting the d1 buy refused too |
| Currency | known USD security on a EUR account | `400`, `security` `currency_mismatch` |
| Not investment | depository account | `409 NOT_AN_INVESTMENT_ACCOUNT` |
| Manual twice | same ISIN typed again | the first security reused |
| Search off | no `price_provider` row | `known` filled, `items: []`, no request |

</frozen-after-approval>

## Code Map

- `packages/data/schema/entries.ts:10,56` `ENTRY_KINDS`, checks -- add `trade`; new `schema/trades.ts`, `types.ts`, `package.json` `exports`; migration `0050` via `pnpm data generate --name add_trades`; `migrate.spec.ts` `migratedBefore` (263), `insertEntry` (42).
- `packages/data/micros.ts` -- add `readMicros` (French or English typed decimal, six decimals at most, `null` otherwise) and `formatMicros` (plain decimal string); `money.ts` `parseAmount`, `MAX_MINOR_UNITS`, `minorUnitsOf`.
- `packages/api/src/services/ledger/balances.ts:69` `bookedMovements` -- left join `transactions`, `kind != 'valuation'`; check `history-volume.spec.ts` plans.
- `services/ledger/snapshots.ts:101` `recordSnapshot`, `updateSnapshot`, `deleteSnapshot` -- the immediate-transaction pattern to copy into `services/ledger/trades.ts`; `accountWithOpeningDate`, `recomputeBalances`; `domain/balances/snapshot.ts` `snapshotRejectionFor` for the date rule; `ledger/shared.ts:20` `Origin`.
- `services/ledger/accounts.ts:95` `deleteAccount` -- delete `trades` first.
- `services/snapshots.ts`, `schemas/snapshots.ts`, `routes/accounts.ts:57`, `routes/snapshots.ts` -- service, two-stage Zod and route patterns; `packages/api/package.json` `exports` gains `./schemas/trades`.
- `services/securities.ts:52` `heldSecurities`, `:71` `searchSecurities`; `connectors/prices/yahoo.ts:119` `quoteSchema`, `price-provider.ts:13` `SecurityMatch`; `testing/prices.ts:11` `insertSecurity`.
- `lib/errors.ts` -- `QUANTITY_UNAVAILABLE` 409, `NOT_AN_INVESTMENT_ACCOUNT` 409; `.oxlintrc.json` ledger-only tables gain `trades`.
- `routes/middleware/roles.spec.ts:154` writes list and count.
- `services/ledger/export.ts:34` `EXPORTED_COLUMNS`, `:215` `LEFT_OUT`, `:420` `transactionPage`; `services/export.ts:135` `decimal`, `:143` `sureAmount`, `:372` `sureFrom`, `:565` `allNdjson`, `:1022` parts.
- `packages/app/src/routes/_authed.accounts.$accountId.tsx:53` `ACCOUNT_TABS`, `SnapshotsPanel` (192) -- the tab pattern; `components/SnapshotDialog.tsx`, `SnapshotList.tsx`, `hooks/useSnapshots.ts`, `useInvalidateAccount.ts`, `lib/query-keys.ts`, `MerchantCombobox.tsx` (cmdk), `ChoiceField`, `DateField`, `lib/form-errors.ts`, `locales/fr.json`.
- `packages/app/e2e/snapshots.spec.ts:85` (PEA), `fixtures.ts:174` `apiHelpers`, `viewer.spec.ts:141`, `investments.spec.ts` (`page.route` for `/api/securities`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/micros.spec.ts`, `micros.ts` -- `readMicros`, `formatMicros`, every branch.
- [x] `packages/data/schema/entries.ts`, `schema/trades.ts`, `types.ts`, `package.json`, migration, `migrate.spec.ts` -- rebuild tested on a transaction, a valuation and a split child; a trade accepted; `.oxlintrc.json`.
- [x] `packages/api/src/domain/trades.spec.ts`, `domain/trades.ts` -- `tradeAmount`, `firstShortfall` (running quantity per day), `isValidIsin`.
- [x] `services/ledger/balances.ts`, `ledger/trades.spec.ts`, `ledger/trades.ts`, `ledger/accounts.ts` -- matrix rows, balances and snapshot gaps counting trades, account deletion with trades.
- [x] `schemas/trades.ts`, `services/trades.ts`, `routes/trades.ts`, `routes/accounts.ts`, `app.ts`, specs; `lib/errors.ts`; `roles.spec.ts`.
- [x] `services/securities.ts`, `connectors/prices/yahoo.ts`, specs and fixture -- `known`, quote types, `unavailable`, `heldSecurities` from trades.
- [x] `services/ledger/export.ts`, `services/export.ts`, specs -- `trades.csv`, `Trade` lines.
- [x] `packages/app` -- tab, `TradeDialog.tsx`, `TradeList.tsx`, `SecurityCombobox.tsx`, `hooks/useTrades.ts`, `useSecuritySearch.ts`, query keys, `fr.json`; `e2e/trades.spec.ts`, `fixtures.ts` `recordTrade`, `viewer.spec.ts`.
- [x] `docs/architecture.md` AD-22, `docs/sure-parity.md`, `EXPERIENCE.md` account tabs; `deferred-work.md` resolves 22.1's two items.

**Acceptance Criteria:**
- Given Story 22.2 of `epics.md`, when the story ships, then each of its criteria holds, with the revisions this spec records.
- Given a PEA, when the owner records a buy then a sale from « Ordres », then the rows show them and the balance moved by both amounts.
- Given a viewer on an investment account, when they open « Ordres », then they see the trades and no « Ajouter un ordre ».

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, `micros.ts` and `domain/trades.ts` at 100% of branches
- `pnpm test:e2e` -- expected: green

## Implementation Notes

- A security with neither a ticker nor an ISIN, such as a fonds euros, writes its name as `ticker` in `trades.csv` and `all.ndjson`, rather than `null`. The frozen text assumed Sure skips a null ticker; its importer would, but `SureImport::Preflight` lists `ticker` among the `Trade` line's `REQUIRED_FIELDS` and refuses a blank one, which fails the whole import (AD-23). With the name, no trade line is dropped and the archive keeps its cash movement in Sure.
- `all.ndjson` leaves out a trade dated before Sure's 29-year window (`sureFrom`), as it does a transaction: Sure's `Entry` refuses the date and the whole import with it. `trades.csv` keeps every trade.
- An unknown `{ source: "known", id }` is an `invalid_value` field error on `security`, the code a dangling id gets elsewhere in the ledger.
- The trade form reuses `createTradeSchema` for an edit, the security set to the trade's own as a known one, and sends only the side, date, quantity, price and fee: one schema for both modes.
- The search filters the known securities in JavaScript, case and accents aside: SQLite's `like` and `lower` fold ASCII letters only, and a household holds a few dozen securities.
- `insertSecurity` in `testing/prices.ts` holds the security by default, through a one-share buy on an investment account of its own, so the price specs keep fetching it now that only traded securities are fetched.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind | The « tie » rounding cases (3 at 0.333335, 3 at 0.333345) are no ties; truncation would pass them | medium | 100.0005 and 100.0035 cents; the only real tie, 5050.5, rounds down, as truncation would | patched: ties 1 at 0.015 and 1 at 0.025, both to 2 cents |
| blind | Each buy lowers an investment account's balance by its cost until 22.3 | false | The intent says balances move by the trade's cash amount in this story; holdings value is 22.3's | rejected; the pull request says not to release between 22.2 and 22.3 |
| blind | The security list hides a security's currency, refused only on submit | low | `detailOf` showed ticker and MIC only | patched: currency in the detail line |
| blind | `PATCH /api/trades/:id` ignores a `security` key | false | Every body schema in the API strips unknown keys; the edit never takes a security by design | rejected |
| blind | A bank-linked investment account would count a typed trade twice | false | `LINKABLE_TYPES` excludes `investment`: no investment account is ever linked | rejected |
| blind | A fully sold security keeps being fetched every day | low | The frozen decision, as Sure's `MarketDataImporter`; the provider learns a security once held | rejected |
| blind, edge | A security typed again by ISIN keeps its first name | low | Reuse by ISIN is the intent; the search shows the stored name before a manual entry | rejected |
| edge | A manual ISIN matching a listing creates a second security | false | A listing is created from search without ISIN, so no listing carries one in this story | rejected |
| edge | A manual ISIN stored in another currency is refused | low | A security has one currency (AD-6); refusing is the rule | rejected |
| blind | The export reads every trade at once | low | As `exportedTransfers`; a household's trades are hundreds at most, and the archive itself still streams | rejected |
| blind | No plan assertion on `bookedMovements` after its left join | false | `EXPLAIN QUERY PLAN` on a migrated database: `SEARCH entries USING INDEX entries_account_date`, then the `transactions` primary key; the volume project passes | rejected |
| blind | The trade table shows no fee | low | Sure's row shows none either; the amount includes it | rejected |
| blind | Manual entry drops the text typed in the search | low | Every manual entry meets it; one assignment fixes it | patched: name, or ISIN when valid, prefilled |
| blind | `sprint-status.yaml` and the spec disagree on status | false | Workflow state between steps; both reach `done` at finalisation | rejected |
| blind, edge | `holdSecurity` builds 29 February of a common year | low | Year minus one on the text | patched: `addDays(date, -365)` |
| edge | A trade on a security with neither ticker nor ISIN is dropped from all.ndjson | medium | The archive lost its cash in Sure | patched: ticker falls back to the name, never dropped |
| edge | A trade bought before Sure's 29-year window and sold after imports as a negative holding | low | Needs a buy older than 29 years | rejected |
| edge | A server error on `security.name` of a listing lands on an unrendered field | low | Needs a Yahoo name over 200 characters | rejected |
| edge | An API body can store `MC` on XPAR beside `MC.PA` | maybe-false | Only a hand-written API call does; the interface sends Yahoo's symbol | deferred |
| verification-gap | No test shows a refused deletion in the interface | medium | The `catch` of `remove()` ran in no test | patched: end-to-end test |
| verification-gap | The « Yahoo Finance ne répond pas » notice is never shown in a test | medium | The mocked search always answered `unavailable: false` | patched: end-to-end step |
| verification-gap, spec | A stored listing vanishes from both groups when the text matches Yahoo but not the database, or when over ten known securities match | medium | `items` was filtered against the whole table, `known` by text and capped at ten | patched: filtered against the returned `known` only |
| standards | `QUANTITY_UNAVAILABLE` carries `fields`, which AD-15 keeps for `VALIDATION_ERROR` | low | The only other code with `fields` | patched: no `fields`; the form places the code on the quantity |
| standards | `schemas/trades.ts` imports `domain/`, which AD-15 forbids | low | `schemas/rules.ts` and `schemas/transactions.ts` already do | deferred |
| standards | The confirmation button says « Supprimer » alone | low | EXPERIENCE.md wants verb and object | patched: « Supprimer l'ordre » |
| standards | EXPERIENCE.md's combobox row omits the security picker | low | AGENTS.md edits a convention in place | patched |
| standards | `SIDES` repeats `TRADE_SIDES` | low | Two sources for one list | patched |
| standards | Investment check and « No trade has this id » written in the service and the ledger | low | The service needs the currency before parsing; the ledger checks inside its transaction, as snapshots | rejected |
| standards | Other smells: `TradesPanel` mirrors `SnapshotsPanel`, focus code mirrors `SnapshotDialog`, data clump of quantity, price and fee, names `found` and `numbersIn`, `heldSecurities` delegating, a mechanism comment in `isValidIsin` | low | Judgement calls that follow existing files' shapes | rejected |
| spec | `origin` is taken and not stored | false | Every ledger write does the same; `epics.md` asks for the parameter | rejected |
| spec | The off notice appears only once the owner types | low | The search needs text; the notice shows with the first answer | rejected |
| spec | Known securities fold accents too | low | Recorded in Implementation Notes | rejected |
| spec | `?tab=trades` on another account falls back; its list answers an empty page | false | Neither is excluded by the spec; both are safe | rejected |
