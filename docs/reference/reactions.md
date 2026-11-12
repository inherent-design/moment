# Reactions and execution

Reactions respond to changes relevant to an incident. They can propose a semantic change, arrange an execution, refine a view, or leave an incident resting. Runtime scheduling implements those decisions within current authority and measured resource limits.

## Proposal and commit

`reaction.evaluate` is a bounded, read-only evaluation of an immutable rule against a snapshot and named events. It returns eligibility, an explanation, and optionally a candidate operation input. A false condition is ineligible; an unknown condition returns `POLICY_INDETERMINATE`. It does not call a model or execute the operation. The operation name must be an installed Moment method or admitted capability name. Literal input is copied, then registered bindings replace existing JSON Pointer locations; missing locations, overlapping pointers, and unsupported bindings are invalid. Result validation uses the destination's schema.

`transition.propose` records a candidate with explicit changes, execution intents, evidence, and exact policy and rule references. Its `basisRevision` must equal the request's `expectedRevision`. The proposal is validated but has no domain effects. The proposal write advances the context revision once. `transition.commit` may commit only while the current revision equals the proposal's recorded revision and its admission checks still pass. A changed context requires a new proposal using fresh evidence; the old proposal is not silently rebased. This coarse guard is an initial correctness choice, not a throughput claim.

Commit atomically writes admitted semantic changes, control changes, execution intents in an outbox, and emitted events. A failure writes none of the proposed domain change. A rejected proposal can retain its explanatory rejection in a separate admitted control transition. Empty changes and executions are invalid for a proposal. A committed proposal returns its original receipt on an exact retry.

`graph.transact` provides the same guarded atomic admission for direct graph changes without creating a separate proposal. `execution.request` provides it for one execution intent. None of these operations promises an atomic transaction with the external world.

## Execution lifecycle

| Current state | Admitted next state | Trigger |
| --- | --- | --- |
| `queued` | `leased`, `cancelled` | Claim or cancellation before dispatch. |
| `leased` | `running`, `cancel_requested`, `unknown` | First heartbeat marking dispatch, cancellation, or lost lease. |
| `running` | `succeeded`, `failed`, `cancel_requested`, `unknown` | Outcome receipt, cancellation, or lost lease. |
| `cancel_requested` | `cancelled`, `succeeded`, `failed`, `unknown` | Observed outcome; cancellation can race with completion. |
| `unknown` | `succeeded`, `failed`, `cancelled`, `queued` | Evidence-backed reconciliation; requeue only when non-execution or safe idempotent replay is established. |
| `succeeded`, `failed`, `cancelled` | *none* | Terminal for this execution ID. A new admitted intent may request another execution. |

Claim binds an authenticated provider to one execution and increments its fencing token and attempt number. A heartbeat extends the lease subject to limits and marks a leased execution running before any external effect. The worker verifies that heartbeat succeeded before dispatch. Every finish or heartbeat must present the current lease ID and fencing token. Expired or replaced leases return `LEASE_STALE`. A late observation may enter through reconciliation, preserving its old attempt attribution, but cannot overwrite a newer attempt.

Lease expiry does not establish that an effect failed or never happened. It produces `unknown` and asks the adapter to reconcile. Providers declare lookup, idempotent replay, or manual reconciliation support. A provider with neither lookup nor idempotency leaves uncertain effects unresolved until discriminating evidence arrives. `execution.reconcile` is restricted to the provider or delegated reconciliation principal. An `observed` resolution records its outcome, including continued uncertainty. A `retry` resolution requires evidence for its `not_started` or `idempotent` basis and fresh admission before requeue. Retry preserves the external idempotency identity for this execution.

Cancellation is a recorded request to stop. The adapter reports what happened. It may be impossible to reverse a completed action. Context closure blocks new effects and requests cancellation for admitted running work, while preserving authorized finish, reconciliation, and resource-release operations.

## Scheduling

`schedule.put` binds an immutable rule to an incident and wake condition. The ID identifies that exact schedule content; replacement uses a new ID after cancellation. Installing a schedule does not immediately satisfy an event trigger from historical events. The installation revision becomes its baseline. An `at` trigger already due becomes eligible once; an `after` trigger can refer to a retained earlier event.

An event trigger filters event type and subject selection. `each` admits one trigger occurrence per matching event. `edge` evaluates whether the selector has any current visible matches and fires on a false-to-true transition after installation. Repeated true states do not fire. Selector evaluation uses the schedule owner's current authorization. Withdrawal can reset the edge. Persist the baseline and last evaluated event sequence.

`once` completes after its first admitted reaction, including a reaction that produces a definitive ineligible result; a transient error retains its pending occurrence. `rearmAfterCompletion` admits no overlapping reaction from that schedule. With `coalesce`, multiple pending triggers combine into one occurrence carrying their event IDs; otherwise retain bounded pending occurrences. Repeated timer schedules require a new temporal anchor after completion; rearming an already-fired absolute deadline is invalid. Queue capacity is a profile limit; overflow returns a visible `LIMIT_EXCEEDED` event and preserves a rescan cursor rather than dropping work silently.

The initial scheduler chooses eligible occurrences by oldest enqueue sequence, with round-robin admission across incidents and each context's concurrency bound. Priority or cost heuristics can be added through policy after measurement. Selection never changes admission. Reevaluate policy, current grants, capability freshness, and capacity when dispatching.

## Budgets and rest

All `Limits` values are nonnegative safe integers. Zero means no allowance, not unlimited. Limits on a context are shared aggregate envelopes; an execution requests a reservation within them. CPU, model-token, output, and spend limits are cumulative within each context and grant, including descendant grants; memory and concurrency bound simultaneous reservations. Execution limits bound that execution across attempts. Contexts keep their own cumulative totals until an authorized budget revision, which is outside the initial API. A new grant does not reset consumed context resources.

Reserve before dispatch, settle measured usage, and release unused reservation when the outcome permits it. Unknown outcomes retain a conservative reservation until reconciliation. Spend microunits use the declared currency; currency mismatch refuses admission. A provider without reliable pre-call cost or usage bounds cannot promise a strict spend ceiling and must not be admitted under a profile requiring one. Subscription capacity and billed API spend are recorded separately.

When no eligible activity can advance an incident, retain its continuation references and wake conditions, set it resting, and release active compute. Rest needs no model polling. Resource availability, user input, new evidence, or a declared deadline can wake it. The user may complete or cancel an incident at any time under their authority. A host that is offline retains pending intent and reconciles missed deadlines on restart rather than inventing completed work.
