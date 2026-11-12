# Moment

Moment is a proposed local system for contextual incidents, governed reactions, and coordination between agents. It preserves the relationships, evidence, and intent needed to continue useful work across sessions, projects, and levels of detail.

This repository contains a local daemon, typed client, CLI, and SQLite storage backend. It supports operator and grant-bound identities, contexts, schemas, incidents, graph operations, and governed policy changes. Reaction transitions, scheduling, execution providers, and the complete native agent workflow are under implementation.

Start with the [documentation map](docs/README.md), [semantic model](docs/reference/model.md), and [TypeScript API](contracts/index.ts). The [implementation sequence](docs/development/implementation.md) identifies bounded deliverables and their acceptance cases.

## Contract checks

Use the pinned Node.js and pnpm versions through mise:

```sh
mise install
mise run setup
mise run check
```

These commands check declarations, positive and negative type examples, documentation links, API documentation coverage, and storage execution tests. The tests include new-process reopen, competing writers, and interruption rollback. See [verification](docs/development/verification.md) for the tested environment and limitations.

## Local service

From this checkout, run the service in one terminal:

```sh
pnpm moment serve
```

In another terminal, inspect its actual methods:

```sh
pnpm moment describe
```

`pnpm moment call <method> '<params-json>'` calls the same API through the authenticated Unix socket. The service creates an operator credential and database in the central store, with the credential and socket restricted to the current user. Stop the foreground service with Ctrl-C; committed data survives restart. The initial `owner-local` policy admits the operator. Additional principals need both a policy permit and an issued grant; see [authority](docs/reference/authority.md).

After issuing a grant through the API, the local owner can create a separate transport credential with `pnpm moment credential <principal-id> '<grant-bindings-json>'`. The bindings map context UUIDs to full grant references. The command prints only the private credential file's path. Select it through `MOMENT_CREDENTIAL_FILE` for CLI calls or the typed client's `credentialFile` option. Creating a credential does not issue a grant or override policy. See [protocol](docs/reference/protocol.md) for request and recovery behavior.

## Personal store

The user-facing entry point is `~/.moment/`. By default it is a symlink to `~/.local/share/moment/`; `MOMENT_HOME` can select another absolute location. Active intents, checkpoints, project associations, and future runtime data belong there. Touched projects need no Moment metadata. The [storage contract](docs/reference/storage.md) defines discovery, identity, and conflict handling.

The tracked [implementation goal](docs/development/implementation-goal.md) is reusable. A personal working copy belongs in the central store and becomes active only when explicitly invoked.

## Development and distribution

Read [AGENTS.md](AGENTS.md) before changing contracts. No distribution license has been selected. The package is private and marked `UNLICENSED`; it is not published to npm.
