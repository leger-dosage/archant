# Epic 1 Context: Track accounts and transactions by hand

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The user creates depository and credit card accounts, records transactions and balance snapshots by hand, lists and filters transactions across accounts, and follows each account's daily balance on a chart. This is the first epic with code: it creates `@archant/data`, `@archant/api` and `@archant/web`, and sets the data model (integer minor units, entries, valuations, materialised daily balances) and the ledger that every later epic writes through. No sign-in exists yet; access control arrives in Epic 3.

## Stories

- Story 1.1: Create an account and see it listed
- Story 1.2: Record transactions by hand
- Story 1.3: Daily balance history
- Story 1.4: Balance snapshots
- Story 1.5: List and filter transactions across accounts
- Story 1.6: Manage accounts

## Requirements & Constraints

- Account: name, type, subtype, currency (default EUR), opening balance at a date. Epic 1 types are depository (checking or savings) and credit card. Each type is an asset or a liability. Accounts can be renamed, deactivated (hidden, history kept, reactivable), excluded from reports, and deleted with all their entries after a confirmation stating the count.
- Transactions: create, edit (date, label, amount, notes), delete, exclude from reports. A transaction dated before the account's opening date is refused with `VALIDATION_ERROR`. Excluded transactions still affect the account balance.
- Snapshot: a balance at a date overrides the computed end-of-day balance from that date on. A second snapshot on the same date replaces the first. The gap between computed and recorded balance is shown.
- Daily history: recomputed from the earliest affected date to `max(today, latest entry date)` in the same database transaction as the change. A day without entries carries the previous balance. Chart periods: 1 M, 3 M, 6 M, 1 A, Tout.
- Transaction list: all accounts, most recent first, 50 per page, filters on account, date range, amount range and text in label or notes. With 50,000 transactions in a local SQLite file, the first unfiltered page answers in under 300 ms. Text search uses `LIKE`; FTS5 only if that target fails.
- Money is never a float: integer minor units plus an ISO 4217 code. No code path assumes EUR.
- Every boundary input goes through Zod. API errors use closed `AppError` codes; unknown routes answer `404 NOT_FOUND` JSON, unexpected throws a generic `500 INTERNAL_ERROR`. Messages in English.
- Balance computation is covered to 100% of branches, including a transaction on the opening date, several on one day, and a liability account. No test reaches the network.
- Story 1.1 must leave the verification gate in `AGENTS.md` green, with each package holding only the dependencies that story uses.

## Technical Decisions

- Layers: `domain/` holds pure functions (balance calculation), `services/` opens transactions and is the only code importing `db`, `routes/` parse with Zod and call exactly one service function. Oxlint `no-restricted-imports` overrides enforce the direction.
- `services/ledger.ts` is the single writer of `entries`, `transactions`, `entry_keys`, `balances`, `transfers`, `rejected_transfers`, and the only code that deletes an account. Each ledger function takes an `origin` (`user` here), runs in one transaction opened with `behavior: "immediate"`, and recomputes balances before commit. Foreign keys to `entries` and `transactions` are `ON DELETE RESTRICT`.
- Manual creation goes through `ledger.ingest(accountId, statement, { manual })` with a one-line `ParsedStatement` and no dedup key. Steps for rules, transfers and keys are no-ops for now, but the pipeline order is fixed.
- Sign convention: an entry amount is negative when money leaves the account, for assets and liabilities alike. Stored balances are the asset's value or the amount owed: asset day balance is `previous + sum(amounts)`, liability `previous - sum(amounts)`. A card purchase of `-30,00` raises the card's outstanding balance by 30.
- Data model: `entries` with `kind` `transaction` or `valuation`; transaction-only columns in `transactions` keyed by `entry_id`. A valuation has `valuation_kind` `opening_anchor` (exactly one per account, created with it) or `reconciliation` (user snapshots), and its amount is a stored balance, never a delta. Manual accounts compute forward from the opening anchor; a reconciliation fixes the end-of-day balance on its date. `balances` holds one row per day; every reader calls `balanceOn(accountId, date)`.
- `transactions.locked_fields` (JSON array) is filled only by `origin: "user"` calls; later epics depend on it.
- `@archant/data` exposes subpaths, never an index: `money.ts` owns `MinorUnits` (branded integer), `parseAmount(text, locale)`, `formatMoney` on `Intl.NumberFormat`, and a static ISO 4217 minor-unit table. `account-types.ts` exports `ACCOUNT_TYPES` with classification and subtypes; type-specific attributes go in `accounts.details` (JSON, Zod schema per type). Totals use `settings.reporting_currency` (default EUR) through one helper and skip, and report, other currencies.
- Conventions: text UUID v4 ids; dates as `YYYY-MM-DD` text; timestamps as integer epoch ms UTC; "today" computed in `APP_TIMEZONE` (default `Europe/Paris`). Plural snake_case tables. Enumerations are `text` with a check constraint built from a `const` array in `@archant/data`. The client sets `foreign_keys = ON`, WAL and `busy_timeout` once. Date arithmetic uses small helpers in `domain/`, no date library.
- API: everything under `/api`, envelope `{ data }` or `{ error: { code, message, fields? } }`, `fields` built by one Zod-error mapper for `VALIDATION_ERROR`. Lists take `page` and `pageSize` (default 50, max 200), return `{ items, page, pageSize, total }`, ordered `date DESC, created_at DESC, id DESC`. Routes chained in `app.ts`, which exports `AppType`; async handlers; errors via `c.json(..., status)`, not `c.notFound()`. Request schemas in `api/src/schemas/`, importing only `zod` and `@archant/data`; the web package imports only those and the `AppType` type.
- Interface: `hc<AppType>("/api")` with a relative base; Vite proxies `/api` to port 8787, so no CORS and no build-time API URL. Same Hono version in both packages. Server state only through TanStack Query with one `queryKeys` object per resource; list filters in URL search params validated by TanStack Router. i18next, French only, keys by page, no literal visible string.
- Environment through `validateEnv(runtimeEnv)` in `packages/api/src/env.ts`; every variable in `.env.example`.
- Toolchain pitfalls: `.ts` import extensions with `allowImportingTsExtensions`; `**/*.ts` includes; `onlyBuiltDependencies: [esbuild]`; `DATABASE_URL=file:../../local.db` locally; migrations applied with `drizzle-orm/libsql/migrator`; `skipLibCheck: true`. Database tests use a migrated temporary SQLite file per test file, never `:memory:`. Vitest setup starts msw and fails a test on any unhandled request, naming the URL.
- Epic 1 dependencies, pinned in the architecture: recharts with `react-is`, `@tanstack/react-table`, `@tanstack/router-plugin`, react-hook-form with `@hookform/resolvers`, i18next and react-i18next, Tailwind 4 with `@tailwindcss/vite`, shadcn CLI, lucide-react, Geist fonts via `@fontsource-variable/*`, `@hono/node-server`, pino, msw.

