---
title: 'Story 12.4: The remaining screens'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_commit: 'cbd87c5e5383cab6e4040d0c78d1624d4aee6a96'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Outside the dashboard, transactions and accounts, the screens still wear Epic 1's look: bare tables and `divide-y` lists, `h2 text-lg` headings, shadcn `Card`s on sign-in, setup and security, an 8 px `CategoryDot`, outline `Badge`s for recurring statuses, plain-text empty states without an action, consent states as loose text, and no logo outside the sidebar.

**Approach:** Add one `Section` and one `EmptyState` component and rebuild every listed screen from them, `TintedIcon`, `CategoryPill` and an extended `StatusBadge`; put the arch logo above sign-in, setup and the root error page; extend the contrast test to every new text pair.

## Boundaries & Constraints

**Always:**
- `Section`: DESIGN's section (`bg-section`, 8 px radius, border), a header row holding a heading (level 2 by default, 3 where it nests under a page heading) in `type-title` and an optional action, a `border-line` line, then the content; the `section` is labelled by its heading. Lists inside have no second border.
- `EmptyState`: inside a section, a `lg` `TintedIcon`, a heading, one muted sentence, one primary action. `DashboardEmpty` renders through it, unchanged to the eye.
- Recurring: the table in a `Section`; the name cell gains the merchant's `sm` letter icon, the account cell the account's `sm` type icon (`accountType` added to `GET /api/recurring`, read in the join that gives `accountName`). Statuses become `StatusBadge`s: `detected` `Sparkles`, `confirmed` `CircleCheck`, `inactive` `CirclePause`, and « Ajoutée à la main » `Hand`, all neutral. Empty: `Repeat`, « Aucune récurrence pour l'instant », the current sentence, « Détecter les récurrences ».
- Rules: the list and the runs table each in a `Section`. Empty list: `ListFilter`, « Aucune règle pour l'instant », one sentence, « Ajouter une règle ». The rule dialog's category shows a `CategoryPill`.
- Settings: each sub-page's `h2` takes `type-display`; its content sits in `Section`s, the add button in the section header. Categories: one `Section` per kind, `h3` headings, rows with the category's `md` `TintedIcon` instead of dot plus muted icon; an empty kind shows an `EmptyState` whose « Ajouter une catégorie » opens `CategoryDialog` with that kind preset. Merchants: rows with the `md` letter icon; empty state `Store`, « Ajouter un marchand ». Tags: rows unchanged but in a section; empty state `Tag`, « Ajouter une étiquette ». Security: the two `Card`s become `Section`s.
- Banks: the picker, the connections and the credentials each in a `Section`, and the same on a connection's page. A connection row shows its consent or sync alert as a warning `StatusBadge`, `consentExpiring`, `consentExpired` or `syncStale`, from `connection.alert`. Empty connections: `Landmark`, « Aucune banque connectée pour l'instant », one sentence, « Choisir une banque », which focuses the picker's first control. The credentials notice drops `border-amber-500/50` for the warning token.
- Import dialog: the current step's number on `primary`, done steps with a check; each preview tab's count in a 20 px `bg-badge` counter; notices on section tokens, errors on `destructive`.
- `AccountMenu`: a 14 px lucide icon before each item (`Pencil`, `EyeOff`/`Eye`, `CirclePause`/`CirclePlay`, `Trash2`).
- `CategoryDot` is deleted: `CategoryCombobox`, `TransactionFilters` and `TransactionSheet` show the category's `sm` `TintedIcon`.
- Sign-in, setup, root error: centred on `bg-background`, the 32 px `ArchLogo` above « Archant », then the form or message in a 10 px-radius `bg-panel` bordered box without shadow. No `components/ui/card` import remains.
- Accessible names, heading levels, list names, button texts and `alert`/`status` texts stay; only empty-state texts gain the new heading.

**Never:** no edit to `components/ui/*` (dialogs keep shadcn's ring and shadow), no restyle of `BulkBar`, `Pagination` or the filter chips, no refactor of the dashboard's and accounts' inline sections, no empty state with an action for secondary lists (rule runs, import preview tabs, CSV preview, a connection's shared accounts, import history), which keep their muted sentence, no new endpoint, no tag colour.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Consent expiring | `alert: consent_expiring` | warning badge « Consentement bientôt expiré » | N/A |
| Stale sync | `alert: sync_stale` | warning badge « Synchronisation en retard » | N/A |
| No alert | `alert: null` | no badge, consent date as today | N/A |
| Empty kind | no income category | income section shows the empty state; its button opens the dialog on « Revenu » | N/A |
| Manual confirmed series | `status: confirmed`, `manual: true` | two neutral badges | N/A |

</frozen-after-approval>

## Code Map

Paths relative to `packages/app/src/` unless stated.

