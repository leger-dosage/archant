# assistant-access

## Purpose

Authorise connections to household tools over the Model Context Protocol.

## Requirements

### Requirement: Authorising an assistant

Archant SHALL let administrators authorise an assistant connection, inspect its access and revoke it.

#### Scenario: An assistant's access is revoked

- **WHEN** the formerly authorised assistant attempts to call a tool
- **THEN** the server refuses the connection's access.

### Requirement: Read and write tools

Archant SHALL allow an authorised assistant to read household finances. Write tools SHALL require write access granted by the administrator.

#### Scenario: Using a read-only connection

- **WHEN** a connected assistant attempts to record a transaction
- **THEN** the server refuses the write and the ledger remains unchanged.
