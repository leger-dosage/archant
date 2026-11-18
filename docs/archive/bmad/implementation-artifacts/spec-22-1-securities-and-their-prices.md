---
title: 'Story 22.1: Securities and their prices'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
baseline_commit: '028b705c6b9b2acf637945cbfd5fce26c1ec6397'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant has no notion of a security or a price, so an investment account can only be valued by typed snapshots.

**Approach:** Add `securities` and `security_prices`, a price port in `connectors/prices/` with a Yahoo Finance adapter (fetch and Zod, recorded fixtures), a setting that turns it on, a daily fetch riding the first signed-in request of the day plus a button, and « Réglages › Placements » at `/settings/investments`. Story 22.1 of `epics.md` is the acceptance contract; this spec adds what reading the code and Sure settled. The owner authorised every decision below; each is an assumption the pull request lists.

## Boundaries & Constraints

**Always:**
- Prices and quantities are integers in millionths (AD-22): `packages/data/micros.ts` exports `Micros`, `parseMicros(text)` (decimal string to millionths, half to even beyond six places, `null` when invalid or out of the safe range) and `divideHalfEven(numerator, denominator)` on `BigInt`.
- `securities`: `id`, `isin`, `ticker`, `mic`, `name`, `currency`, `provider` (`PRICE_PROVIDER_IDS = ["yahoo"]` or null), `offline`, `failed_fetch_count`, `first_price_on`, `created_at`, `updated_at`; unique on `upper(ticker), coalesce(mic, '')`, as Sure's. `security_prices`: `security_id` (cascade), `date`, `price`, `currency`, `provisional`, `source` (`PRICE_SOURCES = ["provider", "manual"]`), primary key `(security_id, date)`.
- The setting is the `settings` row `price_provider` = `yahoo`; no row means off. Run state lives in rows `prices_started_at`, `prices_finished_at`, `prices_updated_at`, `prices_last_error`.
- Off, nothing reaches the provider: the daily trigger, the button (`409 PRICES_DISABLED`) and search (`{ enabled: false, items: [] }`) all stop before `fetch`.
- Held securities come from `heldSecurities(deps)` in `services/securities.ts`, returning `{ securityId, from }`: today every security, from its creation day in `APP_TIMEZONE`. Story 22.2 feeds it from trades. Only held securities with `provider = 'yahoo'` and a ticker are fetched.
- Window per security, as Sure's importer: start at `from` when no price is stored or `from` precedes the first one (but never before `first_price_on`), else at the earliest provisional row or the day after the last row; nothing is requested when the start is after today. The request covers `start − 7 days` to today, capped at ten years. Every calendar day from the start is written: the provider's close, else the last price carried (from the lookback, else the last stored row); days before any known price are skipped and `first_price_on` records the provider's first day. Rows dated within seven days of today are `provisional`, so the next run fetches them again. A `manual` row is never overwritten.
- A failure is classified: `PRICE_UNAVAILABLE` (Yahoo answers 404 or `chart.error`, no usable close, or a currency other than the security's) counts against that security, and the fifth in a row sets `offline`; `PRICE_PROVIDER_ERROR` (network, timeout, any other status, unparsable body) stops the run and counts against nothing. A success resets the count and clears `offline`. The daily run skips offline securities; the button retries them.
- The daily run takes `prices_started_at` in one immediate transaction when it is before today's midnight in `APP_TIMEZONE` and no run holds it (started after the last finish, less than ten minutes ago); the button takes it when no run holds it, else `409 PRICE_UPDATE_IN_PROGRESS`. The daily run happens beside the request (`routes/middleware/daily-prices.ts`, after `dailySync`); the button awaits it, as the bank sync button does.
- A finished run writes `prices_finished_at`, and `prices_updated_at` unless it stopped on `PRICE_PROVIDER_ERROR`; `prices_last_error` holds the run's error code, cleared by a clean run. Logs carry the security id, counts, durations and codes only; never a ticker, an ISIN, a name, a price or a response.
- Routes: `GET /api/prices` (status), `PUT /api/prices/settings` (`{ enabled }`), `POST /api/prices/update`, `GET /api/securities?q=` (search, 1–64 characters). Both reads call `requireRole("admin")`; writes are refused to a viewer by `viewerReadOnly`.
- Yahoo adapter, from Sure's `yahoo_finance.rb`: `GET {base}/v1/finance/search?q=&quotesCount=25` and `GET {base}/v8/finance/chart/{symbol}?period1&period2&interval=1d`, base `YAHOO_FINANCE_URL` (default `https://query1.finance.yahoo.com`, HTTPS or loopback, as `ENABLE_BANKING_API_URL`), Sure's headers, a ten-second timeout, no retry, no cookie or crumb. The symbol is the ticker plus Sure's `EXCHANGE_CONFIG` suffix for its MIC unless it already ends with it. Search maps Yahoo's exchange code to a MIC with Sure's `map_exchange_mic`, else from the symbol's suffix, else null; its currency is the MIC's default, else null; its name is `longname`, `shortname`, then the symbol. A price's date is the timestamp shifted by `meta.gmtoffset`, read in UTC; `GBp` and `ZAc` become `GBP` and `ZAR` divided by 100; a close that is null, not positive or not parsable is skipped; a repeated date keeps the last.
- Export: `securities` and `security_prices` go to `LEFT_OUT`. Sure's `all.ndjson` has no `Security` type (its importer's `SUPPORTED_TYPES` refuses one); a security leaves inside the `Trade` and `Holding` lines that name it, from Story 22.2.

