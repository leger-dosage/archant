## 1. Implementation

- [ ] 1.1 Implement the household-access delta (migrate viewer roles, apply member permissions, refuse guest writes, invite by role).

## 2. Verification

- [ ] 2.1 AD-21 changes with this story; `docs/sure-parity.md` « Roles » reads Parity for the roles.
- [ ] 2.2 Vitest walks every mutating route for each role, after the migration; Playwright signs in as a member who writes and a guest who sees no write control.
- [ ] 2.3 Run the repository verification commands.
