# self-hosting

## Purpose

Container operation, local storage, upgrades and backups.

## Requirements

### Requirement: Container operation

Archant SHALL serve the built interface and application programming interface from one reference container, using a persistent database volume.

#### Scenario: Restarting the container

- **WHEN** the self-hoster restarts it with the same volume
- **THEN** the saved household remains available.

### Requirement: Back up before migrating

Archant SHALL back up a local database before applying a pending migration and refuse the migration if it cannot make the copy.

#### Scenario: Upgrading a database with a pending migration

- **WHEN** the service starts against the local database
- **THEN** it copies the database before changing its schema.

### Requirement: Versioned releases

Archant SHALL publish versioned container images and expose the running version to signed-in members.

#### Scenario: Checking the running version

- **WHEN** a signed-in member opens settings
- **THEN** Archant displays the version of the running build.
