# Programmatic and transport contract

[The API declarations](../../contracts/index.ts) define the `0.1` programmatic interface. The first implementation exposes the same method names through JSON-RPC 2.0 over a local user-owned Unix socket. Network transport, MCP, and CLI bindings are adapters to this contract, not independent authorization paths.

## Requests and results

`MomentClient.call(method, input)` resolves to `Result<Output<typeof method>>`. On the wire, successful JSON-RPC calls return that `Result` as `result`, including domain failures with `ok: false`. JSON-RPC parse, invalid-request, unknown-method, and invalid-params failures use standard JSON-RPC error responses. Every request requires a string ID of 1 to 128 UTF-8 bytes; batches and notifications are unsupported in `0.1`. The client maps disconnected or indeterminate writes to `OUTCOME_UNKNOWN` and retains the exact request for reconciliation.

Use newline-delimited UTF-8 JSON frames, with a maximum of 1 MiB per frame before parsing. Duplicate object keys, non-finite numbers, unknown fields at declared boundary objects, and invalid UTF-8 are invalid input. `Json` payloads may carry additional data only within their registered schema. A parser that cannot reject duplicate keys is not sufficient for the admitted runtime boundary. Connections authenticate the operating-system peer or an explicitly configured principal credential; possession of a caller-supplied `principalId` is never authentication.

The initial socket is user-only. Agents needing distinct authority require separate authenticated credentials issued by the local host owner. Credentials and session bindings remain outside request JSON and prompts. A full-access host process can bypass a user-space daemon, so agent isolation is an adapter and OS enforcement concern as well as an API policy concern.

The implemented transport accepts one RPC per connection. Send `Authorization: Bearer <token>` and a newline before the JSON-RPC frame. The native client reads this token from the user-only `runtime/owner.json` file or an explicitly selected private credential; it never places it in RPC parameters or command arguments. Incorrect authentication closes the connection without admitting a request. `createClient(root).call(method, input)` in `runtime/client.mjs` exposes the declared `MomentClient` Result interface; `request` exposes the raw RPC envelope. The sibling type declaration binds method names to their inputs and outputs.

The `owner-local` bootstrap profile binds the context to the authenticated operator and records an initial policy and installed relation schemas atomically with context creation. Policy publication, activation, evaluation, grants, semantic transitions, deterministic rules, views, capability negotiation, execution control, durable events, and wake scheduling are implemented. Permissions do not advertise capabilities: `system.describe` lists only thirty-seven currently implemented methods. Concrete provider dispatch remains pending. Completion requires attributable accessible source references and current admission; it does not independently judge textual completion criteria.

Previously created contexts keep their saved policy. Newly installed methods require an explicit admitted policy update if that policy lacks the corresponding action; a daemon upgrade does not silently expand authority.

`pnpm moment credential <principal-id> '<bindings-json>'` is a local owner operation that creates a private file under `runtime/credentials/`. Bindings map each context ID to its exact grant reference. The registry admits at most 256 files, each no larger than 16 KiB and containing at most 100 context bindings. The selected principal must differ from the bootstrap operator. Only private, user-owned regular files are accepted; symlinks are refused. The service authenticates the token, binds its principal and context grant outside request parameters, and rechecks the actual grant chain on every call. A transport credential alone cannot create authority. `MOMENT_CREDENTIAL_FILE` or the typed client's `credentialFile` option selects a credential without putting its token in command arguments.

Daemon ownership is claimed in SQLite under `BEGIN IMMEDIATE`. A second live owner is refused. A dead process claim can be replaced after process-liveness inspection; a stale owned socket is removed only after a connection probe establishes that it is not serving. Ambiguous liveness leaves it intact. This supports process restart on the local host, not independent copies of the database on multiple hosts.

## Scalar and content rules

