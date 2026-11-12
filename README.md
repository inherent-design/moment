# Moment

Moment is a proposed local system for contextual incidents, governed reactions, and coordination between agents. It preserves the relationships, evidence, and intent needed to continue useful work across sessions, projects, and levels of detail.

This repository contains API declarations, implementation contracts, and a tested SQLite storage backend with central-store discovery. The daemon, policy kernel, scheduler, and native agent connection are under implementation. The first implementation target is a small persistent reaction kernel with demonstrable recovery behavior.

Start with the [documentation map](docs/README.md), [semantic model](docs/reference/model.md), and [TypeScript API](contracts/index.ts). The [implementation sequence](docs/development/implementation.md) identifies bounded deliverables and their acceptance cases.

## Contract checks

Use the pinned Node.js and pnpm versions through mise:

```sh
mise install
mise run setup
mise run check
```

These commands check declarations, positive and negative type examples, documentation links, API documentation coverage, and storage execution tests. The tests include new-process reopen, competing writers, and interruption rollback. See [verification](docs/development/verification.md) for the tested environment and limitations.

## Personal store

The user-facing entry point is `~/.moment/`. By default it is a symlink to `~/.local/share/moment/`; `MOMENT_HOME` can select another absolute location. Active intents, checkpoints, project associations, and future runtime data belong there. Touched projects need no Moment metadata. The [storage contract](docs/reference/storage.md) defines discovery, identity, and conflict handling.

The tracked [implementation goal](docs/development/implementation-goal.md) is reusable. A personal working copy belongs in the central store and becomes active only when explicitly invoked.

## Development and distribution

Read [AGENTS.md](AGENTS.md) before changing contracts. No distribution license has been selected. The package is private and marked `UNLICENSED`; it is not published to npm.
