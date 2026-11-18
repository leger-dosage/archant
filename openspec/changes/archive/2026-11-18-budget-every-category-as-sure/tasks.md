## 1. Implementation

- [x] 1.1 Copy stored amounts and rollover choices in `copiedRows`. Preserve envelopes for all categories, which Story 32.1 already shipped.
- [x] 1.2 Show the stored subcategory amount, including a saved zero. Persist the parent's own typed amount and keep the next-child-save reserve calculation.
- [x] 1.3 Show the source's stored amount in `BudgetMoveDialog.tsx`, preserve the server's movable reserve limit and show each move refusal as a notification.

## 2. Verification

- [x] 2.1 Vitest covers a category previously used for income, a copy after a category is re-parented, a parent saved below its subcategories and each move refusal. Playwright verifies the saved subcategory amount and a refused move.
- [x] 2.2 Run the repository verification commands.