**Never:** no trade, holding, or price typed by hand (Stories 22.2 to 22.4); no search interface (22.2's trade form); no cron, retry loop or queue; no request from the browser to Yahoo (the CSP stays); no price deletion when a security goes offline, unlike Sure, since typed and carried prices still serve.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Off | no `price_provider` row; a GET, the button, a search | no request; `409 PRICES_DISABLED`; `{ enabled: false, items: [] }` |
| First fetch | security created 2026-09-14, nothing stored, today 2026-09-21 | one request from 2026-09-07; a row per day 09-14 to 09-21, weekend carried, rows from 09-14 provisional |
| Next day | rows to 09-21, the last seven provisional | request from 2026-09-07, rows 09-14 to 09-22 rewritten |
| Manual | a `manual` row inside the window | kept |
| Fifth failure | `failed_fetch_count` 4, Yahoo 404 | count 5, `offline`, run continues, last error `PRICE_UNAVAILABLE` |
| Provider down | Yahoo 503 on the first security | run stops, no count, `prices_updated_at` unchanged, last error `PRICE_PROVIDER_ERROR` |
| Twice a day | second GET the same day | no new run |
| Busy | button while a run holds the lease | `409 PRICE_UPDATE_IN_PROGRESS` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/goals.ts`, `schema/check.ts` `inList`, `schema/settings.ts`, `types.ts`, `package.json` `exports`, `vitest.config.ts` coverage `include` -- patterns; add `schema/securities.ts`, `micros.ts`.
- `packages/api/src/services/sync.ts:473` `startDailySync`, `routes/middleware/daily-sync.ts` -- the daily pattern; `app.ts:441` mounts it, `app.ts:247` `createApi`, `AppDeps`.
- `packages/api/src/services/bank-credentials.ts:274` -- settings upsert with `onConflictDoUpdate`; `services/setup.ts:24`.
- `packages/api/src/connectors/enable-banking/client.ts:337` `call` -- fetch, timeout, `safeParse`, sanitised `AppError`; `connectors/registry.ts` gains `PRICE_PROVIDERS`.
- `packages/api/src/testing/enable-banking.ts`, `testing/bank.ts`, `vitest.setup.ts` `server` -- msw fixtures pattern.
- `packages/api/src/env.ts:160`, `env.spec.ts`, `index.ts:141`, `testing/auth.ts:71` `buildTestApp`, `.env.example` -- `YAHOO_FINANCE_URL`.
- `packages/api/src/lib/errors.ts` -- `PRICES_DISABLED` 409, `PRICE_UPDATE_IN_PROGRESS` 409, `PRICE_PROVIDER_ERROR` 502, `PRICE_UNAVAILABLE` 502; `packages/app/src/locales/fr.json` `errors`.
- `packages/api/src/routes/middleware/roles.spec.ts:51` `ADMIN_READS`, `:152` writes list.
- `packages/api/src/services/ledger/export.ts:215` `LEFT_OUT`.
- `packages/api/src/services/sync.spec.ts:873` -- the log-secrets test pattern.
- `packages/app/src/components/SettingsNav.tsx:19` `SETTINGS_SECTIONS`; `routes/_authed.settings.banks_.$connectionId.tsx:98` `SyncStatus` (last sync, error, button); `routes/_authed.rules.tsx:138` switch with mutation; `hooks/useBankConnections.ts`; `lib/query-keys.ts`.
- `packages/app/e2e/viewer.spec.ts:294`, `e2e/start-api.ts:85`, `e2e/bank-connections.spec.ts:559` (`page.route` fulfil).
- `docs/security-model.md:26` « What leaves the server », `docs/architecture.md` Configuration row, `docs/deployment.md` Variables.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/micros.spec.ts`, `micros.ts` -- parse and rounding, every branch; coverage include.
- [x] `packages/data/schema/securities.ts`, `types.ts`, `package.json`, migration `0049_add_securities` via `pnpm data generate --name add_securities`.
- [x] `packages/api/src/connectors/prices/price-provider.ts`, `yahoo.spec.ts` with `fixtures/*.json` shaped as Yahoo's responses, then `yahoo.ts`; `connectors/registry.ts`.
- [x] `packages/api/src/domain/prices.spec.ts`, `domain/prices.ts` -- window and fill, every branch.
- [x] `packages/api/src/services/securities.ts`, `services/prices.spec.ts`, `services/prices.ts` -- matrix rows, logs without identifiers or prices.
- [x] `packages/api/src/env.ts`, `env.spec.ts`, `index.ts`, `app.ts`, `testing/auth.ts`, `.env.example` -- `YAHOO_FINANCE_URL`.
- [x] `packages/api/src/schemas/prices.ts`, `routes/prices.ts`, `routes/securities.ts` and specs; `routes/middleware/daily-prices.ts` and spec; `roles.spec.ts`; `lib/errors.ts`.
- [x] `packages/api/src/services/ledger/export.ts` -- `LEFT_OUT`.
- [x] `packages/app` -- `SettingsNav`, `routes/_authed.settings.investments.tsx`, `hooks/usePrices.ts`, `query-keys.ts`, `fr.json`; `e2e/investments.spec.ts`, `viewer.spec.ts`, `start-api.ts` (`YAHOO_FINANCE_URL` at a closed loopback port).
- [x] `docs/security-model.md`, `docs/deployment.md`, `docs/architecture.md`; `epics.md` Stories 22.2 and 22.4 export criteria.

**Acceptance Criteria:**
- Given Story 22.1 of `epics.md`, when the story ships, then each of its criteria holds, with the revisions this spec records.
- Given the page with fetching on, when the owner presses « Mettre à jour les cours », then it shows the last update, and a failed run shows its error translated.
- Given a viewer, when they open the settings, then « Placements » is absent and `/settings/investments` redirects to « Sécurité ».

## Design Notes

The end-to-end server has no security to price, so the browser never sees Yahoo's answer: Vitest covers the fetch through msw, Playwright covers the page and fulfils `GET /api/prices` for the failure display. Pointing `YAHOO_FINANCE_URL` at a closed loopback port in `start-api.ts` makes any stray fetch fail loudly instead of reaching Yahoo.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, `micros.ts`, `domain/prices.ts` and `connectors/prices/**` at 100% of branches
- `pnpm test:e2e` -- expected: green

## Implementation Notes

- The window clamps `from` to `first_price_on` before comparing it with the first stored row, so a security held before its listing does not refetch its whole history every day.
- `first_price_on` is recorded only when no price is known before the start, neither from the lookback nor from a stored row; it never moves once set.
- A typed price inside the window is kept and carried forward, as Sure's importer keeps a non-provisional database price.
- drizzle-kit split the `coalesce("mic", '')` index expression at its comma; `0049_add_securities.sql` is fixed by hand, with a comment.
- `parseMicros` refuses exponents, so a Yahoo close printed as `1e-7` is skipped as not parsable.
- A close is rounded half to even to `meta.priceHint` decimals, four when absent as Sure's `decimal(19,4)`, which clears Yahoo's float noise (`612.4000244140625` is `612.40`); pence and cents are then divided by 100 on the millionths.
- `chart.error` `Unauthorized`, Yahoo's crumb demand sent with a 200, is `PRICE_PROVIDER_ERROR`, never a security's failure; a 400 with a `chart.error` (« Data doesn't exist ») is `PRICE_UNAVAILABLE`, as a 404; a missing `meta.currency` falls back to the venue's, as Sure.
- The setting is read again before each security, so turning it off stops a run between two requests. `prices_updated_at` moves only on a clean run or `PRICE_UNAVAILABLE`. The window is computed over provider rows only.
- `epics.md`: Story 22.2's export names a `Trade` line's security as Sure's does with its ISIN under `archant`, Story 22.3 exports `Holding` lines, Story 22.4 exports typed prices beside `all.ndjson`; Sure's `all.ndjson` has no `Security` type.
- `micros.ts` also exports `toMicros`, the branded constructor `toMinorUnits` mirrors, for specs and Story 22.2.
- Search results keep Yahoo's symbol as the ticker (`MC.PA`); `yahooSymbol` never doubles the suffix.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind | Closes keep Yahoo's float32 noise (612.4000244 stored as 612 400 024) | medium | A value of 1 000 shares rounds to a cent off; Sure's `decimal(19,4)` rounds it away | patched: rounded to `meta.priceHint` decimals, else four |
| blind, edge, spec | Turning fetching off mid-run keeps calling Yahoo, against `security-model.md` | medium | `run` used the provider read at its start | patched: the setting is read again before each security |
| blind, edge, spec | `prices_updated_at` moves on `INTERNAL_ERROR` | low | `finish` wrote it for every code but `PRICE_PROVIDER_ERROR` | patched: only on a clean run or `PRICE_UNAVAILABLE` |
| blind, edge | The ten-minute lease is never renewed | false | A timeout is `PRICE_PROVIDER_ERROR`, which stops the run: a run lasts its securities' normal answers plus one timeout at most | rejected |
| blind, edge | `MC`/XPAR and `MC.PA`/XPAR escape the unique index | maybe-false | No security is created before Story 22.2, whose creation path decides the stored form | deferred to 22.2 |
| blind | Search keeps indices and currencies | low | Sure keeps every quote; the search has no interface before 22.2's form | deferred to 22.2 |
| blind | `EXCHANGES` lacks US and Asian suffixes | low | Sure's table verbatim; a search stores Yahoo's symbol, suffix included | rejected |
| blind | No unique index on `isin` | false | One ISIN is listed on several venues, each its own security | rejected |
| blind, standards | Two exported types named `DailyPrices` | low | Port's closes and the service's run handle | patched: `DailyPriceRun` |
| blind, standards | `LEASE_MS` and `codeOf` imported from `bank-connections.ts` | false | `services/sync.ts` already imports both from there | rejected |
| blind, standards | `unavailable()` defined twice | low | Same code and message in `yahoo.ts` and `services/prices.ts` | patched: `priceUnavailable` in the port |
| blind | `LEFT_OUT.security_prices` claims typed prices are fetched again | low | No typed price exists before 22.4 | patched: reason narrowed; 22.4 gains an export criterion in `epics.md` |
| blind, spec | The consent text omits that a search sends the text typed | low | `GET /api/securities` sends the query as typed | patched: one sentence |
| blind | The page does not say which security failed | low | The error says what five failures do; a list is 22.4's sheet | rejected |
| blind | A `role="status"` inserted filled is rarely announced | low | Same pattern as the bank page's last error | rejected |
| blind, standards | `lastError` typed `string` | low | Same as `BankConnectionRecord.lastError` | rejected |
| blind | No Vitest run with no security; no integer pence close | low | Only the end-to-end run had no security | patched: both tests |
| edge | One listing answering `PRICE_PROVIDER_ERROR` every day blocks the later ones | maybe-false | Needs a symbol whose answer Yahoo always fails with a 5xx or an odd body; never seen in Sure's tests | deferred: settle with Yahoo's real failures once trades exist |
| edge | Stored range counts `manual` rows | low | The fetch would resume after a typed price, skipping provider days | patched: provider rows only |
| edge | A timestamp outside `Date`'s range throws a `RangeError` | low | Needs an absurd timestamp; the run then logs `INTERNAL_ERROR` and goes on | rejected |
| edge | A lowercase ticker doubles its suffix | low | `yahooSymbol` compared case-sensitively | patched |
| edge | `first_price_on` set after a suspension longer than seven days | low | Sure's `first_provider_price_on` behaves alike; the days before have no price to carry | rejected |
| edge | `PRICE_UPDATE_IN_PROGRESS` with a stale status never polls | low | The status was not read again on that error | patched: invalidated on error |
| spec | `{"chart":{"error":{"code":"Unauthorized"}}}` with a 200 counts against each security | medium | Yahoo's crumb demand would take every security offline in five days | patched: `PRICE_PROVIDER_ERROR` |
| spec | A missing `meta.currency` fails where Sure takes the venue's | low | Sure's `default_currency_for_exchange` | patched |
| spec | `price > 0` check refuses a typed zero | false | A zero price values nothing; 22.4 types a positive one | rejected |
| verification-gap | Nothing pins that `first_price_on` never moves once set | medium | Replacing `security.firstPriceOn ?? firstPriceOn` passed every test | patched: test |
| verification-gap | `setWhere` protecting a price typed during a run is never exercised | medium | Removing it passed every test | patched: test inserting the row inside the handler |
| verification-gap | No test that a viewer's first read starts the day's prices | medium | `security-model.md` promises it | patched: test |
| standards | AD-21's list of admin-only reads omits the new ones | low | `architecture.md` names the decision | patched |
| standards | `daily-prices.ts` repeats `daily-sync.ts`; `withoutTrailingSlashes` repeats the bank client's | low | Two short adapters; sharing them couples bank and prices | rejected |
| standards | `isDone` and the `Lease` comment mislead | low | The name says done, the run only started | patched: `startedToday`, comment |
| standards | Boolean parameters `daily` and `withOffline` | low | Two call sites, each named | rejected |
| standards | `divideHalfEven` speculative | false | `parseMicros` and the close rounding use it | rejected |
