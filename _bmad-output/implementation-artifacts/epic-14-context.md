# Epic 14 Context: Sure's proportions under Linear's colours

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The owner found the interface too small everywhere: 13px body text, a 13px page title inside a title bar, 32px controls, 36px rows, 384px dialogs, a 448px sheet, and content capped at 1200px without being centred. Epic 12 had put Sure's content inside Linear's skin, sizes included. Epic 14 does the reverse. Pages, layouts and proportions come from Sure, which keeps Tailwind's defaults: 14px body, 24–30px titles, 36px controls, 550px dialogs and drawer, and full-width content with 40px padding. Linear becomes a light layer that supplies the colours (Linear Light and Classic Dark), Inter with its weights, 1px borders instead of shadows, and the indigo primary. The shell becomes Sure's "frame A": a rail of destinations, a foldable accounts column, a top bar with breadcrumbs, and a bottom navigation below 1024px. No route changes.

## Stories

- Story 14.1: The shell and the scale
- Story 14.2: The dashboard and the accounts pages
- Story 14.3: The transactions list and the drawer
- Story 14.4: The remaining screens

## Requirements & Constraints

- Type scale follows Tailwind's defaults. No `--text-*` token is overridden, and the body is 14px. Only captions and uppercase headers go down to 12px, and only the rail's labels to 11px. No control is smaller than 28px.
- Control sizes: buttons are 28 (sm), 36 (default) and 48 (lg), plus a 36px square icon button. Inputs and select triggers are 36px. Dialogs are 300px for confirmations, 550px by default and 700px for import and rules. Menus are at least 200px wide. Tabs sit on a grey `inset` track with 4px padding, and the active tab is on `container`.
- Two deliberate departures from Sure. Transaction rows are 56px, not 68px. Cards and trays keep 1px borders, not Sure's ring shadow. Left out: per-account sparklines, drag-resizing the accounts column, and the AI chat panel.
- Accessibility floor: WCAG 2.2 AA contrast in both modes, full keyboard reach, visible focus with `ring`, `Esc` closes the topmost layer and returns focus to what opened it, targets at least 24px, and `prefers-reduced-motion` removes chart and sheet animations. Colour never carries meaning alone.
- Only one API change. The `GET /api/transactions` list response adds the income sum and the expense sum of the filtered rows, beside the existing count and signed sum. Both are computed like the signed sum, in the reporting currency, and they leave out the same rows, which are counted in `skippedCount`.
- Every acceptance criterion has an automated test. Playwright covers what the interface shows, Vitest covers the rest. End-to-end tests that navigated through the old sidebar must go through the rail or the accounts column.

## Technical Decisions

- Theme lives in `packages/app/src/styles.css`. The radii go back to Tailwind's defaults (sm 4, md 6, lg 8, xl 12, full). The `container` and `inset` tokens replace `panel` and `section` in both modes. `styles.spec.ts` checks the text contrast pairs on the new `inset` surface.
- Surface layering follows Sure, in Linear's values. `background` (#F8F8F8 / #1A1B1E) is under the page, the rail and the accounts column. `container` (#FFFFFF / #1F2023) is for cards, dialogs, the drawer and the inner row blocks. `inset` (#F2F2F3 / #252629) is for trays and column headers. `hover`, `active` and `selection` complete the set. Exact values are in `DESIGN.md`.
- Inter with `cv01` and `ss03`, weights 400, 510 and 590. Geist Mono is for code. Amounts always use `tabular-nums`: the `amount` style is 14px, `amount-summary` is 20px, and `amount-hero` is 30px for net worth and an account's balance.
- shadcn components in `packages/app/src/components/ui/` are resized to these figures and not restyled beyond them. `Page.tsx` becomes Sure's page header: a 24px title, an optional muted sentence and the actions on the right, over full-width content with 40px side padding. The inset panel and its title bar go away.
- Money is still rendered only through `<Money>` and `formatMoney`. Totals use the reporting currency through the existing helper and skip, and report, accounts in any other currency.
- Planning spines win over mockups on conflict: `DESIGN.md` and `EXPERIENCE.md` in `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/`. The visual reference is `mockups/sure-proportions-frame-and-font.html?frame=a&font=inter`. `key-linear-classic-dark.html` is still the reference for dashboard content and the dark palette, but its shell and sizes are superseded.

