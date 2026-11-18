## Context

`packages/api/src/services/reports-page.ts` builds the page and transaction export. Report preferences and section identifiers are shared with the interface through `@archant/data`. Sure's controller applies tags to transaction-based figures and keeps balance and portfolio figures global.

## Decisions

- Validate tag IDs once and pass the selection through period controls, links and report endpoints. Filter by tag membership without a multiplying join. Reuse report eligibility and currency rules for ordinary figures, CSV and print.
- Use integer minor units and the reporting currency under AD-6. Rank only amounts the report can compare. Tie-break equal amounts deterministically. Use the same result in both layouts.
- Append the new section for old layouts and default the stored limit to ten. Keep the administrator's existing layout ownership until it changes under a separate proposal. The print section follows the category expense breakdown and ignores interactive visibility.