- `components/DashboardEmpty.tsx` -- the empty-state pattern to lift into `EmptyState.tsx`; tested at `e2e/dashboard.spec.ts:318-335`.
- `components/BalanceSheetSection.tsx:103-108` -- section markup to lift into `Section.tsx`.
- `components/StatusBadge.tsx:12` -- `STATUSES` map; add `recurringDetected`, `recurringConfirmed`, `recurringInactive`, `recurringManual`, `consentExpiring`, `consentExpired`, `syncStale` (the last three `warning: true`).
- `components/TintedIcon.tsx`, `lib/tint.ts:25` (`merchant`, `category`, `account`, `transfer{icon}` subjects), `components/CategoryPill.tsx`, `components/ArchLogo.tsx` (size via `className`).
- `routes/_authed.recurring.tsx:41` (`BADGES`, delete), `:157` (empty), `:161` (table); `packages/api/src/services/recurring.ts:35,251` -- `accountType` beside `accountName`.
- `routes/_authed.rules.tsx:366` (mobile notice, keep), `:398-400` (empty and list), `:179-223` (runs); `components/RuleDialog.tsx:256` (`CategoryDot`).
- `routes/_authed.settings.categories.tsx:52-53,100,104,165`; `components/CategoryDialog.tsx:36-43` -- add an optional preset `kind`.
- `routes/_authed.settings.merchants.tsx:47,149,156`, `_authed.settings.tags.tsx:111-142`, `_authed.settings.security.tsx:107,205`.
- `routes/_authed.settings.banks.tsx:100,250,332,371,485-545,569`; `_authed.settings.banks_.$connectionId.tsx:131,442,451`.
- `components/ImportDialog.tsx:70-90` (steps), `:283-290` (tab counts), `:213,264,270` (notices).
- `components/AccountMenu.tsx:94-135`; `components/CategoryDot.tsx` (delete), its users `CategoryCombobox.tsx:102,125`, `TransactionFilters.tsx:118`, `TransactionSheet.tsx:158,385`.
- `routes/sign-in.tsx:106`, `routes/setup.tsx:121`, `components/RootError.tsx:28`.
- `styles.spec.ts:30-46` (pair arrays), `:92-102` (`over()` composite for the warning tint) -- add the warning badge on `section` and `panel`, `BankAlerts`'s `warning/10` on `panel`, `foreground-secondary` on `badge` over `section`, `primary-foreground` on `primary` for the step number.
- e2e constraints: `merchants.spec.ts:156-158` and `tags.spec.ts:120-122` find the add button through the empty text's parent; `rules.spec.ts:66,181,251` match « Aucune règle pour l'instant. » exactly; `categories.spec.ts:81-169` reads the first `span[aria-hidden]` colour; `categories.spec.ts:14` and merchants/tags `:12` find a row through `Actions pour X`'s parent; `bank-connections.spec.ts:34,106,282,318` list names; `import-*.spec.ts` `[aria-current="step"]` text; `auth.spec.ts:17-45` and `auth.setup.ts:18-41` exact texts. Update the spec files, never the names.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/app.spec.ts` -- written first: `accountType` on `GET /api/recurring`; then `services/recurring.ts`.
- [x] `styles.spec.ts` -- written first: the new pairs, failing where a token is missing.
- [x] `e2e/brand.spec.ts` (or `e2e/outside-shell.spec.ts`) -- written before the UI: on `/sign-in`, `/setup` (fresh-database route mock as `start-error.spec.ts` does) and the root error page, `img` « Archant » visible and `body` background `rgb(background)` in light and dark.
- [x] `e2e/empty-states.spec.ts` -- written before the UI: recurring, rules, banks connections, a category kind, merchants and tags each show `[data-slot="empty-state"]` with a `tinted-icon`, its heading and exactly one button that does its job (the category one opens the dialog on the right kind).
- [x] `e2e/recurring.spec.ts`, `bank-connections.spec.ts`, `categories.spec.ts`, `import-*.spec.ts` -- assertions for the badges, row icons, tab counters and step state.
- [x] `components/Section.tsx`, `EmptyState.tsx`, `DashboardEmpty.tsx`, `StatusBadge.tsx`, `locales/fr.json`.
- [x] Recurring, rules, `RuleDialog`, settings layout and sub-pages, banks and connection page, `CategoryDialog`.
- [x] `ImportDialog.tsx`, `AccountMenu.tsx`, `CategoryDot` removal.
- [x] `sign-in.tsx`, `setup.tsx`, `RootError.tsx`.
- [x] Remaining e2e fixes from the Code Map.

**Acceptance Criteria:**
- Given the finished story, when the `AGENTS.md` verification gate and `pnpm test:e2e` run, then all pass and no tracked file changes.
- Given `grep -rn "components/ui/card\|CategoryDot\|amber-" packages/app/src`, when it runs, then it finds nothing.

## Implementation Notes

