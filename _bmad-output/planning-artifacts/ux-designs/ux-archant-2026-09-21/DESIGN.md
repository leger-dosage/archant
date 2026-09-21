---
name: Archant
description: Self-hosted personal finance for one household. shadcn/ui on Vite, React and Tailwind CSS 4, base colour neutral; this file specifies the brand layer and the money semantics on top of it.
status: final
updated: '2026-09-21'
sources:
  - ../../feature-inventory.md
  - ../../epics.md
  - ../../architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md
colors:
  # Unlisted shadcn tokens (card, popover, muted, input, secondary, destructive-foreground...) inherit the neutral base.
  background: '#FFFFFF'
  foreground: '#171717'
  muted-foreground: '#737373'
  border: '#E7E7E7'
  sidebar: '#F7F7F7'
  primary: '#171717'
  primary-foreground: '#FFFFFF'
  accent-brand: '#444CE7'
  ring: '#444CE7'
  destructive: '#C91313'
  warning: '#B54708'
  money-income: '#067647'
  money-expense: '#171717'
  money-muted: '#737373'
  background-dark: '#0B0B0B'
  foreground-dark: '#F7F7F7'
  muted-foreground-dark: '#9E9E9E'
  border-dark: '#242424'
  sidebar-dark: '#171717'
  primary-dark: '#F7F7F7'
  primary-foreground-dark: '#171717'
  accent-brand-dark: '#8098F9'
  ring-dark: '#8098F9'
  destructive-dark: '#ED4E4E'
  warning-dark: '#FDB022'
  money-income-dark: '#32D583'
  money-expense-dark: '#F7F7F7'
  money-muted-dark: '#9E9E9E'
  chart-1: '#444CE7'
  chart-2: '#06AED4'
  chart-3: '#12B76A'
  chart-4: '#F79009'
  chart-5: '#EE46BC'
  chart-6: '#7A5AF8'
typography:
  display:
    fontFamily: 'Geist Variable'
    fontSize: 30px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  title:
    fontFamily: 'Geist Variable'
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
  body:
    fontFamily: 'Geist Variable'
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label:
    fontFamily: 'Geist Variable'
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1.4'
  caption:
    fontFamily: 'Geist Variable'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.4'
  amount:
    fontFamily: 'Geist Variable'
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.5'
  amount-hero:
    fontFamily: 'Geist Variable'
    fontSize: 30px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  code:
    fontFamily: 'Geist Mono Variable'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  full: 9999px
spacing:
  row: 36px
  row-comfortable: 44px
  sidebar: 240px
  sidebar-collapsed: 56px
  content-max: 1200px
components:
  sidebar-item-active:
    background: '{colors.background}'
    foreground: '{colors.foreground}'
    indicator: '{colors.accent-brand}'
    radius: '{rounded.md}'
  money-income:
    foreground: '{colors.money-income}'
    typography: '{typography.amount}'
  money-expense:
    foreground: '{colors.money-expense}'
    typography: '{typography.amount}'
  money-hero:
    foreground: '{colors.foreground}'
    typography: '{typography.amount-hero}'
  transaction-row:
    height: '{spacing.row}'
    border: '{colors.border}'
  badge-pending:
    foreground: '{colors.muted-foreground}'
    border: '{colors.border}'
    radius: '{rounded.full}'
  banner-warning:
    foreground: '{colors.warning}'
    radius: '{rounded.md}'
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.md}'
---

## Brand & Style

Archant is a quiet tool that holds a household's bank history. It should feel like a well-kept ledger: calm, dense, exact, and fast under the keyboard. The posture comes from two places. From Sure it takes the monochrome surfaces, the Geist type family and the way amounts carry the meaning, not the chrome. From Linear it takes the flat, bordered surfaces, the compact rows and the command palette as the centre of the product.

The brand layer is deliberately small. shadcn/ui with the neutral base colour covers every generic component, and this file only overrides what makes Archant recognisable: one indigo accent, the money colours, tighter corners and the type ramp. A component not named here is shadcn's, unchanged.

## Colors

Surfaces are neutral greys taken from Sure's tokens, so numbers stand out against nothing.

- **Foreground (`#171717` light, `#F7F7F7` dark)** is the text colour and the primary button colour. Archant has no coloured primary button: actions are black on white, as in Sure.
- **Accent indigo (`#444CE7` light, `#8098F9` dark)**, Sure's `indigo.600`, is the only brand colour. It marks the focus ring, the active navigation indicator, links, and the first series of a chart. It never fills a large surface and never colours an amount.
- **Money income (`#067647` light, `#32D583` dark)** colours positive amounts in lists, with a leading plus sign. Sure's `green.700` failed AA on white at 4.30:1; this green reaches 5.69:1 on white and 5.31:1 on the sidebar grey.
- **Money expense** is the foreground colour. Spending is the normal case and is not shown in red: red would turn every list into an alarm.
- **Money muted (`#737373` light, `#9E9E9E` dark)** is for pending and excluded amounts, always paired with a badge or an icon, never alone.
- **Destructive (`#C91313` light, `#ED4E4E` dark)** is only for delete actions and errors. **Warning (`#B54708` light, `#FDB022` dark)** is only for consent expiry, stale sync and possible duplicates.
- **Chart series** use `{colors.chart-1}` to `{colors.chart-6}` in order. Category charts use each category's own colour, set in the category settings and drawn from Sure's default category palette.

