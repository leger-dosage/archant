---
title: "Story 27.9: Assistant answers in Sure's formats, and Sure's accounts and lists"
type: 'feature'
created: '2026-10-10'
status: 'done'
baseline_commit: '1ded923d0dda9ecd9f79651077a41b1f4343c0c6'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant's assistant tools answer amounts as fixed decimal strings, refusals as an `isError` text line `CODE: message [fields]`, and `get_accounts`, `get_categories`, `get_merchants`, `get_tags` and the category and tag writes with fields Sure's functions do not have (`subtype`, `active`, `kind`, `transaction_count`) and without the ones they have (`balance_formatted`, `start_date`, `is_linked`, `color`, `source`, `success`, `message`). An assistant written for Sure (`origin/main` `00dd977fb`) misreads them.

**Approach:** `mcp/tool.ts` gains Sure's three formats and one refusal type that `call` in `mcp/server.ts` answers in Sure's shapes for every tool; this story's seven tools then answer field by field as Sure's `get_accounts`, `get_categories`, `get_merchants`, `get_tags`, `create_category`, `update_category`, `create_tag` and `update_tag`. The other tools keep their fields until Stories 27.10 to 27.14, but their refusals take the new shape here.

## Boundaries & Constraints

**Always:**
- `formatMoney({ amount, currency })` in `tool.ts` is Sure's `Money#format` in `:fr`, built from minor units without a float: digits grouped by three with U+00A0, `,` before the decimals, the number of decimals `minorUnitsOf(currency)`, then U+00A0 and the symbol; a negative amount starts with `-` (U+002D, Rails' default `negative_format`). The symbol is Sure's `get_symbol`: `symbol` from Sure's `config/currencies.yml`, prefixed with the code's first two letters when it is `$` and the code is not `USD` (`CA$`); a code Sure lacks shows its code. `{ amount: 123456, currency: "EUR" }` gives `1 234,56 €`; JPY 1235 gives `1 235 ¥`. It never goes through `Intl`, whose French grouping is U+202F.
- `percentage(value, precision)` is Rails' `number_to_percentage` in `:fr` (`config/locales/defaults/fr.yml`): rounded half up to `precision` decimals, `,` as separator, no grouping, `%` right after the number: `percentage(12.345, 1)` is `12,3%`, precision 0 gives `12%`, precision 3 `12,345%`. It takes the value as Sure computes it; its callers arrive with 27.12.
- `decimalOf({ amount, currency })` is a `BigDecimal` as Rails' JSON writes it (`BigDecimal#to_s`, format `F`): trailing zeros dropped but one decimal kept, `12550` EUR is `"125.5"`, `12500` is `"125.0"`, `0` is `"0.0"`, `-1234` is `"-12.34"`.
- One refusal type in `tool.ts`, thrown by a tool's `run`: `{ success: false, error, message }`, or `{ error, hint }` where Sure's function answers a hint (none in this story). `call` answers it with `isError: true` and that JSON as its only text, no `structuredContent` (owner's decision of 2026-10-10: every tool keeps its `outputSchema`, which the MCP TypeScript client checks a normal result against, `@modelcontextprotocol/sdk` 1.30 `client/index.js:490`; the assistant reads Sure's JSON, only the protocol flag differs from Sure's). An `AppError` a service throws answers the same way, `{ success: false, error, message }`, with its code in lower snake case (`NOT_FOUND` → `not_found`) and its message, each field appended as `path code` and each param as `key value`, joined by `; ` (the fields named by the tool, as `toolPath` does today), the way Sure's `validation_failed` joins `full_messages`.
- An argument the tool's Zod schema refuses answers, `isError: true` too, Sure's `FunctionToolCaller` argument shape, `{ error: "<path> <code>; …", hint: "Check argument formats (dates are YYYY-MM-DD) and retry once with corrected arguments." }`. Any other exception answers Sure's MCP controller: `isError: true`, text `{"error":"The tool failed to run","tool":"<name>"}`. `assistant_calls` records the same outcomes as today (`VALIDATION_ERROR`, `INTERNAL_ERROR`, the `AppError` code). A `403 insufficient_scope` stays an HTTP answer before any tool runs.
- `get_accounts`: `{ as_of_date, accounts }`, each account exactly `id`, `name`, `balance` (`decimalOf`), `currency`, `balance_formatted` (`formatMoney`), `classification`, `type` (`Depository`, `CreditCard`, `Loan`, `Investment`, `Property`, `Vehicle`), `start_date` (`openingDateOf`, Sure's day before the first entry), `is_linked` (a bank connection feeds it), `provider` (`"enable_banking"` when linked, else `null`), `status` (`"active"`), and `historical_balances` only when `include_balance_series` is `true`: `{ start_date, end_date, interval, currency, values }`, `values` JSON numbers read from `decimalOf`'s text. `series_period` takes `SURE_PERIODS`, an unknown or absent key reading `last_365_days`; the range is `surePeriodRange`, its start raised to the account's `start_date`, the key omitted when that start is after the end; the interval is Sure's `Period#interval` (up to a year `1 day`, up to five years `1 week`, beyond `1 month`) and the days `seriesDates`. Only active accounts are listed, Sure's `visible`.
- `get_categories` items exactly `id`, `name`, `name_with_parent`, `color`, `icon`, `parent_id`, `is_subcategory`; `get_merchants` items `id`, `name`, `source: "family"`; `get_tags` items `id`, `name`, `color: null`. Their `page` and `page_size` clamp as Sure's (`page` below 1 or not an integer reads 1, `page_size` held within 1 to 100, default 50) instead of refusing.
- Writes take Sure's parameters and answer `{ success: true, category | tag, message }`:
  - `create_category`: `name`, `color?`, `icon?`, `parent_id?`; `kind` goes from the input, the category made `expense` or its parent's. Message `Category '<name_with_parent>' created.` Refusals `name_required` « Please provide a name for the category. », `parent_not_found` « Parent category with id '<id>' not found. », `validation_failed` with Rails' full message (`Name has already been taken`, `Parent can't have more than 2 levels of subcategories`).
  - `update_category`: `id`, `name?`, `color?`, `icon?`. Message `Category '<name_with_parent>' updated.` Refusals `not_found` « Category with id '<id>' not found. », `no_changes` « Provide at least one of name, color, or icon to update. », `validation_failed`.
  - `create_tag`: `name`, `color?` ignored. Message `Tag '<name>' created.` Refusals `name_required` « Please provide a name for the tag. », `validation_failed`.
  - `update_tag`: `name`, `new_name?`, `color?` ignored. Message `Tag updated.` Refusals `not_found` « Tag '<name>' not found. », `no_changes` « Provide at least one of new_name or color to update. », `validation_failed`. `color` alone answers the tag unchanged, `changedRows` 0.
  - A blank name reaches `run`, which refuses it with `name_required`, as Sure's.
- `seriesOutput`, `seriesOf` and `listAccountsWithHistory` go with their last user; `decimal()`, `leftOutFields` and `leftOutOf` stay until the story that removes their last user, knip deciding.
- Docs: AD-19 in `docs/architecture.md` and NFR19 in `epics.md` say each tool takes and answers its Sure function's shape, names where Sure takes names, numbers read through their decimal text, Sure's refusals; `INSTRUCTIONS` drops the `left_out_count` sentence and says amounts come as Sure's decimal text beside a formatted string; `docs/security-model.md` « Assistants » replaces « a write names what it changes by id » with the rule that a write takes a name where Sure's function does, today `update_tag` alone, each later story adding its tools and what a bank-written name reaches through them; `docs/deployment.md` « Connecting an assistant » and `docs/sure-parity.md`'s « Assistant tools » row follow.

**Never:** no change to the interface's money formatting (`@archant/data/money`'s `formatMoney` stays); no field from Stories 27.10 to 27.14's tools; no dynamic `enum` of tag names in `update_tag`'s schema; no `kind` column change (a departure 27.25 reviews); no float on the way to a string.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Linked account | Enable Banking account, 123456 EUR | `balance: "1234.56"`, `balance_formatted: "1 234,56 €"`, `is_linked: true`, `provider: "enable_banking"` | none |
| Series too early | `last_7_days`, account opened tomorrow | no `historical_balances` key | none |
| Unknown period | `series_period: "1Y"` | read as `last_365_days` | none |
| Unknown category | `update_category` with a missing id | `isError: true`, text `{ success: false, error: "not_found", … }` | no `structuredContent` |
| Name taken | `create_tag` with an existing name | `{ success: false, error: "validation_failed", message: "Name has already been taken" }` | none |
| Bad argument | `get_tags` with `extra: 1` | `{ error: "extra unrecognized_keys", hint: … }` | recorded `VALIDATION_ERROR` |
| Other tool's refusal | `get_transaction` with a missing id | `{ success: false, error: "not_found", message: "No transaction has this id." }` | none |
| Crash | a service throws a non-`AppError` | `isError: true`, `{"error":"The tool failed to run","tool":…}` | name logged |

</frozen-after-approval>

## Code Map

- `packages/api/src/mcp/tool.ts` -- add `formatMoney`, `percentage`, `decimalOf`, the refusal type and its `refuse` helper; drop `seriesOutput`, `seriesOf`.
- New `packages/api/src/mcp/currency-symbols.ts` -- Sure's `symbol` per code from `config/currencies.yml` at `00dd977fb`, for the codes in `CURRENCY_CODES` (`packages/data/money.ts`).
- `packages/api/src/mcp/server.ts:366-421` -- `call`: refusal, `AppError`, Zod and crash shapes; `toolPath`/`toolParams` reused for the message; `registerTool` at :464 unchanged, `outputSchema` kept; `INSTRUCTIONS` at :139.
- `packages/api/src/mcp/accounts.ts` -- Sure's fields; `ACCOUNT_TYPES` keys (`packages/data/account-types.ts`) mapped to Sure's class names.
- `packages/api/src/services/balances.ts:80` -- replace `listAccountsWithHistory` with one read of the active accounts, each with `openingDateOf`, whether a bank connection feeds it (`getAccount` at `services/accounts.ts:150` shows how), and, given a Sure period, its balances at `seriesDates`; `services/reports.ts:213` `getBalanceSheet` shows the range and interval code to reuse.
- `packages/api/src/schemas/assistants.ts:72,75,116-132,766,917,937` -- page clamping, `series_period` on `SURE_PERIODS` with `.catch("last_365_days")`, Sure's write parameters; `toolPeriod` and the `BALANCE_PERIODS` import go if unused.
- `packages/api/src/mcp/categories.ts`, `merchants.ts`, `tags.ts` -- Sure's items and writes; `services/categories.ts:125-137` `validParent` throws `invalid_parent` for a missing parent and a subcategory parent alike, so the tool looks the parent up first to answer `parent_not_found`.
- `packages/api/src/testing/assistant.ts` -- a helper reading a tool's JSON answer, refusal or not.
- `server.spec.ts` (refusal assertions at :574-607 and the `isError` lines), `categories.spec.ts`, `merchants.spec.ts`, `tags.spec.ts`, and each other `mcp/*.spec.ts` asserting `isError` text.
- `docs/architecture.md:197` AD-19, `_bmad-output/planning-artifacts/epics.md:230` NFR19, `docs/security-model.md:73-85`, `docs/deployment.md:291`, `docs/sure-parity.md:252`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/mcp/tool.spec.ts` -- failing first: `formatMoney` on 0 (`0,00 €`), -123456 EUR (`-1 234,56 €`), 123456789 EUR, JPY, CAD (`CA$`), an unknown code; `percentage` at precisions 0, 1 and 3 and a half-up tie; `decimalOf` on the four values above and a three-decimal currency.
- [x] `packages/api/src/mcp/tool.ts`, `currency-symbols.ts` -- the formats and the refusal type.
- [x] `server.spec.ts` -- failing first: each matrix row through the MCP handler; then `server.ts` `call` and `INSTRUCTIONS`.
- [x] `categories.spec.ts`, `merchants.spec.ts`, `tags.spec.ts`, and a `get_accounts` block in `server.spec.ts` -- exact keys with `Object.keys`, messages, refusals; then the tools, schemas and `services/balances.ts`.
- [x] Other `mcp/*.spec.ts` -- refusal assertions in the new shape.
- [x] Docs as Boundaries list.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` runs, then both Vitest projects pass and every tool of this story is pinned key by key through the MCP handler.
- Given `pnpm lint:code`, when knip runs, then no helper this story leaves unused remains.

## Design Notes

Why `run` refuses a blank name rather than the schema: Sure answers `name_required`, a code the Zod argument shape cannot carry. `parent_id` stays an id, as Sure's.

`status` is always `"active"`: Archant has no draft account, and an inactive one, Sure's `disabled`, is not visible, so it is not listed.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: both Vitest projects pass.
- `pnpm test:e2e` -- expected: green; `packages/app/e2e/assistants.spec.ts` unaffected.

## Implementation Notes

- Review fix (AD-1, AD-19): `create_category`, `update_category` and `update_tag` call one service function beside `services/names.ts` reads: `namesOf` checks a parent's or a category's id and names a written category's parent; `tagIdNamed`, restored to return `undefined` for no tag, finds the tag by its name stripped of outer spaces, as Sure's `find_by(name: params["name"].to_s.strip)`. Sure's order stays: `not_found` before `no_changes`.
- Review fix: `ToolRefusal` carries the `ErrorCode` `assistant_calls` records; Sure's keys are a closed union in `tool.ts`, `name_required`, `no_changes` and `validation_failed` recording `VALIDATION_ERROR`, `not_found` and `parent_not_found` `NOT_FOUND`, pinned in `categories.spec.ts` and `tags.spec.ts`.
- Review fix: the descriptions of `create_goal`, `preview_import`, the rule writes, `record_valuation` and `create_transaction` say which refusals answer `{ error, hint }` from the input and which `validation_error` from the service.
- Review fix: `page` and `page_size` read text as Ruby's `to_i`, a blank one as absent, and the default size is `DEFAULT_PAGE_SIZE`.
- Review fix: a missing `name` in `create_category` and `create_tag` reaches `run` blank and answers `name_required`; `name` stays required in the advertised JSON Schema.
- Review fix: a blank `color` or `icon` in `create_category` and `update_category` reads as absent, as Sure's `presence`.
- Review fix: `get_accounts`' `type` enum is built from `SURE_TYPES`.
- Review fix: `INSTRUCTIONS` says what each tool writes today: `get_accounts` Sure's decimal text and numbers in its series, the others two-decimal strings; a service refusal's message drops its trailing period before its details; `periodInterval`'s bounds, `get_merchants`' clamping and `name` required in the advertised `create_category` and `create_tag` schemas are pinned.

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| A tool calls `listCategories`/`listTags` beside its write (AD-1) | medium | `create_category`, `update_category`, `update_tag` made two service calls. | patch: `services/names.ts` reads |
| `assistant_calls` records Sure's keys uppercased, not the codes it recorded | medium | `VALIDATION_FAILED`, `NO_CHANGES` appeared where `VALIDATION_ERROR` was recorded. | patch: `ToolRefusal.outcome` |
| Refusal keys are free strings | low | `refuse` took any string. | patch: closed union |
| Descriptions say a refused field answers `validation_error` where the input answers `{ error, hint }` | low | Zod refusals never reach `appRefusal`. | patch |
| A numeric string `page_size` reads 50, Sure's `to_i` reads it | low | `.catch(50)` | patch |
| A missing `name` answers an argument refusal, Sure's `name_required` | low | `name` was required by Zod. | patch |
| A blank `color` or `icon` is refused, Sure ignores it | low | `categoryColor` checked the format. | patch |
| `type` enum repeats `SURE_TYPES` | low | Two lists to keep aligned. | patch |
| `INSTRUCTIONS` amounts sentence false for every tool but `get_accounts` | low | Others still answer `"-12.50"`; series values are numbers. | patch |
| `.;` between a message and its details | low | « …preview's.; created 5 » | patch |
| Typo `invalid_columns.columns` in `preview_import` | low | Real answer is `csv.columns invalid_columns`. | patch |
| `periodInterval` bounds untested | low | No test at 12 and 60 months. | patch: tests |
| `get_merchants` clamping untested | low | Only categories and tags covered. | patch: test |
| `required: ["name"]` in the advertised schema untested | low | `z.preprocess` could drop it unnoticed. | patch: test |
| `update_tag` trimmed and NFC-normalised the name | low | Sure strips only; the color-only answer echoed the raw name. | patch: strip, answer the stored name |
| `INSTRUCTIONS` drops `left_out_count` while reports still answer it | low | Frozen intent asks for it; each field's description in its `outputSchema` still tells the assistant to say so. | rejected |
| `validation_failed` beside `validation_error` for a taken name | false | The intent gives Sure's code where Sure's function has one; Sure has no merchant write. | rejected |
| A too-long name answers `{ error, hint }`, Sure `validation_failed` | low | Rare; a mapping per field adds branches. | rejected |
| `?? toMinorUnits(0)` may write a false zero | maybe-false | The opening anchor bounds `start_date`, and `balancesBetween` fills every day from the last row on or before it; a missing day would need an account without its anchor's balance row. Settled by a test of an account whose first balances row is after its anchor. | rejected (low if true) |
| `sprint-status.yaml` and the spec disagree | false | Both move to `done` together at the end of the review. | rejected |
| `percentage` has no production caller | low | The acceptance criteria ask for it here, for 27.12. | rejected |
| Advertised pagination schema lacks `integer`, default and bounds | low | Descriptions state them; the call reads any value. | rejected |
| No guard comparing `currency-symbols.ts` to `CURRENCY_CODES` | low | A missing symbol shows the code, as intended. | rejected |
| Refusal messages echo an unbounded `name` or `parent_id` | low | Sure echoes them the same way; the caller wrote them. | rejected |
| `is_linked` true for a pending connection | false | Sure's `linked?` reads any provider link, whatever its state. | rejected |
| `last_5_years` on 29 February steps by month | false | Sure's `advance(years:)` clamps the same way and answers `1 month` too. | rejected |
| The interval comes from the clamped range, not the period | false | Sure calls `effective.interval` on the clamped `Period.custom`. | rejected |
| A page beyond `MAX_SAFE_INTEGER` reads 1 | low | Never sent in practice. | rejected |
| `percentage(NaN)` throws | low | No caller yet; 27.12 brings the values. | rejected |
