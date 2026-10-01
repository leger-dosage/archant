---
title: 'Story 15.7: Fewer home-made parts'
type: 'refactor'
created: '2026-10-01'
status: 'done'
baseline_commit: '57996ea3a9619875d8aeca82df0412467f956094'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant rewrites what its libraries already do (`lib/client-address.ts` rebuilds Better Auth's `getIP`, `lib/prompt.ts` rebuilds `readline`'s line queue), keeps several copies of one helper (ten `FieldMessage`, 46 identical `zValidator` hooks, two month calculators, two vendored skill trees), ships three components over 800 lines, pulls Drizzle into the browser bundle, and carries dead code and a lint plugin with no rule on (DEP-1, DEP-2, DEP-4, DEP-5, STR-5, STR-6, STR-7, STR-9 to STR-14).

**Approach:** Replace each home-made part with the library call, merge each set of copies into one helper, split the three files by moving blocks, and add the checks that keep it so: knip in `lint:code`, a Vite build that fails on Drizzle, 100 % branch coverage on `@archant/data`'s money and month modules.

## Boundaries & Constraints

**Always:**
- No behaviour a user or a self-hoster sees changes; every existing test keeps passing unedited except for import paths. One commit per area below, so the diff reads area by area.
- Client address: `clientKey` keeps its signature and becomes `getIP(new Headers({ "x-forwarded-for": forwarded ?? "" }), { advanced: { ipAddress: { trustedProxies } } }) ?? SHARED_CLIENT_KEY`. `forwardedFor`, `withForwardedFor` and `SHARED_CLIENT_KEY` stay. The stale comment « Better Auth does not export `getIP` » goes.
- Password prompt: `promptSecret` reads lines with `for await` over a `readline` interface (or `rl[Symbol.asyncIterator]()`), output still to the muted sink, `terminal: true`; the four cases of `prompt.spec.ts` pass unchanged.
- Routes: one `validated(target, schema)` in `packages/api/src/lib/validated.ts` returns `zValidator(target, schema, hook)` whose hook throws `validationError(result.error)`; all 46 route uses switch to it. Services' own `safeParse` calls stay.
- Months: `packages/data/months.ts` exports `shiftMonth(month, months)` (`YYYY-MM` arithmetic) and `daysInMonth(year, month)`. The API's `addMonths`, `withDay` and `monthRange` and the app's callers of `addMonthsTo` use them; `addMonthsTo` and the API's private `daysInMonth` go.
- Interface: one `components/FieldMessage.tsx` whose `error` prop is `{ type: string; message?: string } | undefined`, replacing all ten copies (nine identical, `RuleDialog.tsx`'s typed `ShownError`). `CATEGORY_KINDS` moves to `packages/data/category-presets.ts`; `MERCHANT_NAME_MAX_LENGTH` and `TAG_NAME_MAX_LENGTH` to a new `packages/data/name-limits.ts` (exported in `package.json`); schema files and the API import them from there, nothing re-exports them. Authentication calls (`signIn.email`, `twoFactor.*`, `updateUser`, `changePassword`) move into `hooks/useAuthActions.ts` as plain async functions, like `useSignOut`; no React Query mutation is introduced.
- Splits move blocks verbatim; every resulting file is under 400 lines (see Code Map).
- Skills: `.agents/skills` stays; `.claude/skills` becomes a symlink to `.agents/skills`. `_bmad/config.user.toml` is untracked and listed in `.gitignore`; `communication_language = "French"` and `[modules.bmm] user_skill_level = "intermediate"` move to `_bmad/custom/config.toml`, without which `render_skill.py` halts (`bmad-build`, `bmad-build-auto`). `user_name` is dropped.
- Lint: `shadcn/no-raw-colors` and `shadcn/no-unknown-classes` are `error` outside `components/ui/**`; `BulkBar.tsx:252`'s deliberate raw reds get one `oxlint-disable-next-line` with the existing why-comment. `docs/tech-stack.md:31` states the policy.
- knip: root devDependency, root `knip.json` with workspaces, Playwright entries (`e2e/**/*.ts`, `playwright.config.ts`) and `src/components/ui/**` ignored; appended to the root `lint:code` script so no CI job is added or renamed. Every finding is fixed by deleting the file or the `export`, never by an ignore, except the configured ones.

**Never:** no new runtime dependency (knip is dev-only and justified in the pull request); no new CI job; no change to any route, response, limit or visible text; no split of the other files over 400 lines; no edit inside `components/ui/` except deleting `card.tsx` and `separator.tsx`.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected |
|---|---|---|
| IPv4, no proxies | `x-forwarded-for: 203.0.113.7` | `203.0.113.7`, as before |
| IPv6 | `2001:db8:1:2:3:4:5:6` | the same /64 key as before |
| IPv4-mapped | `::ffff:203.0.113.7` | `203.0.113.7` |
| Trusted proxy chain | `198.51.100.1, 10.0.0.2` with `TRUSTED_PROXIES=10.0.0.0/8` | `198.51.100.1` |
| Two values, no proxies | `1.1.1.1, 2.2.2.2` | `SHARED_CLIENT_KEY` |
| Garbage or missing header | `nope`, `null` | `SHARED_CLIENT_KEY` under `NODE_ENV=production` |

</frozen-after-approval>

## Code Map

- `packages/api/src/lib/client-address.ts:49,74-143` -- `SHARED_CLIENT_KEY`, `normalizeAddress`, `clientKey`; callers `app.ts:23,363` (`withForwardedFor`), `routes/setup.ts:41-47`. Better Auth already gets `trustedProxies` at `services/auth.ts:119`. `getIP(req: Request | Headers, options)` from `better-auth/api` (1.7.6) returns `127.0.0.1` when nothing resolves and `NODE_ENV` is `test` or `development`, read once at module load.
- `packages/api/src/lib/prompt.ts:42-127` -- `WeakMap` session, early-line queue, close answers `""`; one caller `cli/reset-password.ts:5`.
- `packages/api/src/lib/zod-error.ts:19` -- `validationError`; route uses: accounts 9, bank-connections 10, transactions 6, categories 4, rules 4, merchants 3, recurring 2, reports 2, tags 2, imports 1, setup 1, snapshots 1, transfers 1.
- `packages/api/src/domain/dates.ts:84-140` -- `daysInMonth`, `addMonths`, `withDay`, `monthRange`; `packages/app/src/lib/dates.ts:108` `addMonthsTo`, used by `components/CashFlowSection.tsx` twice.
- `packages/data/money.ts:281` -- the uncovered `RangeError` branch; branches at 89.65 % (26/29). `packages/data` has no `vitest.config.ts` and no `@vitest/coverage-v8` (api pins `^5.0.2`).
- `FieldMessage` copies: `components/{SnapshotDialog:39,CreateAccountDialog:97,EditAccountDialog:49,CategoryDialog:57,LoanDetailsFields:19,TransactionSheet:87,RuleDialog:185}.tsx`, `routes/{sign-in:76,setup:53,_authed.settings.security:52}.tsx`; `lib/form-errors.ts:42` `fieldErrorCode` already takes `Pick<FieldError, "type" | "message">`.
- Drizzle in the bundle: `CATEGORY_KINDS` (`schema/categories.ts:13`, imported by `CategoryDialog.tsx:15`, `_authed.settings.categories.tsx:9`), `MERCHANT_NAME_MAX_LENGTH` (`schema/merchants.ts:4`, `MerchantCombobox.tsx:7`), `TAG_NAME_MAX_LENGTH` (`schema/tags.ts:4`, `TagCombobox.tsx:8`).
- `authClient` outside hooks: `routes/sign-in.tsx:116,223,224`, `routes/setup.tsx:121`, `routes/_authed.settings.security.tsx:82,162,320,335,347,474`.
- Splits, targets:
  - `TransactionSheet.tsx` (1,048) → `TransactionFields.tsx` (`CategoryField`, `MerchantField`, `TagsField`, 132-299), `TransactionLinks.tsx` (`TransferBlock`, `DuplicateBlock`, `RecurringBlock`, 309-586), `TransactionForm.tsx` (587-905 with the helpers it uses), `TransactionSheet.tsx` keeps 906-1048.
  - `RuleDialog.tsx` (1,009) → `lib/rule-form.ts` (types, defaults, `valuesOf`, `fieldNames`, 61-160), `RuleReferenceField.tsx` (`PickerField`, `ReferenceField`), `RuleConditionRows.tsx` (`LeafRow`, `GroupRow`), `RuleActionRow.tsx`, `RuleDialog.tsx` keeps 772-1009.
  - `routes/_authed.settings.banks.tsx` (801) → `components/BankCredentials.tsx` (`Unavailable`, `RedirectAddress`, `CredentialsForm`, `EnvironmentCredentials`, 119-369), `components/BankPickerDialog.tsx` (370-590); the route keeps `Connections`, `BanksPage`, `ConnectBank`.
- knip today: false positives `e2e/auth.setup.ts`, `e2e/start-api.ts`, `startFakeEnableBanking`, `SETUP_TOKEN_FILE`; real ones `ui/card.tsx`, `ui/separator.tsx`, about 18 exports only used in their own file (`PREVIEW_TTL_MS`, `FALLBACK_WINDOW_DAYS`, `MIN_INTERVAL_MS`, `CONNECTION_ALERTS`, `cookieOf`, `isDark`…), 19 types, two duplicate exports in `api/src/schemas/transactions.ts`.
- `.oxlintrc.json:5` loads the plugin; CLI `-D shadcn/*` does not enable jsPlugin rules, only the config does. Counts outside `ui/`: no-restyle 292, no-arbitrary-values 26, no-inline-styles 14, require-static-classes 5, no-raw-colors 4 (one element), no-unknown-classes 0.
- `.claude/skills` and `.agents/skills`: 214 identical tracked files each; `_bmad/_config/manifest.yaml` lists `claude-code` and `codex`; skills resolve shared files through `{project-root}/_bmad/`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/lib/client-address.spec.ts` -- add the matrix as a table against today's `clientKey`, unresolved rows under `vi.stubEnv("NODE_ENV", "production")` with `vi.resetModules()` and a dynamic import; green first -- then `client-address.ts` switches to `getIP` and the table stays green
- [x] `packages/api/src/lib/prompt.ts` -- async iterator -- `prompt.spec.ts` unchanged
- [x] `packages/api/src/lib/validated.ts`, `routes/*.ts` -- the helper and its 46 uses, with a spec on one invalid body
- [x] `packages/data/months.ts`, `months.spec.ts`, `api/src/domain/dates.ts`, `app/src/lib/dates.ts`, `CashFlowSection.tsx` -- shared month helpers
- [x] `packages/data/vitest.config.ts`, `package.json`, `money.spec.ts` -- coverage at 100 % on `money.ts` and `months.ts`, `test` runs `vitest run --coverage`; tests for the missing branches written first
- [x] `packages/app/vite.config.ts` -- a plugin whose `generateBundle` fails when a module id contains `/drizzle-orm/`; confirm `pnpm --filter @archant/app build` fails -- then move the three constants and see it pass
- [x] `components/FieldMessage.tsx` and the ten files -- one component
- [x] `hooks/useAuthActions.ts`, the three route files -- auth calls
- [x] the three splits -- move blocks; `wc -l` under 400 each
- [x] `knip.json`, root `package.json`, dead files and exports -- knip clean
- [x] `.oxlintrc.json`, `BulkBar.tsx`, `docs/tech-stack.md` -- two shadcn rules on
- [x] `.claude/skills`, `.gitignore`, `_bmad/config.user.toml`, `_bmad/custom/config.toml` -- one skills tree; render `bmad-build` from a fresh clone to prove it does not halt

**Acceptance Criteria:**
- Given `pnpm lint:code`, then oxlint and knip both pass, and an unused export added on purpose makes it fail.
- Given a Drizzle import added to an interface file, when `pnpm --filter @archant/app build` runs, then it fails naming the module.
- Given `pnpm test`, then `@archant/data` holds 100 % branches on `money.ts` and `months.ts`, and the API thresholds still hold.
- Given `git ls-files .claude/skills`, then it lists one symlink, and Claude Code and Codex both list `bmad-build`.

## Design Notes

Equivalence is proved before the swap: the table is written against the old code, so it records the former keys, then must stay green against `getIP`. Better Auth computes `isTest()` from `NODE_ENV` at import, so the production rows need a fresh module graph. In development an unreadable address now keys as `127.0.0.1` instead of `no-trusted-ip`; both are one shared bucket, so the setup limit behaves the same.

knip joins `lint:code` rather than a matrix entry: a new job name would leave the « main: pull request and CI » ruleset waiting on a check it does not require.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, same API test count plus the new specs
- `pnpm test:e2e` -- expected: green
- `wc -l packages/app/src/components/{TransactionSheet,TransactionForm,RuleDialog}.tsx packages/app/src/routes/_authed.settings.banks.tsx` -- expected: each under 400

## Implementation Notes

- Client address: Vitest sets `TEST=true`, which Better Auth's `isTest()` reads live, so the production rows stub `TEST=false` as well as `NODE_ENV`. Better Auth is externalised by default and never reloads after `vi.resetModules()`; `packages/api/vitest.config.ts` inlines `better-auth` and `@better-auth/core`. The existing `clientKey` table expects the shared bucket for unresolved rows, so it now calls the production-loaded function too; its rows are unchanged.
- Months: the app's `addMonthsTo` cases moved to `packages/data/months.spec.ts` as `shiftMonth` cases; `e2e/dashboard.spec.ts` imports `shiftMonth`.
- Constants: the `CategoryKind` type moved with `CATEGORY_KINDS` to `category-presets.ts`.
- Auth: `useAuthActions()` returns one module-level object of plain async functions, so its identity is stable across renders.
- Splits: `TransactionForm.tsx` with its helpers came to 412 lines, so `valuesOf` and `defaultDate` moved to `lib/transaction-form.ts` (374 left). `lib/rule-form.ts` also holds the error lookups (`errorAt`, `errorId`, `described`) and the `Options` type the rows and the dialog share. `countryName`, `folded` and `matches` moved to `BankPickerDialog.tsx`; the route imports `countryName`.
- knip: `playwright.config.ts` is not listed as an entry, because knip's Playwright plugin finds it and flagged the pattern as redundant. knip does not report unused exports of package entry files (`@archant/data` and `@archant/api` `exports`); `--include-entry-exports` would flag 52, mostly the `types.ts` catalog, and is left off. The acceptance probe was run on an app file.
- `AGENTS.md` and `CONTRIBUTING.md` say what `lint:code` now runs.
- End-to-end: of five full runs on the branch, two passed and three each failed one different test (`manage-accounts.spec.ts:145`, `auth.setup.ts:40`, `bank-connections.spec.ts:1081`), each passing when rerun. One full run on `main` at the baseline passed; whether these failures predate the branch is not settled.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind | The existing `clientKey` table now calls a production-loaded `clientKey`, against « unedited except import paths » | low | Its rows are unchanged; only the function they call is reloaded, because `getIP` answers `127.0.0.1` under test where the old code answered the shared key | rejected: forced by the library, recorded in Implementation Notes |
| blind | `clientKey`'s docstring says unreadable addresses fall back to the shared bucket, untrue in test and development | low | `getIP` returns `127.0.0.1` when `isTest()` or `isDevelopment()` | patched |
| blind | In development an unreadable address now shares the real loopback browser's setup bucket | low | True in development only; production keys are unchanged | rejected: fix edits the spec |
| blind | `clientKey` rebuilds Better Auth's `ipAddress` options instead of sharing `services/auth.ts:119`'s | low | Both pass `trustedProxies` alone today; diverging needs someone to add an option on one side | rejected: unlikely, fix adds public surface |
| blind | AD-16 does not list `@archant/data`'s modules that `vitest.config.ts` now holds to it | low | `docs/architecture.md:182` names `domain/**`, `services/ledger/**`, `connectors/**` only | patched |
| blind | The Drizzle guard is undocumented, narrow and misses Windows paths | false | Rollup module ids are POSIX-normalised by Vite; the story asks for Drizzle only | rejected |
| blind | `AGENTS.md` and `CONTRIBUTING.md` promise knip fails on any unused export | low | knip skips the exports of published entry modules, every `@archant/data` module included | patched |
| blind | `validated.spec.ts` uses its own `onError`, not the app's | false | The spec tests the helper; the route specs already assert `VALIDATION_ERROR` through the real `app.onError` | rejected |
| blind | No lint rule keeps `authClient` out of route files | low | Nothing reintroduces it today | rejected: adds config |
| blind | The error shape `{ type; message? }` is declared twice | low | `lib/rule-form.ts:120` and `FieldMessage.tsx` | patched: one type in `lib/form-errors.ts` |
| blind | `BankPickerDialog.tsx` and `RuleReferenceField.tsx` export non-components, which degrades Fast Refresh | low | Only a full reload in development when those files change | rejected: unlikely to matter |
| blind | Two functions named `valuesOf` in `lib/` | low | Different modules, each imported by its one user | rejected |
| blind | Two imports from `@archant/data/category-presets` in `cash-flow.ts` and `schemas/categories.ts` | low | Lines 1-2 and 7-8 | patched |
| blind | Name limits split between `name-limits.ts` and `category-presets.ts` | low | The spec chose it, to leave `CATEGORY_NAME_MAX_LENGTH` in place | rejected: fix edits the spec |
| blind | Spec and sprint status disagree, tasks unticked | false | Both move through the workflow's own steps | rejected |
| blind | The patch hides the skills change and Windows without `core.symlinks` gets a text file | low | The review diff left the 214 moved files out on purpose; Windows without symlinks is not a supported development host | rejected |
| blind | Inlining Better Auth applies to every API unit spec | low | The whole `pnpm test` ran in 28 s on the final tree, not compared with `main` | rejected |
| blind | `promptSecret` lets an input `error` reject unhandled | false | The former implementation did not handle it either | rejected: pre-existing |
| edge | Dropping `user_name` loses the owner's name in skills | low | `render_skill.py` renders without it; the spec drops it on purpose | rejected: fix edits the spec |
| verification-gap | `noDrizzleInBundle` has no automated test of its refusal | medium | Checked once by hand; a broken guard would pass a clean build silently | deferred |
