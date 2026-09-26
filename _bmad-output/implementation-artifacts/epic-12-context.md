# Epic 12 Context: A warmer interface in Linear's skin

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The owner's manual QA of 2026-09-25 found the interface austere next to Sure: little colour, few icons, plain charts, no favicon. This epic keeps Sure's content (a greeting, colour through tinted icons and category pills, an outflows donut, a balance sheet by account type) and dresses it in Linear's skin: Linear Light in light mode, Linear Classic Dark in dark mode, Inter, one inset panel, borders instead of shadows, plus the arch logo and its favicon. The visual spec is `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md`, behaviour is in `EXPERIENCE.md` beside it, and `mockups/key-linear-classic-dark.html` is the visual reference; the two spines win over the mock. The epic adds no requirement and revises UX-DR1. Every figure the new screens show is already served by the API; the one addition is the user's first name for the dashboard greeting.

## Stories

- Story 12.1: The brand foundation
- Story 12.2: The dashboard
- Story 12.3: Transactions and accounts
- Story 12.4: The remaining screens

## Requirements & Constraints

- WCAG 2.2 AA on every text pair in both modes (NFR13), checked by a Vitest test over the theme's token pairs. Keyboard use, visible focus with the ring colour, focus return, 24 px minimum targets and 36 px rows stay as Epic 11 left them.
- Meaning never depends on colour alone: pending, excluded, recurring, internal transfer and possible duplicate each carry a badge or an icon with text.
- Every visible string goes through `locales/fr.json`; French, « vous », infinitive-verb buttons, no exclamation marks. URLs stay English.
- A new dependency is justified in the pull request; `@fontsource-variable/inter` replaces `@fontsource-variable/geist`, and `docs/tech-stack.md` follows.
- Every acceptance criterion has an automated test: Playwright for what the interface shows, Vitest for the rest. No test reaches the network.
- Existing categories keep their colour; only the palette offered for new or edited categories changes.
- Charts keep their text summary, « Voir les données » / « Voir le tableau » table alternative, keyboard cursor, and no animation under `prefers-reduced-motion`.

## Technical Decisions

- shadcn/ui with the neutral base stays for every generic component, copied in `packages/app/src/components/ui/`; Epic 12 only adds a brand layer and Archant components in `packages/app/src/components/`. Do not restyle shadcn beyond `DESIGN.md`.
- Tokens live in `packages/app/src/styles.css` (Tailwind CSS 4). Light values are Linear Light's; dark values are derived in LCH from Classic Dark's base `#1F2023` and indigo `#5E6AD2`. Key surfaces: background `#F8F8F8` / `#1A1B1E`, panel `#FFFFFF` / `#1F2023`, section `#FFFFFF` / `#252629`, hover `#F4F4F4` / `#2B2D30`, active `#EEEDEF` / `#27282B`, selection `#F1F1FF` / `#292C3F`. Text `#282A30` / `#EEEFF1`, secondary `#3C4149` / `#CBCCCE`, muted `#6C6B73` / `#929496`. Unlisted shadcn tokens inherit the neutral base.
- Indigo: primary `#5E6AD2` with white text (4.70:1) in both modes. Light accent `#7170FF` marks only focus, selection and the chart line (3.84:1 on white), links use `#5A65CC` (the indigo darkened to 4.5:1 on a selected row); dark accent, links and ring are `#818AF6`.
- Money: income `#1D7F34` light / `#2BA947` dark with a `+`; expenses in the text colour with a true minus, never red; balances and totals never coloured. Trend `#27A644` / `#EB5757` colours only the net worth arrow. Every amount goes through `<Money>` and `formatMoney`, with tabular figures.
- Account type colours are fixed: depository `#9D6FE8`, investment `#4EA7FC`, property `#00B8CC`, vehicle `#E2609C`, credit card `#EB5757`, loan `#C95FD8`; transfer `#5E6AD2`; uncategorised uses the muted text colour.
- One helper computes a colour's pill text (adjusted in OKLCH to 4.6:1 light, 6.5:1 dark) and icon (3:1), both measured on the hover row, for any colour the household picks. Tints are `color-mix(in oklab, <colour> 10% light / 17% dark, transparent)`.
- Type: Inter Variable with `font-feature-settings: "cv01", "ss03"` on the root, weights 400, 510, 590; body 13 px, caption 12 px, title 14 px/590, display 20 px/590, amount-hero 28 px/590. Code stays in Geist Mono Variable 12 px.
- Radii 5 (badges, checkboxes), 6 (buttons, inputs, tinted icons, sidebar items), 8 (sections), 10 (panel, dialogs, sheets), full for pills. No shadow on page, panel, sections or rows; only popovers, menus, sheets and dialogs keep shadcn's shadow.
- Icons are `lucide-react`, 16 px in navigation, 12 to 14 px in controls.
- The dashboard's first name is the Better Auth user's `name`, entered at `/setup` (optional) and in « Réglages › Sécurité » through Better Auth's user update; an existing administrator keeps the e-mail local part until changing it.

