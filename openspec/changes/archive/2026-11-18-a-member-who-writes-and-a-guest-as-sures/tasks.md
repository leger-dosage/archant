## 1. Implementation

- [x] 1.1 Migrate existing viewers and invitations to guests. Update role validation, defaults and invitation acceptance.
- [x] 1.2 Guard household administration routes before allowing member writes. Verify demotions cancel pending invitations and revoke assistant access.
- [x] 1.3 Apply the permissions to the interface and add all three roles to invitation and member management.

## 2. Verification

- [x] 2.1 AD-21 changes with this story; `docs/sure-parity.md` « Roles » reads Parity for the roles.
- [x] 2.2 Verify the migration, route permissions for all three roles, the last-administrator guard and revocation after either administrator demotion. Use Playwright to check ordinary member writes and the guest interface.
- [x] 2.3 Run the repository verification commands.
