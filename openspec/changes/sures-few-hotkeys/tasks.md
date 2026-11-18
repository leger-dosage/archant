## 1. Implementation

- [x] 1.1 Remove the modifier-Enter handler and its tooltip from transaction and transfer forms. Keep ordinary form submission and remove the unused translations.
- [x] 1.2 Add the settings return link and Escape handling. Preserve the return destination through settings navigation and let an open dialog consume Escape first.

## 2. Verification

- [x] 2.1 Update `keyboard.spec.ts` to check explicit save and focus restoration. Cover Escape with and without a settings dialog and a direct settings visit. Run the existing account-picker and report keyboard coverage.
- [ ] 2.2 Run the repository verification commands.