## UX & Interaction Patterns

- Brand layer on shadcn/ui neutral: one indigo accent (`#444CE7`, dark `#8098F9`) for focus, active nav, links and first chart series only; black primary buttons; Geist and Geist Mono; radii 4/6/8; flat surfaces with borders, no card shadows; dark mode follows the system with a manual override.
- One `Money` component renders every amount in `fr-FR` (`1 234,56 €`), tabular figures. Positive transaction amounts green with `+`, negative in the foreground colour with a true minus. Balances and totals are never coloured. Excluded amounts are muted and paired with an eye-off icon (tooltip « Exclue des rapports »). Expenses are never red.
- Amount inputs accept `1234,56`, `1 234,56`, `-42,90`, `42.90` through `parseAmount`, with a Dépense / Revenu toggle instead of a minus sign. Date inputs use a French `Calendar`, week starting Monday, accepting typed `15/09/2026`.
- Routes: `/comptes` (groups Actifs and Passifs with totals), `/comptes/:id` (balance, chart, tabs), `/operations`. `/` redirects to `/comptes` until Epic 6. Surfaces of unshipped epics are absent, not disabled.
- Sidebar: accounts under Comptes, grouped with balances, inactive hidden, group state remembered. Collapses to icons below 1024 px, becomes a sheet below 768 px.
- Transaction sheet: saves on `⌘Enter` or Enregistrer; `Esc` closes and asks only when changes are unsaved; shows the source. No auto-save on blur.
- Transactions list: 36 px rows grouped under day headers (« Aujourd'hui », « Hier », « lundi 15 septembre »), filters as removable chips in the URL, result count and signed total of filtered rows. Pages of 50, no infinite scroll.
- Keyboard: `⌘K`/`Ctrl+K` palette with Aller à, Actions, Comptes; `g c`, `g o`; `j`/`k`, `x`, `e`/`Enter`, `/`, `n`, `Esc`, `?`. Single-letter shortcuts are off in text fields; each has a visible equivalent showing it in a tooltip.
- Balance chart: single line, text summary above, « Voir les données » table toggle, keyboard cursor, no animation under reduced motion.
- Empty states: « Aucun compte pour l'instant. » + « Ajouter un compte »; « Aucune opération. »; « Aucune opération ne correspond à ces filtres. » + « Effacer les filtres ». Skeletons, not spinners. Errors as destructive Sonner toasts with the translated `errors.<CODE>`.
- Confirmation dialogs state counts (« Supprimer le compte et ses 1 204 opérations ? »), focus starts on Annuler.
- Accessibility floor: full keyboard reach, visible focus ring, focus returns on close, `aria-live` toasts, 24 px targets, WCAG 2.2 AA contrast, real tables with header cells.
- Voice: French, vouvoiement, infinitive button labels, no exclamation marks.
- Composition references: `ux-designs/ux-archant-2026-09-21/mockups/key-transactions.html` and `key-dashboard.html`; `EXPERIENCE.md` wins on conflict.

## Cross-Story Dependencies

- Story 1.1 creates the three packages, the translation layer, the brand layer, the sidebar, `Money`, the error envelope and the ledger with the opening anchor. Every other story builds on it.
- Story 1.2 needs the ledger's manual `ingest` path. Story 1.3 plugs the balance recompute into every ledger write and adds the chart. Story 1.4 adds `reconciliation` valuations to the same calculator.
- Story 1.5 needs transactions from 1.2. Story 1.6's deactivation must hide accounts from 1.5's filters, and its delete goes through the ledger.
- Epic 2 reuses `ledger.ingest` with keys and statement balances; Epic 3 adds the auth guard in front of every route built here; Epics 4, 5 and 6 extend the transaction list filters, the sheet fields and read `balanceOn`.
