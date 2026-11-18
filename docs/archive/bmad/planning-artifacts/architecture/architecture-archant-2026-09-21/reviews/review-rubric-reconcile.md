---
reviews: ../ARCHITECTURE-SPINE.md
lenses: [good-spine rubric, input reconciliation]
date: '2026-09-21'
---

# Review — rubric and input reconciliation

## Verdict

The spine picks the right divergence points for the money paths (single ledger writer, one statement shape, one pipeline order, one sign convention, stored keys) and most ADs have a concrete, checkable Rule. It is not ready for Story 2.1 as written: three Rules produce wrong behaviour on their own terms (AD-7 with manual and pending entries, AD-9 with loan and investment transfers, AD-13 with `/api/sync`), several divergence points that two epics share are neither decided nor deferred, and a handful of scaffolding lessons did not land. All fixes are local edits to existing ADs or one new AD; none reopens the paradigm.

Severity scale: **High** = a Rule as written causes wrong data or a broken flow; **Medium** = a real divergence point between two stories is left open; **Low** = wording, enforceability or a missing lesson.

## Part 1 — Good-spine rubric

### 1.1 Rules that do not prevent their own divergence, or cause a defect

**R1 (High) — AD-13 blocks its own sync route.** The session middleware "guards every `/api` route except `/api/health`, `/api/auth/*` and `/api/setup`". `/api/sync` is under `/api` and not in the list, so a cron call carrying only `SYNC_SECRET` gets `401` from the session middleware before the secret check runs. Separately, FR50 and Story 10.3 want the same sync "from a button in the interface"; the browser cannot hold `SYNC_SECRET`, and the spine names no session-guarded route for the button, so the Epic 10 author will either leak the secret to the bundle or make `/api/sync` accept both.
Fix: add `/api/sync` to the exception list, guarded only by the secret. Name the button route, for example `POST /api/bank-connections/:id/sync` behind the session, and state that both call the same `services/sync.ts` function.

**R2 (High) — AD-7 drops identical manual entries.** AD-4 sends manual creation through `ledger.ingest` with a one-transaction statement. With `externalId: null`, AD-7 computes `fp:<sha256(date|amount|label|0)>` under source `manual`. Two manual coffees of `-3,50` with the same label on the same day both get occurrence index 0, the second hits the unique index as an exact match, and is reported "already present": silently not created. The occurrence counter only works inside one statement.
Fix: manual entries carry no key, or a non-colliding `manual:<entry id>`. Manual entries still take part in fuzzy matching as "entries carrying no key from this source".

**R3 (High) — AD-7 exact match breaks the pending lifecycle.** "An exact key match means already present." When Enable Banking returns the booked version of a pending transaction under the same id (the first branch of Story 10.4), the booked version is skipped and the entry stays pending forever. When the id differs, the fuzzy branch excludes entries "carrying a key from this source", so the pending entry is never a candidate and the booked version is created as a second row. AD-10 mentions "the pending-to-booked replacement" but no AD defines it: window, amount tolerance, in-place update versus new entry. FR51 ("even if the amount or label changed") and Story 10.4 ("same id, or else the same amount within 5 days") already disagree on the tolerance.
Fix: extend AD-7 with a pending branch. An exact key match on a pending entry updates it in place (date, amount, `pending = false`, keys added), skipping locked fields. A booked transaction with no key match is compared with pending entries of the same account and source within 5 days before the generic fuzzy step. Update in place, never replace: a new entry id would orphan `transfers`, taggings, recurring references and keys. Reword AD-10 accordingly ("carry locked fields over" becomes "never overwrite locked fields").

