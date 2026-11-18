## 1. Implementation

- [x] 1.1 Align `create_goal` in `mcp/goals.ts` and its input schema with Sure's one-off goal contract. Restrict assistant lookup to active current and savings accounts while keeping investment accounts available in the interface. Return the remaining earmark amount separately from the full-claim flag.

## 2. Verification

- [x] 2.1 Vitest covers a call with Sure's parameters, a call with `kind` refused as unknown, an investment account's name and `free_to_earmark` of an account claimed in full; Playwright is unchanged, since no screen changes.
- [x] 2.2 Run the repository verification commands.
