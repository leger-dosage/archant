---
title: 'Story 28.10: Other asset and other liability accounts'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_commit: '000046cf0c0da0b84f018adc5ac9d033ade322da'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant has no account for jewellery, a loan from a relative or anything outside its six types. Sure `00dd977fb` has `OtherAsset` and `OtherLiability` (`app/models/other_asset.rb`, `other_liability.rb`): no subtype, no details, both `:non_cash` in `Account#balance_type` (`app/models/account.rb:716`), so only valuations move them.

**Approach:** Add `other_asset` and `other_liability` to `ACCOUNT_TYPES` with `balanceType: "non_cash"`, migrate the `accounts` check constraints, and give each one its place wherever a record keyed by `AccountType` or a list of types exists: creation, edit, tints, balance sheet, transfer kind, `get_accounts`, export.

## Boundaries & Constraints

**Always:**
- Order as Sure's `Accountable::TYPES`: `other_asset` after `vehicle`, `other_liability` last, in `ACCOUNT_TYPES`, `TYPE_ORDER` and at the end of `ACCOUNT_KINDS`, as Sure's `accounts/new` lists them last. Both `subtypes: []`.
- Words from Sure's `fr.yml`: the type « Autre actif » / « Autre passif » (`accounts.subtypes`, the select and the row caption), the group « Autres actifs » / « Autres passifs » (`dashboard.balanceSheet.types`, the legend and the sidebar).
- An « Autre actif » shows Sure's `other_assets.new.balance_tracking_info` in the creation dialog while chosen, and in its edit dialog, as an info notice above the fields: « Les autres actifs sont suivis via des valorisations manuelles à l'aide de « Ajouter un solde », et non via des transactions. Les flux de trésorerie n'affecteront pas le solde du compte. » An « Autre passif » shows none, as Sure's `other_liabilities/new` and `edit`.
- Non-cash through `transactionsMoveBalance`, which already returns false for any `non_cash` type but a loan: a transaction or a transfer leaves either balance as it was; valuations set it forward, AD-8's rules unchanged.
- Transfer kind as Sure's `Transfer.kind_for_account`: into an other liability `credit_card_payment` (its `account.liability?` branch), into an other asset `internal_move`.
- `get_accounts` and the export write Sure's `OtherAsset` / `OtherLiability`, `subtype` null, `accountable` `{ subtype: null }`.
- Tints: `other_asset` `#27a644` with lucide `PlusIcon`, `other_liability` `#737373` with `MinusIcon`, Sure's `plus` and `minus`; `--type-other-asset` and `--type-other-liability` in `styles.css` and DESIGN.md.
- Edits: AD-8 and AD-11 in `docs/architecture.md` name the new types; `docs/sure-parity.md` splits « Crypto, other asset, other liability » into « Crypto » (No) and « Other asset, other liability » (Parity, Story 28.10).

**Never:** no details schema, overview tab or subtype for either type; no bank link (`BANK_ACCOUNT_TARGETS` unchanged); no change to `recomputeNonCashBalances` or its settings key, since no account of these types exists yet; no step-by-step creation or per-type dialog title (Story 28.16); no crypto (Story 28.11).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Asset created | « Autre actif », 5 000 € on 1 May | in « Actifs », caption « Autre actif », net worth +5 000 € | none |
| Liability created | « Autre passif », 2 000 € | in « Passifs », net worth −2 000 € | none |
| Repaying a relative | transfer 500 € checking → other liability | debt stays 2 000 €; kind `credit_card_payment` | none |
| Selling a ring | transaction +300 € on the other asset | value stays 5 000 € | none |
| Valuation | snapshot 6 000 € on 20 May | 5 000 € to 19 May, 6 000 € from 20 May | none |
| Subtype sent | `other_asset` with subtype `savings` | refused | `400` `VALIDATION_ERROR`, `subtype` field |
| Details sent | `other_liability` with `details` | refused as on a depository | `400` `VALIDATION_ERROR` |

</frozen-after-approval>

## Code Map