**R4 (High) — AD-9 double-counts loan and investment transfers, and never defines income versus expense.** "Transfers of kind `loan_payment` and `investment_contribution` count as expenses" does not say which leg. The inflow leg on the loan or PEA account is positive, so under any sign-based reading it counts as income, and the payment nets to zero in cash flow, the exact bug transfers exist to prevent (Story 7.1, 7.2 want it counted as an expense). More broadly, AD-9 decides *inclusion* but not *direction*: is a transaction income because its amount is positive or because its category has kind `income` (FR27)? A refund in "Groceries" lands on a different side depending on the answer, and Story 5.1's direction filter ("transfers only appear under transfer") already disagrees with AD-9, where loan payments appear under expense.
Fix: in `domain/cash-flow.ts`, define both the inclusion predicate and the classification: for `loan_payment` and `investment_contribution`, only the outflow leg counts, as an expense; the inflow leg is excluded. State whether direction follows the amount sign or the category kind (recommendation: sign, as Sure does, so uncategorised rows still land somewhere). Make the transaction list's direction filter reuse the same function, and amend Story 5.1 accordingly.

**R5 (Medium) — AD-3 and AD-5 leave the statement balance and its sign to the reader.** `ParsedStatement.balance` exists, but no Rule says what `ledger.ingest` does with it: Story 2.2 needs a `reconciliation` valuation tied to the import (so Story 2.5 can revert it), AD-8 needs a `current_anchor` rewrite on sync. Nor does it say in which convention the amount is expressed. AD-5 says "connectors convert; the ledger never guesses", but `FileSource.parse(bytes, options)` does not receive the account's classification, so the OFX source cannot turn a negative credit card `LEDGERBAL` into a positive amount owed (Story 2.2).
Fix: state that `balance.amount` is in AD-5's convention, pass the account classification in `options` (or make the ledger the one place that converts a bank-signed balance, and say so), and add the balance step to AD-4: files write a `reconciliation` valuation carrying `import_id`, bank connectors rewrite the `current_anchor`.

**R6 (Medium) — Imports dated before the opening anchor are undecided.** Story 1.2 refuses a manual transaction dated before the opening date. A user who creates an account today and imports last year's OFX file hits the same boundary for every line, and nothing says whether the ledger refuses, rejects the lines with a `RejectionCode`, or moves the anchor. The forward calculator of AD-8 cannot absorb them silently.
Fix: add to AD-8 that a statement line before the opening anchor is rejected with `BEFORE_OPENING_DATE`, and that the preview offers to move the opening date. Or decide the opposite, but decide.

**R7 (Medium) — AD-8 does not say how far balances are materialised.** Story 1.3 recomputes "to today", but "today" moves. The day after the last write there is no `balances` row; the account chart (Story 1.3) and net worth (Story 6.1, which sums daily balances across accounts whose last rows have different dates) will each invent a carry-forward.
Fix: state that `balances` is written up to the date of the last recompute and that readers carry the last row forward, through one helper in `services/reports.ts`.

**R8 (Medium) — Disconnect and link switch the calculation direction without a rule.** AD-8 computes a linked account backward and a manual one forward. Disconnecting (FR54) switches to forward from an `opening_anchor` that the backward calculation never kept up to date, so the current balance jumps. Linking a file-fed account (FR49) has the mirror problem.
Fix: on disconnect, convert the last `current_anchor` into a `reconciliation` valuation; on link, keep the existing reconciliations authoritative. One sentence in AD-8.

**R9 (Medium) — AD-7 fuzzy matching ignores the label and OFX identifiers are not always stable.** The attach rule uses amount and a 3-day window only. Two unrelated `-50,00` operations from two sources merge into one row. Separately, some French banks regenerate `FITID` between exports; with an `ext:` key only, a re-export matches nothing exactly, and the fuzzy branch excludes entries already carrying an `ofx` key, so the whole file is re-created.
Fix: write both keys for sources that have an id (`ext:` and `fp:`), match on either. Add "normalised labels share at least one token" or a similar cheap test to the fuzzy branch, or accept the risk explicitly in the AD.

**R10 (Medium) — The connector port misses one operation Epic 10 needs.** Story 10.5 revokes the session at Enable Banking on disconnect; `BankConnector` has no `revoke`. The service will call the provider directly, bypassing the port the inventory asked for. The `rejected: { line }` shape also means nothing for a bank response.
Fix: add `revokeAuthorization(sessionRef)` to `BankConnector`; make `rejected` carry `ref: string` (line number or provider id).

