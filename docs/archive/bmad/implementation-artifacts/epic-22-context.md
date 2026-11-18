# Epic 22 Context: Investment holdings and prices

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A PEA or a brokerage account shows what it holds, at what average cost, and what it is worth today, valued from daily prices the owner allows Archant to fetch. Until now investment accounts are tracked by balance snapshots only; this epic follows Sure's model (trades as a third kind of entry, one holding per security and day computed forward, a weighted average cost without fees, a balance of cash plus holdings, a snapshot setting the total and moving the cash) and revises the « snapshots only » requirement for investment accounts. It departs from Sure deliberately: securities carry an ISIN; quantities and prices are fixed-scale integers; a buy is negative cash; a trade is in its account's currency; holdings are computed forward only, since investment accounts are never linked to a bank; prices come from Yahoo Finance (no key, covers Euronext Paris) through a port that stays off until the owner turns it on, fetched on the first visit of the day and by a button, never by a cron; a security with no provider is priced from its trades and typed prices; an account with no trade keeps working exactly as today.

## Stories

- Story 22.1: Securities and their prices
- Story 22.2: Record trades
- Story 22.3: Holdings and an investment account's value
- Story 22.4: See my holdings
- Story 22.5: Dividends, interest, and lines that are trades

## Requirements & Constraints

- A security is known by ISIN, ticker and venue (MIC), with a name, a currency and a provider; one without a provider, such as a fonds euros, is priced by hand.
- An outbound call that tells a third party about the household is off until the owner turns it on, the page says which host it reaches and that it learns the securities held, and it sends identifiers only, never an amount or a quantity. Off, search offers manual entry only and no request leaves the server.
- Prices are fetched since each held security's last stored day; a gap carries the last price, the last seven days are provisional and fetched again, and five failures in a row mark a security offline. A failure is logged without identifiers tied to amounts; the page shows the last update.
- Buys and sells carry security, quantity, price and fee; the entry amount is `−(quantity × price + fee)` rounded to the minor unit. A sale above the quantity held on its date is refused with `QUANTITY_UNAVAILABLE`. A listing in another currency than the account's is refused.
- Editing or deleting a trade, importing prices or adding a snapshot recomputes holdings and balances from the earliest date touched. An account with no trade: cash equals balance, holdings worth zero.
- With 100,000 transactions and ten years of daily prices for twenty securities, recomputing after a day's prices stays under one second (volume project).
- Dividends and interest are trades of quantity zero, positive, on a held security or on cash, and count as income in reports.
- Money is integer minor units with an ISO 4217 code, never a float. Every input is parsed by Zod, provider responses included. No test reaches Yahoo: recorded responses only. Every acceptance criterion has a test, Playwright for the interface, Vitest for the rest; the holdings calculator's branches are all covered.
- Every visible string goes through i18next in French; pages are keyboard-usable and meet WCAG 2.2 AA contrast. A new dependency needs a reason in the pull request.

## Technical Decisions

- Scale (AD-22): quantities are integers in millionths of a unit, prices integers in millionths of the currency's major unit, read by helpers in `@archant/data` beside `money.ts`. A value is `quantity × price` computed in `BigInt`, rounded half to even to the currency's minor unit.
- Tables: `securities (id, isin, ticker, mic, name, currency, provider, offline, created_at)`; `security_prices (security_id, date, price, currency, provisional, source)` unique on `(security_id, date)`; `entries.kind` admits `trade`, with `trades (entry_id, security_id, quantity, price, fee)`, quantity signed, positive for a buy; `holdings (account_id, security_id, date, quantity, price, amount, cost_basis)`; `balances` gains `cash`. Enumerations are `text` with check constraints from `const` arrays in `@archant/data`; ids UUID v4 text, dates `YYYY-MM-DD`, timestamps epoch milliseconds.
- Single writer (AD-2): `services/ledger/trades.ts` writes trades with an `origin`, in one immediate transaction that recomputes balances; `holdings` is derived and written by the ledger only. Foreign keys to `entries` are `ON DELETE RESTRICT`.
- Layering (AD-1): `domain/holdings/forward.ts` is pure (Sure's `ForwardCalculator` and `CostBasisTracker`): one holding per security and day from the first trade to today, price from the provider, else the latest trade or typed price, carried over gaps. Routes call one service function.
- Balance (AD-5, AD-8, AD-22): an investment account's stored balance is `cash + holdings value`, `balances.cash` the first term; a valuation sets the total and cash becomes total less holdings value, as Sure's `base_calculator.rb`. Readers still go through `balanceOn`.
- Price port: `connectors/prices/` is a port apart from the bank connector port, declaring `searchSecurities` and `dailyPrices`; its only adapter, `connectors/prices/yahoo.ts`, uses `fetch` and Zod and maps Euronext venues as Sure's `yahoo_finance.rb`. Connectors never touch the database and throw sanitised `AppError`s. The daily fetch rides the first signed-in request of the day in `APP_TIMEZONE`, beside the request, as the bank sync does (AD-18); no queue, no cron.
- Logs (AD-14) carry only ids, counts, durations and error codes, never a provider response.
- Converted transaction (AD-20, AD-22): a transaction turned into a trade becomes a split parent whose only child is the trade: excluded, locked, out of every balance and report, keeping its deduplication keys so a re-import writes nothing. A transfer side is never converted; a matched contribution's inflow stays a transaction counted in cash (AD-11).
- Export (AD-23): trades leave in `trades.csv` and `all.ndjson` as Sure's exporter, each `Trade` and `Holding` line naming its security by ticker, name and MIC with its ISIN under `archant`, since Sure's `all.ndjson` has no `Security` line; every new table and column goes in `EXPORTED_COLUMNS` or `LEFT_OUT`, or the export spec fails.
- Assistants (AD-19): `get_holdings` is a read tool calling the same service as the page, quantities, prices and amounts as decimal strings.
- Roles (AD-21): every write is a mutating method, refused to a viewer by `viewerReadOnly`; no `GET` writes, including the price refresh.
- `docs/security-model.md` names the new host, what it learns and how to keep it off.

## UX & Interaction Patterns

- « Réglages › Placements » at `/settings/investments` holds the price-fetching switch with its disclosure, « Mettre à jour les cours » and the last update. A viewer sees Sécurité only in settings.
- Trade form on an investment account: « Achat », « Vente », then « Dividende » and « Intérêts »; the security comes from search or is created offline by ISIN, name and currency.
- An investment account with trades gains a « Positions » tab beside Opérations, Soldes and Imports: each security with name and ticker, weight, « PRU », value and quantity, « +/- value latente » in amount and percent, then a « Liquidités » row, as Sure's holdings table.
- Opening a position shows a sheet, as Sure's holding drawer: last price and date, its trades, « Saisir un cours » for an offline security, and a cost basis the owner can set and lock. Sheets open no dialog except a confirmation.
- Tables are real tables with header cells. Money renders through `<Money>`; balances and totals are never coloured.

## Cross-Story Dependencies

- Stories go in order, 22.1 to 22.5.
- 22.2 uses 22.1's search and offline securities; 22.3 reads 22.2's trades and 22.1's prices; 22.4 displays 22.3's holdings; 22.5 extends 22.2's trade form and reuses Epic 19's split parent model.
- 22.1 mirrors the first-visit daily sync of Epic 10; 22.2 extends the export of Epic 18; 22.4 adds a tool to Epic 16's assistants.
- Epic 21's goals read an investment account's balance, which now includes holdings.
