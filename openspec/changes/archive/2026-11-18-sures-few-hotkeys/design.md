## Approach

Use the shell's settings navigation for the previous-page link and Escape. Keep the last in-app page while users switch between settings sections. An open dialog consumes Escape first.

`AccountCreationChoices.tsx` and `CreateAccountDialog.tsx` already implement the picker controls. `account-steps.spec.ts` covers them. Report period arrows are already delivered. The remaining save shortcuts are in both `TransactionForm.tsx` and `TransferForm.tsx`.

## Source

Story 34.9 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.
