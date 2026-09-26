---
title: 'Story 12.2: The dashboard'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_commit: 'ab08c8ff2e007e28525bddfb549f6b89a545fa9c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The dashboard is Epic 6's two plain cards: net worth with a line chart, and « Ce mois-ci » with dots and bars per category, under a dashed empty box. It has no greeting, no colour, no balance sheet, and the user has no first name to greet.

**Approach:** Add an optional « Prénom » at `/setup` and in « Réglages › Sécurité », stored as Better Auth's `user.name`. Rebuild the dashboard as `DESIGN.md` lays it out: greeting, net worth section with an area chart, then the month's flow with an outflows donut beside the balance sheet by account type.

## Boundaries & Constraints

**Always:**
- First name: one shared `firstNameSchema` (`z.string().trim().max(60)`), optional in `setupSchema`. Blank stores `""`; the e-mail local part is no longer the default. Better Auth's `databaseHooks.user.update.before` parses `name` with it, so `/api/auth/update-user` refuses what the form refuses. An existing name is never rewritten.
- Greeting: « Bonjour {name} » when `session.user.name.trim()` is non-empty, else « Bonjour ». It is a paragraph in `display` type; the title bar's « Tableau de bord » stays the page's only `h1`. The muted sentence is « Voici où en sont les finances du foyer. », or « Archant est prêt. Il ne manque que vos comptes. » with no account.
- Net worth section: `amount-hero` value, change with a lucide `TrendingUp`/`TrendingDown` arrow in `trend-up`/`trend-down` (the amount stays uncoloured), the period, Actifs and Passifs totals on the right, the period toggle in the section header. `BalanceChart` becomes a Recharts `AreaChart`: 1.5 px stroke in the accent, gradient from 14 % to 0 %, horizontal gridlines in `grid`, Y labels through a compact formatter (« 275 k€ »). Text summary, keyboard cursor, `isAnimationActive={false}` and the table toggle stay; the toggle reads « Voir le tableau ». The account page shares the chart and gets the same look.
- Month's flow section, titled « Flux de {mois année} » with the existing previous/next buttons: three cells, Revenus (`<Money signed plusSign>`), Dépenses, « Épargne du mois » (income + expenses, uncoloured, may be negative). A « Dépenses / Revenus » segmented control, Dépenses first, keeps FR35's income breakdown. Below, a thin Recharts `Pie` donut of the chosen side's lines in category colours, total in its centre, `role="img"` with a summary label; beside it, one row per line: `TintedIcon`, name, amount, share, linking to `/transactions` filtered as today. « Sans catégorie » uses the uncategorised tint. A line whose sign runs against its side (a net refund) keeps its row and has no donut segment.
- The cash-flow API adds `icon` to each line, read from `categories.icon`.
- Balance sheet section « Bilan » with « Tous les comptes » linking to `/accounts`: for Actifs then Passifs, the group `total` from `/accounts`, a 4 px bar split by account type in `type-*` colours, a dot legend with type label and percentage, then the group's active accounts with a `TintedIcon`, name, subtype caption and `AccountBalance`. Shares are type sums over the group total, over accounts counted in that total (active, included, reporting currency); a type whose sum is ≤ 0 gets no segment or legend entry. The bar is `aria-hidden`; the legend carries the numbers.
- Title bar action, decided by the owner on 2026-09-26: one, « Ajouter un compte », opening `CreateAccountDialog`, as Sure's dashboard does. The epic's « the two actions » reads as this one action; import and new transaction stay on the account page, which knows the account.
- Layout: net worth full width, then two columns from 1024 px, stacked below. Sections use `section` background, 8 px radius, 1 px border, `title` type headers.
- Empty state (no account): the greeting, then one section with a `lg` `TintedIcon` (`Landmark`, transfer colour), « Aucun compte pour l'instant », the existing sentence, and « Ajouter un compte » opening `CreateAccountDialog`. No title bar actions.

**Never:** no new report endpoint (per-type totals are computed from `/accounts`), no dashboard reordering or hiding of sections (Sure has it, no Archant requirement), no Sankey, no last name, no change to `UserMenu` (it keeps the e-mail), no restyle of the setup or security pages beyond the new field (Story 12.4), no colour on balances or totals.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Setup, no first name | `name` absent or `"  "` | user created with `name: ""`; greeting « Bonjour » | N/A |
| Setup, first name | `" Camille "` | `name: "Camille"` | N/A |
| Too long | 61 characters at setup or in Sécurité | not stored | 400 `VALIDATION_ERROR` at setup; Better Auth 400 on update; inline field error in both forms |
| Existing admin | `name: "admin"` from the old default | greeting « Bonjour admin » until changed | N/A |
| Clear the name | Sécurité, field emptied, saved | `name: ""`; greeting « Bonjour » without reload | N/A |
| Net refund month | expense line `+20,00 €` | row shown, no donut segment | N/A |
| Overdrawn account only | Actifs total ≤ 0 | no bar segments, accounts still listed | N/A |
| Foreign-currency account | USD account active | listed under its group, outside bar shares; the net worth notice stays | N/A |

