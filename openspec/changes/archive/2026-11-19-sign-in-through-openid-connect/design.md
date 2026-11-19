## Approach

Use Better Auth's OpenID Connect integration. Keep identity linking tied to the existing member and new accounts tied to pending invitations.

Better Auth owns the code exchange, state, nonce verification and session. Archant validates
discovery against the configured issuer and binds identities to issuer and subject. The security
settings use an active session and the current password to start an explicit same-email link. An
invitee starts from the invitation link. The verified email must match the invitation, which is
consumed in the account-and-identity transaction. Unlike Sure's household creation path, the
invitation is mandatory and does not override `link_only` or the domain allowlist.

Use the contract introduced by `a-member-who-writes-and-a-guest-as-sures` (Story 36.2).

## Source

Story 36.8 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.