**R11 (Low) — AD-1 and AD-2 have no mechanical check.** Both Rules are enforceable in principle but rely on review. Oxlint supports `no-restricted-imports` with per-directory `overrides`.
Fix: add to AD-1 that `domain/**` may not import `drizzle-orm`, `hono` or `services/**`, and to AD-2 that only `services/ledger.ts` may import the `entries`, `transactions`, `entry_keys` and `balances` tables. Also fix two small internal contradictions: the Domain bullet lists "file parsing" while AD-3 puts parsers in `connectors/`; the diagram shows `web → routes` while `AppType` comes from `app.ts` and request schemas from `schemas/`.

**R12 (Low) — Branch coverage of money paths is stated, not enforced.** NFR11 wants branch coverage on money paths; AD-16 covers the network only.
Fix: a Vitest coverage threshold of 100% branches on `domain/**`, `services/ledger.ts` and `connectors/**`.

### 1.2 Divergence points the level below shares, neither decided nor deferred

| Gap | Units that would diverge | Severity | Proposed decision |
| --- | --- | --- | --- |
| Validation error details | Every form (Stories 1.1, 1.2, 2.3, 4.x…). Story 1.1 shows the message "next to the field", but AD-15's envelope has no field path | Medium | `error.fields?: { path: string; code: string }[]` for `VALIDATION_ERROR` only, built by one Zod-error mapper |
| Preview then confirm transport | Stories 2.1, 2.3, 2.4, 8.3. AD-4's `dryRun` implies the confirm call resends the file, but nothing says so, nor multipart versus JSON, nor where the 5 MB limit is enforced | Medium | Stateless: preview and confirm are two `multipart/form-data` calls with the same bytes and options; `bodyLimit` of 5 MB on import routes |
| Account types and classification | Epics 1 and 7, AD-5 (sign of the day balance), AD-11 (transfer kind) | Medium | One `ACCOUNT_TYPES` const in `@archant/data` mapping type to `asset`/`liability` and allowed subtypes; type-specific attributes (loan rate, end date) in one nullable JSON `details` column or one table per type, pick one |
| Sync concurrency and single instance | Cron and the button firing together (Stories 10.3, 10.4); two deferred transactions on SQLite end in `SQLITE_BUSY` | Medium | State that exactly one process runs; `services/sync.ts` holds an in-process single-flight lock per connection; ingest transactions open with `BEGIN IMMEDIATE` |
| SQLite connection settings | Account deletion (Story 1.6) and revert (Story 2.5) rely on cascades; SQLite leaves foreign keys off by default | Medium | `PRAGMA foreign_keys = ON`, `journal_mode = WAL`, `busy_timeout` set once where the client is created; backups documented with `VACUUM INTO` or `.backup`, never a raw file copy under WAL |
| Reporting currency source | Stories 6.1, 6.2 | Low | A `settings` row, default `EUR`, read through one helper |
| Stable list order | Story 1.5 pagination by offset | Low | `ORDER BY date DESC, created_at DESC, id DESC`, with an index on `entries(date, created_at, id)` |
| CSRF on cookie-authenticated routes | Every mutating route | Low | Hono `csrf()` middleware with `WEB_ORIGIN` / `BETTER_AUTH_URL`, in AD-13 |
| CLI scripts | Story 3.2 `pnpm api reset-password`; AD-13 is silent on how a script sets a password without hand-rolling hashing | Low | Allow `packages/api/src/cli/*.ts` as scripts beside the single server entrypoint; they call Better Auth's server API or its password hasher, never a custom hash |

### 1.3 Deferred items

None of the eight deferred items lets two units diverge on its own: each is owned by a single story or epic, or is operational documentation. Two need a qualifier:

