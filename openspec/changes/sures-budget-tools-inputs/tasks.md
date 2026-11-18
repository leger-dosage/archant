## 1. Implementation

- [ ] 1.1 Implement the assistant-access delta (start a budget with a partial update, apply repeated categories in order, reject invalid updates, read prior months without writing).

## 2. Verification

- [ ] 2.1 Vitest covers a month set up by one category, a repeated category, each refusal key and a `get_budget` with unset and out-of-bounds months; Playwright is unchanged, since no screen changes.
- [ ] 2.2 Run the repository verification commands.
