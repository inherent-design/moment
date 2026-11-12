# Programmatic and transport contract

[The API declarations](../../contracts/index.ts) define the `0.1` programmatic interface. The first implementation exposes the same method names through JSON-RPC 2.0 over a local user-owned Unix socket. Network transport, MCP, and CLI bindings are adapters to this contract, not independent authorization paths.

## Requests and results

`MomentClient.call(method, input)` resolves to `Result<Output<typeof method>>`. On the wire, successful JSON-RPC calls return that `Result` as `result`, including domain failures with `ok: false`. JSON-RPC parse, invalid-request, unknown-method, and invalid-params failures use standard JSON-RPC error responses. Every request requires a string ID; batches and notifications are unsupported in `0.1`. The client maps disconnected or indeterminate writes to `OUTCOME_UNKNOWN` and retains the exact request for reconciliation.

Use newline-delimited UTF-8 JSON frames, with a maximum of 1 MiB per frame before parsing. Duplicate object keys, non-finite numbers, unknown fields at declared boundary objects, and invalid UTF-8 are invalid input. `Json` payloads may carry additional data only within their registered schema. A parser that cannot reject duplicate keys is not sufficient for the admitted runtime boundary. Connections authenticate the operating-system peer or an explicitly configured principal credential; possession of a caller-supplied `principalId` is never authentication.

The initial socket is user-only. Agents needing distinct authority require separate authenticated credentials issued by the local host owner. Credentials and session bindings remain outside request JSON and prompts. A full-access host process can bypass a user-space daemon, so agent isolation is an adapter and OS enforcement concern as well as an API policy concern.

## Scalar and content rules

IDs are lowercase UUIDs. Revisions, sequences, counters, sizes, and limits are nonnegative JavaScript-safe integers; fencing tokens and committed revisions start at one. Instants use RFC 3339 UTC with `Z`. Digests are `sha256:` followed by 64 lowercase hexadecimal digits. Canonical JSON hashing follows RFC 8785; artifact digests hash decoded bytes. Binary artifacts use strict RFC 4648 base64 without whitespace. The maximum decoded artifact size through this API is 512 KiB; larger storage transport is deferred.

`SchemaRef` binds an exact name, version, and digest. Schema documents use JSON Schema 2020-12 and local references only. The registry rejects a name/version reused with different bytes. Unknown schema references are invalid. Shape validation does not replace domain invariants in the reference documents. TypeScript declarations alone do not validate untrusted JSON.

## Consistency and retry

Every mutation except context bootstrap includes `expectedRevision` and `idempotencyKey`. The kernel authenticates the principal, checks visibility of an existing receipt, then checks the idempotency record before performing new admission. The key scope is `(principal, context, method, key)`. An identical request digest returns the recorded response without repeating effects. Reusing a key with different input returns `IDEMPOTENCY_CONFLICT`. A revoked principal cannot use receipts to read data it can no longer access.

First-time writes require the exact current context revision, current permission, and all domain checks. Commit increments revision once and stores response, events, and outbox together. An expired or lost response is resolved by retrying the exact original request; a new key creates a new requested action. Receipts remain for the lifetime of the context in the initial implementation. Context bootstrap scopes its key to principal and system because no context exists yet.

Read methods can pin `atRevision`. Omission selects the current snapshot. Pagination cursors are opaque, scoped to principal, context, query, and snapshot, and recheck current access on every page. The initial page limit is 1 to 100; `waitMillis` is 0 to 30000. Missing and inaccessible IDs return `NOT_FOUND` for object lookups. Retention invalidation returns `CURSOR_EXPIRED`, requiring a new authorized snapshot, never silently skipping events.

`events.read` with a nonzero wait requires no `atRevision`; it waits for the next authorized event after the cursor, up to the bound. A fixed-revision read requires `waitMillis: 0`. Event delivery is at least once. Persist the consumer cursor only after processing; deduplicate by event ID. Current policy still governs historical reads.

## Operation boundaries

Inputs and outputs are defined once in `Methods`. This table identifies the semantic owner and each operation's consequence.