- **Full-text search** is deferred to FTS5, but FTS5 virtual tables and `MATCH` are raw SQL, which `AGENTS.md` forbids in application code. Say now where that SQL will be allowed (migration plus one query helper), or the Story that needs it breaks a convention.
- **Categorisation provider**: Story 8.4 says proposals never overwrite "a category set by hand or by a rule", but AD-10 only protects fields set by hand. Either extend `locked_fields` semantics or leave it explicitly to Story 8.4. It is inside Epic 8 either way, so deferral is acceptable.

### 1.4 Coverage of requirements

`binds: [FR1-FR56, NFR1-NFR14]` overstates. Not addressed at all: NFR13 (keyboard use, WCAG 2.2 AA contrast). It can be deferred to `DESIGN.md`, but should be listed under Deferred. Partly addressed: NFR10 (no index or query-shape decision backs the 300 ms and 10 s targets; see Turso below), FR14 (`NormalizedTransaction` has no slot for the QIF `N` number field, so it will land in notes or vanish depending on the author), FR53 (no warning when the cron stops calling: "sync never stops silently" holds for consent expiry only; a "last successful sync older than 48 hours" banner closes it).

### 1.5 Dimensions owned at this altitude

| Dimension | State | Gap |
| --- | --- | --- |
| Deployment | Decided (container, one origin, volume) | Environments are implicit. Missing: exactly one instance (see concurrency), how the web client finds the API (see lessons), shutdown handling (`init: true`). |
| Environments | Partly | Local and container are described; CI is not. The Turso claim "no code change" ignores latency: AD-4 runs per-row key lookups inside one interactive transaction, and against a remote database a 5,000-line import at one round trip per lookup will not meet NFR10. Batch key lookups per statement, or list Turso as best-effort for NFR10. |
| Provider strategy | Decided (AD-3, one static registry) | `revoke` missing (R10). Which Enable Banking balance type becomes the `current_anchor` (booked closing versus interim available) and whether it includes pending amounts is undecided, and AD-8 counts pending in balances; a mismatch shifts every backward-computed day. |
| Operations | Mostly deferred, acceptably | Missing: sync lock, request timeout expectations for a sync that runs inside the request (a proxy or GitHub Action timeout cuts it mid-way; per-account atomicity makes that safe, say so), stale-sync warning, `ENCRYPTION_KEY` loss and rotation (the `v1:` prefix hints at rotation; say that losing the key means reconnecting banks, nothing else). |
| Security | Decided | AD-14's pino redaction uses `*.amount`, which only matches one level deep; nested provider objects pass through. State that raw provider responses and error objects are never logged, and that connectors throw sanitised errors. Whether stored IBANs are masked or encrypted at rest is undecided (Story 10.2 displays a masked IBAN). |

## Part 2 — Input reconciliation

### 2.1 Scaffolding lessons that did not land

The epics' Additional Requirements list these lessons as binding; the spine carries only two of them (temporary SQLite files in tests, the `/api` prefix).

| Lesson | Where it should land | Severity |
| --- | --- | --- |
| Vite inlines `VITE_*` at build time; a build on a dev machine shipped `http://localhost:8787` | Structural Seed: the web client uses a relative base URL `/api`; in development a Vite proxy forwards `/api` to 8787, which also removes CORS and the cross-origin cookie problem entirely | Medium |
| CORS origin must be stripped of a trailing slash | If CORS stays, in the Configuration row for `WEB_ORIGIN`; Better Auth's `trustedOrigins` must also list it | Low |
| A catch-all `app.get("*")` preempts `app.notFound` | Structural Seed: the SPA fallback is mounted after `/api/*`, and `/api/*` has its own JSON 404 | Low |
| `hc<AppType>` stays typed only with `async` handlers, `c.json(..., 404)` rather than `c.notFound()`, and the same Hono version in both packages | AD-15 | Low |
| Node as PID 1 drops SIGTERM; `init: true` fixed it | Structural Seed, container | Low |
| `.ts` import extensions with `allowImportingTsExtensions`, recursive `**/*.ts` include, `onlyBuiltDependencies: [esbuild]`, `file:../../local.db` as the only shared local path, migrations through `drizzle-orm/libsql/migrator` without drizzle-kit in the image | A short "Toolchain" line in Consistency Conventions, or an explicit pointer to `scaffolding-lessons.md` as binding | Low |
| Playwright `reuseExistingServer` and `forbidOnly` in CI; and NFR11 for end-to-end tests: how Enable Banking is faked when Playwright drives a real server | AD-16 | Low |

