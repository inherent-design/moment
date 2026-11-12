# Moment

Moment is a proposed local system for contextual incidents, governed reactions, and coordination between agents. It preserves the relationships, evidence, and intent needed to continue useful work across sessions, projects, and levels of detail.

This repository contains a local daemon, typed client, CLI, and SQLite storage backend. It supports operator and grant-bound identities, contexts, schemas, incidents, graph operations, governed policy changes, semantic transitions, deterministic rules, field-selecting views, capability negotiation, execution control, durable event delivery, wake scheduling, a fixed local byte verifier, durable messages, and deterministic prompt composition. An opt-in isolated Codex connection can retrieve authorized context and submit validated observations; it does not automatically dispatch model work.

Start with the [documentation map](docs/README.md), [semantic model](docs/reference/model.md), and [TypeScript API](contracts/index.ts). The [implementation sequence](docs/development/implementation.md) identifies bounded deliverables and their acceptance cases.

The next architecture is specified in [managed integration](docs/reference/managed-integration.md): shared operation provenance, a managed MCP bridge, context attachment and human status. Those features are proposed and are not current CLI commands. Runnable specification/upgrade goals live centrally under `~/.moment/intents`; real installation remains deferred.

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

`pnpm moment call <method> '<params-json>'` calls the same API through the authenticated Unix socket. Use `pnpm moment call <method> --file request.json` for structured input without shell quoting, or `pnpm moment call <method> --file -` to read stdin. File/stdin input is strict UTF-8 JSON, rejects duplicate keys, and is bounded to 1 MiB before admission; mutations retain the supplied revision and retry key unchanged. The service creates an operator credential and database in the central store, with the credential and socket restricted to the current user. Stop the foreground service with Ctrl-C; committed data survives restart. The initial `owner-local` policy admits the operator. Additional principals need both a policy permit and an issued grant; see [authority](docs/reference/authority.md).

After issuing a grant through the API, the local owner can create a separate transport credential with `pnpm moment credential <principal-id> '<grant-bindings-json>'`. The bindings map context UUIDs to full grant references. The command prints only the private credential file's path. Select it through `MOMENT_CREDENTIAL_FILE` for CLI calls or the typed client's `credentialFile` option. Creating a credential does not issue a grant or override policy. See [protocol](docs/reference/protocol.md) for request and recovery behavior.

## Local verifier

With the service running and an open context whose envelope fits the provider, run `pnpm moment verifier <context-id>`. This explicit owner operation installs exact schemas, advertises the fixed provider, activates an owner permit through the current policy, and issues a grant limited to requesting that capability. It prints capability and grant references plus per-execution limits for an ordinary `execution.request` call.

The input is `{ "contentBase64": "...", "expectedDigest": "sha256:..." }`, with at most 256 KiB of decoded bytes. Supply a new execution ID and an existing incident ID. The daemon dispatches the admitted work and exposes its result through `execution.get` and attributed receipt records. It retains provider receipts for restart reconciliation. Initial per-execution reservations are 5,000 CPU milliseconds, 256 MiB memory, 4,096 output bytes, and one slot; the worker uses no inference or billed API allowance. These reservations account for work; CPU/RSS are measured rather than enforced as hard OS ceilings. See [the installed provider contract](docs/reference/integration.md#local-byte-verifier) for guards and recovery limits.

## Native agent connection

Native agents can call the typed client or `pnpm moment call` to read an incident, compose a bounded prompt, exchange summaries, and submit schema-validated graph changes or transition proposals. `messages.ack` acknowledges delivery; it does not accept work. See [agent integration](docs/reference/integration.md#agent-adapter-and-prompts) for template admission and current detail access.

The opt-in `pnpm test:codex-native --credential-file /absolute/private/auth.json` exercises the installed Codex 0.167.2 through a separate app-server, state root and workspace. It supplies only the existing unexpired access token through in-memory external authentication, has no refresh token, invokes one bounded turn, and removes its owned temporary processes and state. It requires an explicit private credential source and uses the existing subscription. Ordinary checks never invoke Codex. See [the Codex boundary](docs/reference/integration.md#codex-boundary) before using or changing it.

## Personal store

The user-facing entry point is `~/.moment/`. By default it is a symlink to `~/.local/share/moment/`; `MOMENT_HOME` can select another absolute location. Active intents, checkpoints, project associations, and runtime data belong there. Touched projects need no Moment metadata. The [storage contract](docs/reference/storage.md) defines discovery, identity, and conflict handling.

The tracked [implementation goal](docs/development/implementation-goal.md) is reusable. A personal working copy belongs in the central store and becomes active only when explicitly invoked.

## Development and distribution

Read [AGENTS.md](AGENTS.md) before changing contracts. No distribution license has been selected. The package is private and marked `UNLICENSED`; it is not published to npm.
