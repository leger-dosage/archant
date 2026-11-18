## 1. Implementation

- [x] 1.1 Persist the progress basis for new and existing goals. Keep existing completion figures and update the basis field in the goal form and `goals.ndjson`.
- [x] 1.2 Calculate contributions independently of market movement, retain the shared allocation rules and show the market value on a contributions goal. Use the same calculation for balance-based pace when that fallback is available.

## 2. Verification

- [x] 2.1 Vitest covers gains, losses, the floor at zero, mixed accounts, the market-value default, a saved choice that survives changes to links, and changes to a completed goal's basis. Playwright changes an investment-backed goal's basis and compares its progress with the displayed market value.
- [x] 2.2 Run the repository verification commands.