Every pair above meets WCAG 2.2 AA for text on its background in both modes.

## Typography

Geist and Geist Mono, as in Sure, installed through `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`. The ramp is small because the interface is dense.

- `{typography.body}` at 14px for everything by default, `{typography.label}` for form labels and table headers, `{typography.caption}` for dates and secondary lines.
- `{typography.title}` for page and sheet titles. `{typography.display}` appears once per page at most, for the page heading.
- `{typography.amount}` and `{typography.amount-hero}` always set `font-variant-numeric: tabular-nums`, so columns of amounts align on the decimal comma. The net worth and an account's balance use `amount-hero`.
- `{typography.code}` for IBAN masks, file names and technical references.

## Layout & Spacing

Tailwind's 4px scale, inherited. A left sidebar of `{spacing.sidebar}` holds navigation and the account list; content sits beside it, up to `{spacing.content-max}` wide, left-aligned. Tables use `{spacing.row}` rows, Linear's density; a comfortable density of `{spacing.row-comfortable}` is a user setting. Amount columns are right-aligned; the label column takes the remaining width and truncates with an ellipsis and a tooltip.

Below 1024px the sidebar collapses to `{spacing.sidebar-collapsed}` icons; below 768px it becomes a sheet opened from the top bar.

## Elevation & Depth

Flat. Hierarchy comes from borders in `{colors.border}` and the sidebar grey, not from shadows. Only floating layers carry shadcn's shadow: popovers, menus, the command palette, sheets and dialogs.

## Shapes

`{rounded.sm}` for inputs and checkboxes, `{rounded.md}` for buttons, cards and sidebar items, `{rounded.lg}` for dialogs, sheets and the command palette. `{rounded.full}` only for badges and avatars. Tighter than shadcn's defaults: Archant is a tool.

## Components

Used from shadcn/ui unchanged: `Button` (non-primary variants), `Input`, `Select`, `Combobox` built on `Command` and `Popover`, `Dialog`, `Sheet`, `DropdownMenu`, `Tabs`, `Table`, `Checkbox`, `Badge`, `Tooltip`, `Skeleton`, `Sonner` toasts, `Chart`, `Calendar`, `Form`.

Archant components and overrides:

- **Money.** One component renders every amount through `formatMoney`: `1 234,56 €`. Positive transaction amounts use `{components.money-income}` with a `+`; negative use `{components.money-expense}` with a true minus sign. Balances and totals are never coloured. Pending and excluded amounts use `{colors.money-muted}`.
- **Sidebar item.** Icon from `lucide-react` at 16px, label, optional count or balance right-aligned. Active: `{components.sidebar-item-active}`, a 2px accent bar on the left edge.
- **Account group.** In the sidebar and on the accounts page: a group header (Actifs, Passifs) with its total, then one row per account with name, subtype caption and balance.
- **Transaction row.** `{components.transaction-row}`: checkbox, date, label with merchant caption, category chip (colour dot and name), account, amount. Hover and keyboard focus use shadcn's `muted` background.
- **Category chip.** A 8px dot in the category colour and the name in `{typography.label}`. Uncategorised shows a dashed outline dot and "Sans catégorie".
- **Pending badge.** `{components.badge-pending}`, outline style, text "En attente".
- **Banner.** Full-width strip above the page content, `{components.banner-warning}`, with an icon, one sentence and one action. Used for consent expiry and stale sync only.
- **Balance chart.** shadcn `Chart` with a single line in `{colors.chart-1}`, no fill gradient, no grid except a faint baseline, tooltip with date and `Money`.
- **Stat block.** Label in `{typography.label}` muted, value in `{components.money-hero}`, change below in `{typography.caption}`, coloured only by sign of the change for net worth.

## Do's and Don'ts

| Do | Don't |
| --- | --- |
| Let amounts carry colour: green for income, nothing for expenses | Show expenses or negative balances in red |
| Use `{colors.accent-brand}` for focus, active state, links and the first chart series | Fill buttons, cards or backgrounds with the accent |
| Keep tabular figures on every amount | Mix proportional and tabular figures in one column |
| Pair every muted amount with a badge or an icon | Rely on colour alone to say pending, excluded or duplicate |
| Use borders for structure | Add shadows to cards or rows |
| Inherit shadcn for every generic component | Restyle shadcn components beyond this file |