### 2.2 Other inputs not landed or contradicted

- **`AGENTS.md`, single entrypoint.** The spine's "`index.ts` — the only entrypoint" contradicts Story 3.2's `pnpm api reset-password`. See the CLI row in 1.2.
- **`AGENTS.md`, no raw SQL.** Tension with the deferred FTS5 plan (1.3).
- **`AGENTS.md`, no barrels, single `index.ts`.** `@archant/data` then needs an `exports` map of subpaths (`@archant/data/money`, `@archant/data/schema/accounts`); the spine does not say how the web package imports `money.ts` and `types.ts`. Low.
- **Epics, Story 3.1: "`role` is a text column constrained to known values".** AD-13 has `auth.ts` generated by the Better Auth CLI, which emits no check constraint, and the enumeration convention requires one; a hand edit is lost at the next generation. Decide: keep the generated file untouched and add the check in a hand-written migration, or keep `role` validation in Better Auth's `additionalFields` (`input: false`) and amend the story. Medium.
- **Epics, Additional Requirements: bmad-ux before Story 1.1; feature inventory: visual identity "to settle through `bmad-ux`".** The spine fixes shadcn/ui and Tailwind, which matches the agreed direction, but neither references `DESIGN.md` nor defers the visual decisions to it. Low.
- **`docs/tech-stack.md`.** The spine's Stack table says rows already in `tech-stack.md` are not repeated, then repeats `hono`, `better-auth`, `drizzle-orm`, `@libsql/client`. `@tanstack/router-plugin` 1.168.x sits beside `@tanstack/react-router` 1.170.x; the two release in lockstep and should match. `@hono/node-server`, required to serve on Node and to serve static files, is missing. `tech-stack.md` also says "no CSS framework decision yet"; the spine's choice should be reflected there when Story 1.1 installs it, as the inventory asks. Low.
- **NFR14 and `AGENTS.md`, few popular dependencies.** The spine adds about twenty packages. Most are justified by a story; `ofx-js` should be checked for maintenance and for OFX 1.x SGML support, since FR15 needs both versions, and `jose` could be replaced by `node:crypto` for one RS256 signature. Low.
- **ADR 0002, "exercised in CI once it exists".** Present in Story 3.3, absent from the spine. Low.
- **`docs/deployment.md`, "a PSD2 consent allows a limited number of calls per account per day".** Not reflected: a button plus a daily cron plus retries can exceed it. One sentence in the sync rule (a minimum interval between two syncs of the same connection) closes it. Low.
- **Feature inventory, "Adding a connector or a format must not touch the ledger code".** Landed (AD-3). **"Everything in euros, no code path assumes EUR".** Landed (AD-6), except where the reporting currency comes from (1.2). **"No household entity".** Landed by omission; worth one line so no one adds `household_id`. Low.
- **Feature inventory, epic order.** The inventory lists nine epics with file import inside Epic 1; `epics.md` has ten with manual tracking first. The spine follows `epics.md`, correctly; the inventory is the stale document.
- **`AGENTS.md` API contract.** AD-15 carries it faithfully, plus pagination and bulk shape. Error-message language (English) and translation from the code landed.

### 2.3 Story acceptance criteria to amend