- `packages/data/account-types.ts:22-82` -- `ACCOUNT_TYPES`; the two entries. `transactionsMoveBalance` needs no change.
- `packages/data/schema/accounts.ts:41-60` -- both check constraints derive from `ACCOUNT_TYPES`; `pnpm data generate` writes `0078`, a table rebuild like `drizzle/0077_property_subtypes.sql`.
- `packages/api/src/domain/transfer-matching.ts:87-95` -- `kinds` record.
- `packages/api/src/mcp/accounts.ts:15-22` -- `SURE_TYPES`; `packages/api/src/services/export.ts:85-92` -- `SURE_ACCOUNTABLE_TYPES`. `testing/sure-preflight.ts:127,130` already accepts both with any subtype.
- `packages/app/src/lib/account-kinds.ts:53` -- append `{ id: "other_asset", … }`, `{ id: "other_liability", … }`.
- `packages/app/src/lib/balance-sheet.ts:12-19` -- `TYPE_ORDER`.
- `packages/app/src/lib/tint.ts:47-55`, `components/BalanceSheetSection.tsx:18-25`, `styles.css:56-61,129-134` -- colour and icon.
- `packages/app/src/components/CreateAccountDialog.tsx:88-104,195-240` -- `chosenDetails` default already sends none; notice under the type select when `type === "other_asset"`.
- `packages/app/src/components/EditAccountDialog.tsx:188,234` -- notice for `other_asset`; one kind, so no subtype select.
- Notice: shadcn's `alert` (`pnpm dlx shadcn@latest add alert`) into `components/ui/`, no new dependency; Archant has no info notice yet.
- `packages/app/src/locales/fr.json:98-105` (`dashboard.balanceSheet.types`), `:135` (`accounts.subtypes`), plus the notice text.
- Tests to model on: `domain/transfer-matching.spec.ts`, `services/ledger/balances.spec.ts` (Story 28.9's property cases), `routes/accounts.spec.ts`, `services/export.spec.ts`, `mcp/server.spec.ts` (`get_accounts`), `packages/data/account-types.spec.ts`, `e2e/accounts.spec.ts:1333-1357`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/account-types.spec.ts`, `domain/transfer-matching.spec.ts`, `services/ledger/balances.spec.ts`, `routes/accounts.spec.ts`, `services/export.spec.ts`, `mcp/server.spec.ts` -- every matrix row, failing first.
- [x] `packages/data/account-types.ts`, then `pnpm data generate` -- the types and migration `0078`.
- [x] `domain/transfer-matching.ts`, `mcp/accounts.ts`, `services/export.ts` -- the records.
- [x] `components/ui/alert.tsx`, `CreateAccountDialog.tsx`, `EditAccountDialog.tsx`, `account-kinds.ts`, `balance-sheet.ts`, `tint.ts`, `BalanceSheetSection.tsx`, `styles.css`, `fr.json` -- the interface.
- [x] `packages/app/e2e/accounts.spec.ts` -- create one of each through the dialog, read the notice for the asset only, the group and the caption.
- [x] `docs/architecture.md`, `docs/sure-parity.md`, DESIGN.md -- AD-8, AD-11, the parity rows, the two tokens.

**Acceptance Criteria:**
- Given an instance with existing accounts, when migration `0078` runs, then every row survives and the constraint accepts the two types with a null subtype only.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, and screenshots of the creation dialog with the notice, the edit dialog and the dashboard legend in light and dark themes are reviewed.

## Implementation Notes

- The export names an other asset's valuations as an investment's and an other liability's as a depository's, Sure's `Valuation::Name`; the `Record<SureAccountableType, …>` requires both.
- The creation dialog shows the notice under the type select: Sure's per-type dialog puts it above that type's form, which in Archant's single dialog starts after the type. Story 28.16's steps put it first.
- `TYPE_ORDER` derives from `ACCOUNT_TYPES` by classification, so Story 28.11's `crypto` cannot be forgotten there.
- `credit_card_payment` now reads « Paiement », Sure's `categories.virtual.payment`: since this story it also names a transfer into an other liability, where « Remboursement de carte » was wrong.
- `e2e/dashboard.spec.ts` « a category line opens its rows » scopes `/^Autre /` to `main`: the accounts column now shows « Autre actif ».
- Screenshots of both dialogs and the balance sheet legend, light and dark, reviewed.

## Spec Change Log

## Review Triage Log

| Source | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| standards | `SURE_TYPES` and `SURE_ACCOUNTABLE_TYPES` repeat one map | low | both existed before this story, each two lines longer now | rejected |
| standards, blind | `TYPE_ORDER` copied by hand, unguarded for a new type | low | a type missing there drops out of the legend without a type error | patch: derived from `ACCOUNT_TYPE_IDS` |
| standards | `VALUE_NAMES` and `ACCOUNT_VALUE_NAMES` read alike | low | names mirror Sure's own strings; renaming touches lines this story did not need | rejected |
| standards | `123_456 - amount` in `balances.spec.ts` leans on a fixture's hidden opening | low | the existing helper's balance, read the same way elsewhere in the file | rejected |
| standards, spec | `alert.tsx` exports unused `AlertTitle`, `AlertAction` | false | shadcn's file as generated, ignored by knip by convention | rejected |
| standards, spec | `dashboard.spec.ts` scoped to `main` | low | the label now also reads in the accounts column; commented | rejected |
| spec | No net worth assertion for the two types | low | the epic's criterion asks for it | patch: `services/reports.spec.ts` |
| spec, blind | Creation notice under the type select, not above every field | low | in one dialog the type comes first; Story 28.16 brings Sure's steps | rejected, noted |
| spec, blind | Screenshots not shown / spec and sprint status disagree | false | captures reviewed; the workflow syncs sprint status at its end | rejected |
| blind | Notice untinted where Sure's `:info` alert is blue | medium | `bg-card` and muted text against Sure's `bg-info/10 border-info/20` | patch: link-blue tint, foreground text |
| blind | Notice hard-codes the button's label | low | renaming `snapshots.add` would leave the notice naming a missing button | patch: `$t(snapshots.add)` |
| blind | A relative's loan repayment reads « Remboursement de carte » | medium | `credit_card_payment`'s label shown by `TransactionLinks.tsx` | patch: « Paiement », as Sure |
| blind | `forward.ts` comment names only property and vehicle | low | the flag is now false on four types | patch |
| blind | `index.ts`, `recomputeNonCashBalances` mention property and vehicle | false | they describe the one-time fix of values stored before Story 28.9, when only those existed | rejected |
| blind | `docs/project-overview.md` lists six types | low | stale list | patch |
| blind | Parity row hides the notice's wording change | false | the row says the notice names « Ajouter un solde » | rejected |
| blind | No valuation test on an other liability, no `current_anchor` export name test | low | same code path as the asset; names checked against Sure's `Valuation::Name` | rejected |
| blind | No snapshot `gap` test for the new types | low | `gapReader` reads `transactionsMoveBalance`, covered by Story 28.9 | rejected |
| blind | `account-group-totals.ts` re-filters `TYPE_ORDER` by class | low | harmless and untouched | rejected |
| blind | « Prêt de Mamie » beside « Prêt de Marie » | low | naming drift in tests | patch |
| edge, verification-gap | none | — | both layers returned no finding | — |

## Design Notes

The notice quotes « Ajouter un solde », Archant's button, where Sure's text quotes its own « Nouveau solde »: a notice naming a button the page lacks misleads.

Colours: Archant maps each Sure type colour to Linear's register (DESIGN.md); Sure's green `#12B76A` becomes the register's green `#27A644`. The register has no grey, so Sure's `#737373` stays. `adjustToContrast` already lifts a pill's text to its target.

The epic context predates one `epics.md` edit, Story 28.4's criteria only; it stays valid for this story.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.

**Manual checks (if no CLI):**
- On a local instance, create an « Autre actif », record a transaction on it: its value stays; « Ajouter un solde » changes it.
