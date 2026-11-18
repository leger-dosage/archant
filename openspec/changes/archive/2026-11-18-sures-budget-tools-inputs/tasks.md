## 1. Implementation

- [x] 1.1 Let `update_budget` create a budget record with any supported partial update. Apply repeated entries in order within their category group and preserve atomic updates and the current refusal order.
- [x] 1.2 Build the `get_budget` history from stored records and compute only the in-bounds target without writing.

## 2. Verification

- [x] 2.1 Vitest covers category-only, income-only and spending-only writes, a repeated category, refusal order and rollback. Cover `get_budget` with missing and partially saved months and an out-of-bounds target with earlier in-bounds months.
- [x] 2.2 Run the repository verification commands.