| Method | Contract |
| --- | --- |
| `system.describe` | Negotiates exact protocol version and reports implemented methods. It does not advertise unimplemented declarations. |
| `context.create` | Creates an open context from an installed bootstrap profile, subject to system authorization. |
| `context.get` | Reads the context at the authorized snapshot. |
| `control.get` | Reads an authorized policy, grant, rule, capability, schedule, or view snapshot by exact reference. |
| `context.close` | Closes admission, requests cancellation, and retains recovery paths; see [reactions](reactions.md). |
| `schema.publish` | Admits an immutable schema document after digest and bounded-schema checks. |
| `schema.get` | Retrieves an admitted schema by exact name, version, and digest. |
| `incident.create` | Creates an open incident with purpose and completion criteria. |
| `incident.get` | Reads its current or historical snapshot. |
| `incident.update` | Revises its intent or state with evidence under [model](model.md) lifecycle rules. |
| `graph.query` | Returns selected semantic records and separately attributable support. |
| `graph.transact` | Atomically admits graph changes, preserving structural invariants and protected control boundaries. |
| `policy.publish` | Stores a candidate policy; publication does not activate it. |
| `policy.activate` | Activates the candidate under current authority and its verification criteria. |
| `policy.evaluate` | Explains an authorization decision for this principal and snapshot; see [authority](authority.md). |
| `grant.issue` | Issues an attenuated grant under existing delegation. |
| `grant.revoke` | Revokes the grant and its descendant authority. |
| `rule.publish` | Admits an immutable deterministic reaction rule. |
| `reaction.evaluate` | Evaluates a rule without mutation or external effects. |
| `transition.propose` | Stores a candidate semantic change and effect plan without executing it. |
| `transition.commit` | Rechecks and commits the candidate, with effects queued atomically. |
| `transition.get` | Reads proposal, commit, or rejection state. |
| `capability.advertise` | Stores a provider-bound, expiring capability advertisement. |
| `capability.match` | Reports exact contract compatibility and current eligibility; see [integration](integration.md). |
| `execution.request` | Queues one admitted execution and reserves its resources. |
| `execution.get` | Reads execution state, attempt, lease, and known outcome. |
| `execution.claim` | Acquires a fenced lease for the authenticated provider. |
| `execution.heartbeat` | Records dispatch readiness or extends the current lease. |
| `execution.finish` | Records the current attempt's observed outcome. |
| `execution.reconcile` | Resolves an uncertain outcome using attributable provider evidence. |
| `execution.cancel` | Requests cancellation or cancels an undispatched execution. |
| `schedule.put` | Installs a bounded wake condition and its immutable rule. |
| `schedule.cancel` | Stops future trigger admission; already admitted executions need separate cancellation. |
| `events.read` | Reads or long-polls authorized events after a scoped cursor. |
| `messages.send` | Persists a bounded, attributed message in the recipient mailbox. |
| `messages.read` | Reads the authenticated recipient's mailbox. |
| `messages.ack` | Records delivery acknowledgment for that recipient; it does not accept the requested work. |
| `view.publish` | Admits an immutable projection definition. |
| `view.read` | Returns a permission-filtered projection of one snapshot. |
| `prompt.compose` | Renders a digest-bound prompt from a template and authorized evidence. It invokes no model. |
| `exchange.export` | Produces an explicit authorized evidence bundle. |
| `exchange.import` | Admits a peer bundle as attributed evidence with foreign identities retained. |
| `artifact.put` | Stores small immutable bytes after digest, size, and permission checks. |
| `artifact.get` | Retrieves bytes only through an authorized context reference; knowledge of a digest is insufficient. |

Generic selector fields intersect. Omitted `ids` or `schemaNames` mean no restriction for that field; explicitly empty arrays match nothing. `relatedTo` selects records incident to a visible relation, filtered by `relationRole` when supplied. `relationRole` without `relatedTo` is invalid. Queries with `assertionStatus: any` may include unsupported records; `asserted` requires current applicable support. Current visibility always applies.

## Errors

`Fault.code` is stable machine-readable classification; `message` is a concise explanation without hidden data or credentials. `details` is bounded JSON containing authorized diagnostic references. `retry` directs recovery: `same_request` retains bytes and key, `refresh` obtains a fresh snapshot and new proposal, `reconcile` investigates an uncertain outcome, and `never` requires a changed condition or request.

Revision conflicts and stale leases are not transient success. Policy evaluation errors yield `POLICY_INDETERMINATE`. Expired advertisements yield `CAPABILITY_UNAVAILABLE`. Resource admission failures yield `LIMIT_EXCEEDED`. A timeout around an external effect yields `OUTCOME_UNKNOWN` unless the provider supplies stronger evidence. Internal exceptions cannot become permissive policy decisions or successful execution receipts.

## Store boundary

`StorePort` is a trusted in-process interface. `Snapshot.controlState` and `DurableBatch.controlChanges` carry kernel-private versioned records; they are never accepted from untrusted wire requests. The initial implementation uses a single local writer and SQLite transactions. A commit stores state, revision, events, idempotency response, and outbox together. Blob staging precedes commit; committed artifact references remain recoverable after restart. Schema migrations, backup, and storage retention follow [storage](storage.md).
