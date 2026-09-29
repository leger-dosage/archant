---
title: 'Story 14.1: The shell and the scale'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: '05d2e824df2944e7ba5ffe14bf86b4f636a5c558'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-14-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The interface reads small everywhere: 13 px text, a 13 px page title inside a 44 px title bar, 32 px controls, 384 px dialogs, all inside Linear's sidebar and inset panel. Stories 14.2 to 14.4 need Sure's shell and Sure's scale to build on.

**Approach:** Drop the theme's size overrides so Tailwind's defaults apply, move the shadcn components to Sure's control sizes, and replace the shadcn `Sidebar` shell with Sure's: an 84 px rail, a foldable 320 px accounts column, a sticky top bar with breadcrumbs, and a page header above full-width content; below 1024 px a top bar, a bottom navigation and a full-screen accounts overlay.

## Boundaries & Constraints

**Always:**
- Surfaces: `--background` and `--sidebar` are DESIGN's `background` (`#F8F8F8` / `#1A1B1E`), `--card` its `container` (`#FFFFFF` / `#1F2023`), a new `--inset` its `inset` (`#F2F2F3` / `#252629`). `--section` is removed; its uses become `bg-card`, except the transactions day header, which becomes `bg-inset`. A `bg-background` inside a white surface becomes `bg-card` (tabs' active trigger, outline button, calendar, switch thumb, sticky chart table header) or `bg-popover` (chart tooltip).
- No `--text-*` override; the body is `text-sm` (14 px). No radius override: Tailwind's 4/6/8/12. Inter, its weights and `cv01`/`ss03` stay.
- Controls: button default `h-9` (sm `h-7`, lg `h-12`, xs `h-6`, icon `size-9`), input and select trigger `h-9`, `DialogContent` `sm:max-w-[550px]`, alert dialog `sm:max-w-[300px]`, `ImportDialog` and `RuleDialog` `sm:max-w-[700px]`, dropdown menus `min-w-[200px]`, tabs list `bg-inset` with the active tab on `bg-card`.
- Shell (`components/AppShell.tsx`, used by `routes/_authed.tsx`): rail `nav` named « Navigation principale » with Accueil (`/`), Opérations, Comptes, Récurrent, Règles, Réglages, the current one with `aria-current="page"` (Comptes current on `/accounts` only; Réglages on any `/settings` path), the avatar opening `UserMenu` (theme choice, Réglages, Se déconnecter). The accounts column is an `aside` named « Liste des comptes »: « Ajouter un compte » opening `CreateAccountDialog`, tabs Tout / Actifs / Passifs, active accounts grouped by type in the order of `ACCOUNT_TYPES`, each group headed by its type label and its total, each row a link with a `md` `TintedIcon`, the name over the subtype, and `AccountBalance`. The fold state lives in `useStoredFlag("archant.accountsColumn", true)`; settings pages render `SettingsNav` in its place.
- A group's total sums the balances of the active, reported accounts in the reporting currency, as the API's classification total does; a pure helper in `lib/` with Vitest cases.
- `Page.tsx`: the top bar (fold button on wide screens, breadcrumbs) and the page header (`h1` at 24 px with `PAGE_TITLE_ID`, optional `description`, actions), then `BankAlerts`, then the content: full width, `px-3 lg:px-10`, `gap-6`. The `icon` prop becomes optional and only feeds the breadcrumb-less header when a page passes an element (account pages keep their tinted icon beside the title).
- Below 1024 px: a top bar with the menu button (opens the accounts column as a full-screen `Sheet`, `Esc` closes), the logo and the avatar; a fixed bottom `nav` with the rail's entries; content leaves room above it.

**Never:** no route or API change; no sparkline or drag resize; no change to page contents beyond moving their title and actions into the new header (Stories 14.2 to 14.4); no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Group total | two EUR checking accounts, one USD, one excluded | the two EUR balances summed | USD and excluded left out |
| Tab filter | tab Passifs | only credit card and loan groups | empty tab shows nothing |
| Fold | fold, reload | column stays folded | storage unavailable: applies for the visit |
| No accounts | fresh instance | column shows « Ajouter un compte » only | — |