| Story | Criterion | Conflict with the spine | Amendment |
| --- | --- | --- | --- |
| 1.1 | "the account is stored with an opening balance of `123456` minor units" | AD-8 stores it as an `opening_anchor` valuation entry, not an account column | "an `opening_anchor` valuation of `123456` minor units is created with the account" |
| 1.3 | "daily balances from the earliest affected date to today are recomputed" | True for forward accounts only; AD-8 computes linked accounts backward | Add "for an account linked to a bank, from the current anchor backward" (Epic 10 can own that AC) |
| 1.4 | "a second snapshot on the same date replaces the first" | Compatible, but Story 2.2 replaces a user snapshot with an import-owned one, which Story 2.5's revert then deletes, losing the user's value | Decide in 2.2: an OFX balance never replaces a user-entered reconciliation, or revert restores it |
| 2.1 | Preview lists "to create, already present (same `FITID` in this account), rejected" | AD-7 adds two outcomes: attached to an existing entry from another source by fuzzy match, and created with `possible_duplicate` | Preview shows four groups: to create, already present (key match), matched to an existing entry, possible duplicates |
| 2.1 | "larger than 5 MB → `INVALID_IMPORT_FILE`" | Spine fixes no upload transport or limit | Keep, once the spine adopts the 1.2 transport decision |
| 2.2 | "a credit card OFX file whose ledger balance is negative → positive outstanding debt" | Spine does not say who flips the sign (R5) | Keep; spine must make it implementable |
| 2.3 | "the key is a fingerprint of account, date, amount and normalised label" | AD-7 hashes date, amount, label and occurrence index; the account is in the unique index, not the hash | "a fingerprint of date, amount, normalised label and occurrence index, unique per account and source" |
| 2.5 | "exactly the transactions it created are deleted" | AD-7 also attaches keys to pre-existing entries; `entry_keys` has no `import_id`, so a revert leaves those keys behind | Add `import_id` to `entry_keys` and state that revert removes the keys the import attached |
| 3.1 | "`role` is a text column constrained to known values" | AD-13 generated `auth.ts` (2.2) | Per the decision above |
| 3.2 | `pnpm api reset-password <email>` | "`index.ts` the only entrypoint" | Keep once the spine allows `src/cli/` |
| 5.1 | "transfers only appear under transfer" in the direction filter | AD-9 counts `loan_payment` and `investment_contribution` as expenses | "internal moves and credit card payments appear under transfer; loan payments and investment contributions appear under expense on their outflow leg" (after R4) |
| 7.1, 7.2 | loan payment / investment contribution "counts as an expense in the monthly cash flow" | AD-9 as written counts the inflow leg as income too (R4) | Add "and its inflow leg on the loan or investment account counts in neither total" |
| 8.4 | proposals never override "a category set by hand or by a rule" | AD-10 locks hand-set fields only | Keep; make Story 8.4 own the "set by a rule" marker, or extend AD-10 |
| 10.3 | "`POST /api/sync`… or I press sync in the interface" | AD-13 guards `/api/sync` with the secret only; middleware list omits it (R1) | "the interface button calls `POST /api/bank-connections/:id/sync` with the session" |
| 10.3 | "if a close candidate exists, flagged as a possible duplicate" | AD-7 flags when two or more candidates exist; "close" is undefined | "if two or more candidates exist, it is created and flagged `possible_duplicate`" |
| 10.4 | "booked version, with the same id, or else the same amount within 5 days, replaces it" | AD-7 treats a same-id match as "already present" and excludes same-source entries from fuzzy matching (R3); FR51 allows the amount to change | After R3: "updates the pending entry in place"; align FR51 and the story on whether the amount may differ (recommendation: same id may change amount, fallback match requires same amount) |
| 10.4 | "left out of monthly cash flow" | Consistent with AD-9; AD-8 counts pending in balances. Consistent, noted for completeness | None |
| 10.5 | "the session is revoked at Enable Banking" | No `revoke` on `BankConnector` (R10) | Keep once the port has it |

## Recommended order of fixes

1. Before Story 1.2: R2 (manual keys), R11 wording fixes, the validation-details and account-types rows of 1.2.
2. Before Story 2.1: R5, R6, R7, R9, the transport row, the SQLite settings row, the Story 2.1, 2.3 and 2.5 amendments.
3. Before Epic 3: R1, the CLI and `role` decisions, the web base URL lesson.
4. Before Epic 5: R4 and the Story 5.1, 7.1, 7.2 amendments.
5. Before Epic 10: R3, R8, R10, the concurrency row, the provider balance type.