## UX & Interaction Patterns

- **Shell, from 1024px up.**
  - The rail is 84px wide on `background` with a right border. It holds the arch logo at 28px, then Accueil, Opérations, Comptes, Récurrent, Règles and Réglages. Each entry is a 32px icon tile with an 11px label under it, and the current entry carries `aria-current`. At the bottom, the avatar opens the user menu: theme, Réglages, Se déconnecter.
  - The accounts column is 320px wide. It holds « Ajouter un compte », then tabs Tout, Actifs and Passifs. Active accounts are grouped by type under an uppercase header with the group's total. Each row has an 8px radius, a `md` tinted type icon, the name over the subtype, and the balance.
  - The sticky top bar is 69px high with a `line` border under it. It holds the fold button, then breadcrumbs such as « Comptes / Compte joint »: parents are muted links, and the current page uses the foreground colour.
  - The fold state of the accounts column is remembered per device.
- **Settings.** A 256px navigation column with icons replaces the accounts column. The content is centred and at most 896px wide.
- **Below 1024px.** A top bar holds the menu, the logo and the user menu. A fixed bottom navigation holds the rail's entries. The menu opens the accounts column as a full-screen overlay that `Esc` closes. Content padding drops to 12px.
- **Outside the shell.** The sign-in, setup and root error pages stay outside the shell. They show a 32px arch logo on `background`, at the new scale.
- **Recurring patterns.**
  - Card: `container`, 1px border, 12px radius, 16px padding, optional 16px title.
  - Inset group: a grey `inset` tray with 4px padding. An uppercase 12px header holds the name or day on the left and the total on the right, above a white bordered block of rows separated by `line`.
  - Summary strip: equal cells, each a muted label over a 20px figure.
  - Tinted icon: 20, 28 or 36px, with the colour at 10% (light) or 17% (dark).
  - Category pill: 24px high.
  - Badge: 22px high, 6px radius.
  - Empty state: a card with a 36px tinted icon, a title, one sentence and one primary button.
- **Transactions.**
  - The list opens with a 36px search field and the filter chips, then an uppercase column header on `inset`: Opération, Catégorie, Compte, Montant.
  - Each day is an inset group whose header holds the day, the count and the day's subtotal.
  - A row holds its checkbox, a 36px tinted icon or the merchant's letter, the label and caption with badges, the category pill, the account with a 20px type icon, and the amount.
  - Hover uses `hover`. Selection uses `selection` with an accent bar on the left edge.
  - The account column is dropped below 1024px. Below 768px, rows take two lines: label and amount, then date and category.
  - The drawer is 550px on the right, inset 12px from the viewport with 12px corners, and full screen below 768px. It keeps `⌘Enter` to save and `Esc` to close.
- **Dashboard.**
  - The page header shows « Bonjour {prénom} » at 30px. Cards sit in one column, and in two from 1536px.
  - Net worth card: the value at 30px, the change with a trend arrow, the Actifs and Passifs totals, and the period control. Below them, a 208px area chart with its text summary and « Voir le tableau ».
  - Month's flow card: a summary strip of income, expenses and « Épargne du mois », then the donut and the categories.
  - Balance sheet card: a 6px weight bar by type, then an inset group of the accounts.
- Colour rules are unchanged. Income is green with a `+`. Expenses use the text colour. Trend colours apply only to the net-worth arrow. Indigo is only for the primary action, focus, selection and links.

## Cross-Story Dependencies

- Story 14.1 comes first: theme tokens, shadcn sizes, the shell, `Page.tsx` and the inset surface. Stories 14.2, 14.3 and 14.4 build on it and can follow in any order.
- Story 14.3 changes the shared transaction list, which is used on the transactions page and on an account's page. Story 14.2's account page tabs host that list.
- Story 14.3 also touches the API (`packages/api/src/services/transactions.ts` and the list response schema). The app consumes the new sums through the typed client.