## UX & Interaction Patterns

- App shell for every signed-in page: a 240 px sidebar directly on the base background, no border, with the 20 px arch logo beside « Archant », 28 px entries each with a lucide icon, the active entry on the active background, then « Comptes » grouped under Actifs and Passifs, each account with a small tinted type icon and its balance. The page sits in one inset panel (8 px margin, 10 px radius, 1 px border) under a 44 px title bar holding the page icon and title and the page actions. Content padding 24 px 28 px, max 1200 px, 16 px gaps. Below 1024 px the sidebar collapses to 56 px of icons; below 768 px it becomes a sheet and the panel loses margin and border.
- Tinted icon: sizes 20, 22 and 32 px, 6 px radius. Account types use `landmark`, `line-chart`, `home`, `car`, `credit-card`, `hand-coins`; transfers `arrow-left-right`; uncategorised `circle-dashed`; a merchant without a category shows its first letter.
- Category pill: 20 px high, fully rounded, 12 px icon plus name in caption type; uncategorised is a muted « Sans catégorie » pill. Badge: 20 px, 5 px radius, badge background, secondary text, with an icon; « Doublon possible » uses the orange warning tint.
- New-category palette: orange `#FC7840`, yellow `#F0BF00`, blue `#4EA7FC`, teal `#00B8CC`, green `#27A644`, indigo `#5E6AD2`, red `#EB5757`, violet `#9D6FE8`, pink `#E2609C`, magenta `#C95FD8`.
- Logo and favicon come from `mockups/logo.svg`: one colour, `#282A30` on light and `#EEEFF1` on dark. The favicon is that SVG following `prefers-color-scheme`, with a 32 px PNG fallback. Sign-in, setup and the root error page sit outside the shell and show the logo on the base background.
- Dashboard: « Bonjour » plus the first name when set, one muted sentence, actions in the title bar; net worth full width (hero value, trend arrow, Actifs and Passifs totals, area chart with a 1.5 px accent line, faint gradient, gridlines, « 275 k€ » labels); then the month's flow (income, expenses, « Épargne du mois », thin donut) beside the balance sheet (4 px weight bar by account type, dot legend, percentages).
- Transaction rows are 36 px, with day header rows on the section colour (day, count, subtotal), hover on the hover colour, selection on the selection colour with an accent bar on the left edge.
- Empty state inside a section: a 32 px tinted icon, a title, one sentence, one primary button (« Ajouter un compte » when there is no account).

## Cross-Story Dependencies

- Story 12.1 lands first: tokens, fonts, app shell, tinted icon, category pill, contrast helper, palette, logo and favicon. Stories 12.2, 12.3 and 12.4 build on it in any order.
- Story 12.2 reads Epic 6's report endpoints and adds the first-name field to `/setup` and « Réglages › Sécurité ».
- Story 12.4 restyles what Epic 11 added: the root error page, the account « … » menu, the creation dialogs and the Enable Banking panel.
- Epic 11 is shipped: the interface lives in `packages/app` (`@archant/app`, `pnpm app`) and the command palette and single-key shortcuts are gone.