</frozen-after-approval>

## Code Map

- `packages/app/src/styles.css` -- tokens; drop `--text-sm`, body 13 px and radius overrides; add `--inset`, remove `--section`.
- `packages/app/src/styles.spec.ts` -- AA pairs over surfaces; replace `section`/`sidebar` surfaces with `card`/`inset`; the panel test becomes a container test.
- `packages/app/src/components/ui/{button,input,select,dialog,alert-dialog,dropdown-menu,tabs,calendar,switch,chart}.tsx` -- sizes and `bg-background` fixes above.
- `packages/app/src/routes/_authed.tsx` -- replaces `SidebarProvider`/`AppSidebar` with `AppShell`.
- `packages/app/src/components/AppSidebar.tsx` -- replaced by `AppShell.tsx` (rail, accounts column, mobile bars); reuse `SidebarAccountGroup`'s stored-flag idea and `AccountBalance`.
- `packages/app/src/components/ui/sidebar.tsx`, `hooks/use-mobile.ts` -- delete if nothing imports them afterwards.
- `packages/app/src/components/Page.tsx` -- new top bar and header; 11 callers keep their props.
- `packages/app/src/components/UserMenu.tsx`, `ThemeMenu.tsx` -- become the avatar's menu with a theme radio group; no `SidebarMenuButton`.
- `packages/app/src/routes/_authed.settings.tsx` -- `SettingsNav` exported for the shell; content `max-w-4xl mx-auto`.
- `packages/app/src/components/OutsideShell.tsx` -- `bg-sidebar` stays the base background.
- `packages/app/src/lib/account-types.ts` (or existing constants) -- `ACCOUNT_TYPES` order and classification.
- `packages/app/e2e/{brand,keyboard,accounts,manage-accounts,bank-connections,rules,settings-profile}.spec.ts` -- locate the rail and the column by role and name instead of `[data-sidebar]`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/lib/account-group-totals.ts` + spec -- per-type grouping and totals, test first.
- [x] `packages/app/src/styles.css`, `styles.spec.ts` -- tokens and scale.
- [x] `packages/app/src/components/ui/*` -- sizes and surfaces.
- [x] `packages/app/src/components/AppShell.tsx`, `routes/_authed.tsx`, `Page.tsx`, `UserMenu.tsx`, `ThemeMenu.tsx`, `routes/_authed.settings.tsx`, `locales/fr.json` -- the shell.
- [x] Remove `AppSidebar.tsx`, `ui/sidebar.tsx` and `use-mobile.ts` once unused.
- [x] `packages/app/e2e/*` -- adapt locators; add tests for the rail, the column's tabs and totals, the fold surviving a reload, the bottom navigation at 390 px, the settings nav in place of the column.

**Acceptance Criteria:**
- Given any signed-in page at 1440 px, when it renders, then the rail, the accounts column and the top bar show, the `h1` is 24 px and body text 14 px.
- Given a phone width, when a page renders, then the bottom navigation holds the six destinations and the menu opens the accounts column.

## Implementation Notes

- `SettingsNav` lives in `components/SettingsNav.tsx`: a route file may only export `Route` under the router's code splitting, and `Page` reads the sections for the breadcrumbs.
- Account groups: assets then liabilities, each in `TYPE_ORDER`; the reporting predicate and the order are shared with `lib/balance-sheet.ts` (`countsInReports`, `TYPE_ORDER`).
- Rail labels « Accueil » and « Récurrent » as DESIGN.md names them; page `h1`s unchanged until Stories 14.2 to 14.4.
- Breadcrumbs are a row of links, not a list: a list inside `main` inflated the `listitem` counts many tests make.
- Playwright projects run at 1440 by 900, DESIGN.md's reference screen; at 1280 a row's centre fell on the category pill.
- Badge `rounded-md`: without the radius override `rounded-4xl` made it a pill. The bank picker dialog takes the default 550 px. `BankAlerts` lost its own padding, which `Page` now gives. Below 1024 px toasts, `BulkBar` and `main` clear the bottom navigation and the safe area.
- Visual QA after review: the new header gave the dashboard two titles and left settings' title outside their centred column. As in Sure's `pages/dashboard.html.erb` and `layouts/settings.html.erb`, the greeting is the dashboard's `h1` with its sentence as description, and each settings section renders its own `Page` with the `centred` option (header, alerts and content in one 896 px column); section headings moved one level up, and the security page's password section is titled « Mot de passe ». This takes the greeting of Story 14.2 and the settings headers of Story 14.4 ahead of them.
- Left to Stories 14.2 to 14.4: `amount-hero`, `type-display`, `type-title` and `TintedIcon` sizes; page contents; transaction rows still 36 px.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind, edge | Duplicate `accounts-column-<type>` ids while the menu sheet is open | low | `AccountGroup` builds the id from the type; the hidden wide column stays mounted beside the sheet's copy | patch |
| 2 | blind, edge | Sheet stays open when a link targets the current path | low | it closes only on a pathname change | patch |
| 3 | blind | Bottom navigation covers toasts; `pb-20` ignores the safe area; `BulkBar` at `bottom-20` | medium | `Toaster` has no mobile offset; nav height adds `env(safe-area-inset-bottom)` | patch |
| 4 | blind | Menu sheet ignores `prefers-reduced-motion` | low | `TransactionSheet` sets `motion-reduce:*`, the shell's `SheetContent` does not; EXPERIENCE requires it | patch |
| 5 | blind, edge | Type totals leave out accounts silently | medium | the removed sidebar header carried `accounts.excluded` as a title; the column says nothing | patch |
| 6 | blind | Reporting predicate and type order duplicated with `lib/balance-sheet.ts` | medium | two copies of active/included/currency and two type orders; the column and the dashboard would diverge on the next change | patch |
| 7 | blind | Rail says Accueil and Récurrent while `h1`s say Tableau de bord and Récurrences | low | DESIGN.md names the rail entries; Story 14.2 replaces the dashboard `h1` with the greeting | reject |
| 8 | blind | Tab trigger 27 px, `xs` button 24 px under the 28 px floor | low | Story 14.4 owns the floor; 1 px on tabs is negligible | reject |
| 9 | blind | Dark active tab darker than its track, no border | medium | `bg-card` #1F2023 on `bg-inset` #252629 reads as recessed; the dark border was removed | patch |
| 10 | blind | `AlertDialogContent` `size` no longer changes width | low | both sizes are 300 px; harmless | reject |
| 11 | blind | `Page` accepts a lucide icon and ignores it | medium | two callers still pass `ReceiptIcon` and `WalletIcon` for nothing; the type invites more | patch |
| 12 | blind | Breadcrumbs stop at the section on `/settings/banks/<id>` | low | the connection page has its own way back; fix adds a branch | reject |
| 13 | blind | Group totals checks moved from the screen to the API | medium | `accounts.spec.ts` lost on-screen class totals that the accounts page still shows | patch |
| 14 | blind, verification | Phone: settings navigation in the sheet and the top bar avatar untested | medium | no 390 px test opens either | patch |
| 15 | blind | Storage-unavailable row has no test | low | `useStoredFlag` is unchanged and already catches | reject |
| 16 | blind | Spec `in-review` while sprint says `in-progress` | false | the workflow moves sprint status at the end | reject |
| 17 | edge | Sheet stays open when the window widens past 1024 px | low | its trigger disappears with `lg:hidden`; closing on `isWide` is one effect | patch |
| 18 | edge | Actifs or Passifs tab blank when the class is empty | low | common for a household without loans; one line of text | patch |
| 19 | edge | Unknown account type vanishes | false | `type` is the closed `AccountType` union from `@archant/data` | reject |
| 20 | edge | Avatar initial splits an emoji | low | unlikely in a name or e-mail; not worth a branch | reject |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all pass.