- `OutsideShell.tsx` frames sign-in, setup and the root error page, so the logo header is written once. Under shadcn's names DESIGN's base `background` is `bg-sidebar` and its `panel` is `bg-card`; the page is on the first, the box on the second, and the e2e test reads `main`'s background, since `body` stays the panel colour.
- Categories keep their add button beside the page `h2`: there is one section per kind, and two header buttons of the same name would be ambiguous. An empty kind's own button opens the dialog on that kind.
- An empty list hides the duplicate add or detect button of the title bar or section header, so the empty state holds the one way forward, as the dashboard does.
- Section titles: « Toutes les récurrences », « Ordre d'application », « Tous les marchands », « Toutes les étiquettes », « Connecter une banque », « Synchronisation ». Empty-state icons: `Repeat`, `ListFilter`, `Shapes`, `Store`, `Tag`, `Landmark`; bank badges `ClockAlert`, `TriangleAlert`, `RefreshCwOff`; the bank-linked account's « Déconnecter » menu entry takes `Unplug`.
- The settings layout needed no change: its navigation already has icons and the active entry's colour since Story 12.1.
- A recurring series without a merchant shows its label's first letter, the name the row prints.
- Spec-review pass, kept as they are: the `transfer` subject as the empty states' indigo tint, the one `DashboardEmpty` set in Story 12.2; the import tab counter drawn like `StatusBadge` rather than shadcn's `Badge`, whose 10 px radius is not DESIGN's 5 px badge; the bank picker's bordered buttons, a grid of choices rather than a list of rows; the repeated category subject and the merchants and tags pages' shared shape, which predate this story.
- QA on built servers with fresh databases, baseline and this branch, light and dark at 1280 px: setup, sign-in, the root error page, recurring, rules, categories, merchants, banks and security.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Route | Evidence |
|-------|---------|---------|-------|----------|
| blind, edge | Empty recurring page shows two detect buttons | low | patch | title bar kept « Détecter » beside the empty state's |
| edge | Rules: cached empty list plus a failed refetch leaves no add button | low | patch | header hidden on `ready && list.length === 0`, empty state needs `failed === undefined` |
| blind, edge | Bank return page keeps `h2 text-lg` and an Epic 1 error box | low | patch | `_authed.settings.banks_.callback.tsx:30,92` |
| blind | Load-error boxes differ between screens | low | patch | recurring, rules, categories keep `border p-8` without `bg-section` |
| blind | Institutions error draws a second border inside its section | low | patch | direct class change |
| blind | `INSET` duplicated in recurring and rules | low | patch | two copies will diverge as more tables enter sections |
| gap | Rule dialog's category pill untested | medium | patch | assertions read text only (`rules.spec.ts:159,698`) |
| gap | TintedIcons replacing `CategoryDot` untested in sheet, filter, combobox | medium | patch | no e2e opens these with an icon assertion |
| gap | Merchant letter icon untested | medium | patch | `merchants.spec.ts` never reads the row icon |
| blind, edge | Up to three « Ajouter une catégorie » buttons when kinds are empty | low | reject | defaults seed both kinds, and the empty kind's button presets its kind, a different action; hiding needs a new branch |
| blind | Import steps and counters tested for OFX in light only | low | reject | one component serves every format; dark pairs are in `styles.spec.ts` |
| blind | Done step and tab counter lack a dark e2e check | false | reject | `foreground-secondary` on `badge` is a checked pair in both modes |
| blind, gap | `Unplug` icon on « Déconnecter » is outside the spec | false | reject | the intent asks for an icon before each item; that entry is one |
| blind | Sprint status and spec status disagree | false | reject | step 5 moves the sprint to `review` |
| blind | Heading levels of new sections untested | low | reject | a test per heading level asserts wiring, not behaviour |
| blind | `EmptyState`'s `labelled` prop duplicates `Section`'s frame | low | reject | one caller, the dashboard, which has no section around it |
| blind | A series without merchant shows its label's letter | low | reject | the letter is the name the row prints; recorded in the notes |
| blind | The visible word « Archant » is not asserted | low | reject | presentational; the named `img` is asserted |
| edge | A missing connection's not-found message sits inside the accounts section | low | reject | needs a deep link to a deleted connection; moving it adds a branch |
| edge | New section headings change the outline | false | reject | DESIGN's section carries a heading; existing headings and names are unchanged |
| edge | Header add button hidden on an empty list | false | reject | the same button text is in the empty state |
| edge | Settings layout task ticked with no diff | false | reject | nothing to change, recorded in the notes |

## Design Notes

Empty states follow Sure: its page-level lists (recurring, rules, categories, tags, merchants) show a title, a sentence and one primary action, while its secondary lists show a sentence alone; the second half is why rule runs and the import tabs keep theirs. The banks empty state points at the picker above rather than duplicating it. Dialogs are left to shadcn: its current primitives draw a `ring-foreground/10` edge, within one step of `border` on both panels, and editing `components/ui/*` is what Epic 12 forbids. `BulkBar`, `Pagination` and the filter chips already sit on tokens apart from the bulk bar's delete colour, which is inverted on purpose; left for a later pass.

## Verification

**Commands:**
- `pnpm test` -- expected: pass, including `styles.spec.ts`.
- `pnpm test:e2e` -- expected: pass.

**Manual checks (if no CLI):**
- Light and dark screenshots at 1280 px of `/recurring`, `/rules`, each settings page, a connection page, the import dialog's three steps, `/sign-in`, `/setup` and the root error page, next to the mock.