</frozen-after-approval>

## Code Map

- `packages/api/src/schemas/setup.ts:11-17` -- add `firstNameSchema`, optional `name`.
- `packages/api/src/services/setup.ts:62` -- replace the local-part default.
- `packages/api/src/services/setup.spec.ts:60-78` -- expects `name: "Admin"`; becomes `""`, plus the given-name case.
- `packages/api/src/services/auth.ts:60-75` -- add `databaseHooks.user.update.before`; `/update-user` is already reachable (`ADMIN_PATHS` blocks `/admin/*` only). Pattern for an update test: `routes/middleware/auth.spec.ts:91-100`.
- `packages/app/src/routes/setup.tsx:24-33,131-169` -- form schema, `API_FIELDS`, fields; field before e-mail.
- `packages/app/src/routes/_authed.settings.security.tsx` -- new first-name card above the password card, same react-hook-form + `zodResolver` pattern; `authClient.updateUser` (`lib/auth-client.ts:10-13`), then invalidate `queryKeys.session` and `router.invalidate()`, because `_authed.tsx:16-19` puts the session in route context and `sessionQuery` has `staleTime: Infinity`.
- `packages/app/src/routes/_authed.index.tsx` -- `NetWorthCard` (:78-135), empty state (:188-194), `Page` without actions (:169).
- `packages/app/src/components/CashFlowCard.tsx` -- rewrite; keep month navigation (:136-154), placeholder `inert` (:171-175), category links.
- `packages/app/src/components/BalanceChart.tsx` -- `LineChart` → `AreaChart`; `Summary` (:74-94), table toggle (:280-297), `PeriodToggle` (:210-239).
- `packages/api/src/services/reports.ts:141-149`, `domain/cash-flow.ts:55-72` -- select and pass `icon`; `domain/cash-flow.spec.ts`.
- `packages/app/src/hooks/useAccounts.ts:16` -- groups with `total`, `excludedCount`, `AccountSummary.type/subtype/currency`. `lib/account-kinds.ts` (`kindOf`) for the subtype caption; `lib/tint.ts:42-49` (`ACCOUNT_TYPE_TINTS`) for colours and icons.
- `packages/app/src/lib/balance-change.ts` -- add the compact formatter next to `formatSignedMoney`; no `notation: "compact"` exists yet.
- `packages/app/src/locales/fr.json:41-58` (`dashboard`), `:1039` (`security`), `:1048` (`setup`), `balances.showData`.
- e2e: `dashboard.spec.ts` (regions « Patrimoine net », groups Actifs/Passifs, cash-flow regions by month heading, empty state at :113), « Voir les données » in `dashboard.spec.ts:40` and the account page specs, `auth.setup.ts:16-29` (creates the admin; add a first name there), `password.spec.ts` runs last and revokes sessions.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/setup.spec.ts`, `routes/middleware/auth.spec.ts` -- written first: matrix rows 1-3 at setup; `update-user` stores a trimmed name, clears it, refuses 61 characters.
- [x] `schemas/setup.ts`, `services/setup.ts`, `services/auth.ts` -- schema, setup default, update hook.
- [x] `domain/cash-flow.spec.ts`, `domain/cash-flow.ts`, `services/reports.ts` -- `icon` on every line, `null` for « Sans catégorie ».
- [x] `packages/app/src/lib/balance-sheet.spec.ts`, `balance-sheet.ts` -- pure: groups from `/accounts` → per-type sums and shares; matrix rows 7-8, liabilities, excluded and inactive accounts.
- [x] `lib/balance-change.spec.ts`, `balance-change.ts` -- compact formatter: `27500000` EUR minor units → « 275 k€ », millions, negatives.
- [x] `packages/app/e2e/dashboard.spec.ts` -- written before the UI: greeting with and without first name, the hero, trend arrow and totals, « Voir le tableau », the three flow cells, « Ajouter un compte » in the title bar opening the dialog, the Dépenses/Revenus switch changing the rows, the donut labelled, the Bilan legend percentages and account rows, the empty state; existing assertions moved to the new names.
- [x] `packages/app/e2e/settings-profile.spec.ts` (or inside an existing settings spec) -- set, clear and refuse a first name in Sécurité, the dashboard greeting following.
- [x] `routes/setup.tsx`, `routes/_authed.settings.security.tsx`, `fr.json`, `auth.setup.ts` -- the fields.
- [x] `components/BalanceChart.tsx` -- area chart, compact Y labels, « Voir le tableau ».
- [x] `components/NetWorthSection.tsx`, `components/CashFlowSection.tsx` (replacing `CashFlowCard.tsx`), `components/BalanceSheetSection.tsx`, `components/DashboardEmpty.tsx`, `routes/_authed.index.tsx` -- the layout.
- [x] Remaining e2e fixes for the account page chart toggle.

**Acceptance Criteria:**
- Given the finished story, when the `AGENTS.md` verification gate and `pnpm test:e2e` run, then all pass and no tracked file changes.
- Given the dashboard in light and dark, when the contrast test of Story 12.1 runs, then no new token pair is introduced without being covered.

## Implementation Notes

- The update hook throws `APIError` rather than returning `false`: with `false`, `/update-user` answers success having stored nothing.
- `lib/chart-axis.ts` (tested) computes round Y ticks: on a flat series every compact label read « 4,9 k€ ». The padding never takes a positive series below zero.
- The flow heading reads « Flux de {mois année} » for the current month too, eliding before a vowel (« Flux d'avril 2024 », `ofMonth` in `lib/dates.ts`); `monthHeading` lost its last caller and is gone.
- The empty dashboard's sentence is `EXPERIENCE.md`'s; `TintSubject`'s transfer kind takes an optional icon for its `Landmark`. `styles.css` gains `type-display` and `type-title` utilities, no colour.
- Shares show at most one decimal (« 39,4 % »). Positive donut-row amounts carry a `+`, uncoloured.
- e2e: the net-refund case uses August 2024 (June 2024 belongs to `transfers.spec.ts`); `settings-profile.spec.ts` restores « Camille » after each test, since the administrator is shared.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Route | Evidence |
|-------|---------|---------|-------|----------|
| blind, edge | A 400 from `/update-user` shows « Valeur invalide. », setup shows « Ce texte est trop long. » | low | patch | the form's body is fixed, so the hook's refusal is the only 400; message set to `too_big` |
| blind, edge, gap | `monthHeading` is dead | low | patch | no caller outside `dates.spec.ts` |
| gap | No test asserts a categorised flow row's icon | medium | patch | inverting the `icon === null` test keeps the suite green |
| blind, gap | Sprint `last_updated` went backwards | low | patch | timestamp rewritten |
| blind | Legend shares can exceed 100 % beside an overdrawn account | low | reject | the frozen intent divides by the group total, as Sure's weights do |
| blind | Excluded and foreign accounts listed without a marker | false | reject | `AccountBalance` shows the eye-off marker; a foreign balance shows its own currency, and the net worth notice names it |
| blind, edge, gap | Donut centre shows the net total, not the drawn segments' sum | low | reject | Sure's centre shows `total_net_expense` too; only a net-refund month differs |
| blind | Donut segments use the base colour, not the adjusted tint | false | reject | the mock: « Les segments de l'anneau et des barres gardent la couleur de base »; uncategorised is the muted text colour by DESIGN |
| blind | ProfileCard 400 and 401 branches untested in e2e | low | reject | 401 mirrors the tested password card; 400 is unreachable from the form |
| blind, edge | Trend arrows, type bar and dots not in the contrast test | low | reject | all `aria-hidden` decoration; the sign and the legend text carry the meaning (WCAG 1.4.11 exempts them) |
| blind, edge | `axisTicks` assumes two decimals; a flat JPY series may repeat labels; 99 900 flat may print « 1 k€ » twice | low | reject | the reporting currency is euro; a guard means a new parameter |
| blind | Dépenses/Revenus choice not in the URL | low | reject | the intent does not ask it; a new search param is new surface |
| edge | Every account inactive leaves « Bilan » empty | low | reject | the dashboard then shows only headers; unlikely, a guard adds a branch |

## Design Notes

« Bonjour » is not the `h1` because every signed-in page announces its title through `Page`'s `h1` (Story 12.1), and a screen reader landing on « Bonjour Camille » learns nothing about where it is. The balance sheet computes on the client because `/accounts` already returns every account with its type and today's balance, and the sidebar reads the same query: one source, no second endpoint to keep in step. The Dépenses/Revenus switch comes from the mock; without it, the income breakdown FR35 requires would leave the dashboard.

## Verification

**Commands:**
- `pnpm test` -- expected: pass, including the new specs.
- `pnpm test:e2e` -- expected: pass.

**Manual checks (if no CLI):**
- Light and dark screenshots of `/` next to `mockups/key-linear-classic-dark.html`, at 1280 px and 800 px.