IDs are lowercase UUIDs. Revisions, sequences, counters, sizes, and limits are nonnegative JavaScript-safe integers; fencing tokens and committed revisions start at one. Instants use RFC 3339 UTC with `Z` and up to three fractional digits for the initial runtime's millisecond clock. Digests are `sha256:` followed by 64 lowercase hexadecimal digits. Canonical JSON hashing follows RFC 8785; artifact digests hash decoded bytes. Binary artifacts use strict RFC 4648 base64 without whitespace. The maximum decoded artifact size through this API is 512 KiB; larger storage transport is deferred.

`SchemaRef` binds an exact name, version, and digest. Schema documents use JSON Schema 2020-12 and local references only. The registry rejects a name/version reused with different bytes. Unknown schema references are invalid. Shape validation does not replace domain invariants in the reference documents. TypeScript declarations alone do not validate untrusted JSON.

## Consistency and retry

Every mutation except context bootstrap includes `expectedRevision` and `idempotencyKey`. The kernel authenticates the principal, checks visibility of an existing receipt, then checks the idempotency record before performing new admission. The key scope is `(principal, context, method, key)`. An identical request digest returns the recorded response without repeating effects. Reusing a key with different input returns `IDEMPOTENCY_CONFLICT`. A revoked principal cannot use receipts to read data it can no longer access.

First-time writes require the exact current context revision, current permission, and all domain checks. Commit increments revision once and stores response, events, and outbox together. An expired or lost response is resolved by retrying the exact original request; a new key creates a new requested action. Receipts remain for the lifetime of the context in the initial implementation. Context bootstrap scopes its key to principal and system because no context exists yet.

Read methods can pin `atRevision`. Omission selects the current snapshot. Pagination cursors are opaque, scoped to principal, active grant chain, context, query, and snapshot, and recheck current access on every page. The initial page limit is 1 to 100; `waitMillis` is 0 to 30000. Missing and inaccessible IDs return `NOT_FOUND` for object lookups. Retention invalidation returns `CURSOR_EXPIRED`, requiring a new authorized snapshot, never silently skipping events.

Graph and view cursors use separate scopes, authenticated encryption, random nonces, and fixed-size envelopes. A cursor from one view cannot request raw graph data or another view. Earlier cursor formats require a fresh query and return `CURSOR_EXPIRED`. View results expose a visible-content digest rather than the global snapshot revision; see [perspectives](model.md#perspectives). Raw graph reads explicitly include their snapshot revision and require separate method admission.

`events.read` with a nonzero wait requires no `atRevision`; it waits for the next authorized event after the cursor, up to the bound. A fixed-revision read requires `waitMillis: 0`. Event delivery is at least once. Persist the consumer cursor only after processing; deduplicate by event ID. Current policy still governs historical reads.

Event pages always return a resumption `nextCursor`, including empty pages and the current end of the stream. Each read scans at most 4,096 retained events; continue from the cursor to drain a larger backlog. Cursors bind the principal, grant chain, context, and optional historical ceiling. A long poll listens before its read, rescans on commit notifications, and rechecks current authority before returning. It retains no model process. Disconnect aborts its listener. The client timeout covers the requested wait; the service admits at most 256 simultaneous connections.

Events disclose notices for authorized affected subjects. One transaction can emit separate notices for different subjects; a notice requires visibility of at least one of that subject's admitted changes, and hidden provenance is not serialized. Private visibility requirements remain inside the store. Causal references are disclosed only when their events remain accessible, within a 64-event visibility bound. Raw event sequences and snapshot revisions expose context activity to principals explicitly granted `events.read`; use views when that metadata should stay hidden. Scoped event permission does not grant record payload or evidence access.

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
| `schedule.get` | Reads authorized schedule status, pending occurrence identities, and current active executions. |
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

Private event visibility alternatives can accompany trusted batch drafts. Public event serialization removes them. In-process commit notifications are advisory wake signals; durable event rows and scoped cursors own delivery and recovery. Losing a notification does not remove a retained event.
