# Governed work and provider integration

This contract completes the execution side of [purpose](purpose.md) and [guidance](guidance.md). [Evolution declarations](../../contracts/evolution.ts) own the proposed fields and seven operation shapes. The existing [execution and scheduling](reactions.md), [authority](authority.md), and [host integration](integration.md) contracts remain authoritative. The general Codex worker, cross-context projection, source watchers, and new operations described here are proposed; the currently qualified local provider is the fixed byte verifier, with a separate opt-in isolated native Codex connection.

## Implemented source-backed assessments

The [candidate service](guidance.md#source-backed-candidate-service) uses existing execution intent, claim, lease, outcome and reconciliation rather than a separate job engine. Its private exact dispatch binds profile, task, policy and captured-source identities before the native effect. A shared durable native-labor slot serializes memory and guidance; unknown work retains that slot across restart. Read operations do not queue capture or inference.

The qualified guidance profile is read-only Luna labor with owned native state and the same consumed API, model, permission and ephemeral-session checks as memory. Actual token/output accounting is distinct from unmeasured CPU or peak memory. A known output can coexist with unknown accounting: `usage.unmeasured` labels lower bounds, and cumulative unknown resources retain their declared reservation. Completed process memory is released; actual overruns remain recorded and block further context dispatch. These are local accounting semantics, not hard OS/subscription quota enforcement.

The native consumer retains the selected source/assessment basis in a real central handoff or intent and verifies retrieval. Candidate availability, model completion, faithful handoff, saved readiness, native goal activation and fulfilled purpose are different observations. The service does not adopt instructions, write goals or force a mode sequence. The broader work API below remains proposed except where listed in the installed operation catalog.

## Runtime responsibilities

| Component | Required responsibility | Effect boundary |
| --- | --- | --- |
| Source adapters | Observe selected files, conversation items, records, or provider facts; publish exact captures and coverage. | Current host/read permissions, private-data filtering, and bounded output. |
| Guidance service | Validate/adopt ordinary semantic records, maintain derived indexes, resolve applicability, and evaluate purposes. | Deterministic reads or guarded context writes; no hidden model execution. |
| Reconciliation service | Relate changed inputs to stale assessments and eligible work. | Existing rules, transitions, outbox, schedules, and resource admission. |
| Work provider | Execute one qualified procedure under its exact profile and report measured outcome/usage. | Existing lease, cancellation, and unknown-outcome lifecycle. |
| Native integration | Supply supported tools/context, exchange relevant notices, and execute separately authorized native handoffs. | Qualified protocol and host permissions, independent of Moment text authority. |
| Storage/operations | Preserve identity, evidence, retry material, source coverage, receipts, and bounded artifacts. | Versioned recovery and dependency-aware retention. |

These responsibilities can share one local service process and SQLite backend. Separate modules keep semantic interpretation, authority, and effectful adapters distinguishable. An optional provider can use a local process, VM, or graphical host without changing the purpose/assessment model. Native agents can still do ordinary work directly through their host tools; Moment does not claim to mediate or sandbox those independent actions.

## Work admission

`work.request` atomically admits one immutable work definition, one existing execution intent, and its outbox entry in one context. The definition names its incident/purpose, exact execution grant, procedure, worker profile, exact input basis, input, limits, and authorized-scope deduplication digest. Its ID has the existing immutable-content/retry semantics. The receipt names the definition and existing execution; it adds qualified native references and result references when available. There is no second mutable job-state machine.

Admission verifies current purpose/incident state, procedure applicability, exact capability/schema/profile compatibility, requester grant, source visibility, effect class, current input basis, actual resource envelope, and qualified enforcement guarantees. It refuses an unsupported provider before dispatch. Procedure and profile input/output schema references must be identical or have an explicitly admitted compatibility result; string similarity is not compatibility. The lower-level `execution.request` path cannot bypass work/profile checks for the same qualified capability.

Generic scheduling and execution remain usable independently of this package. A source capture, extraction, assessment, research comparison, consolidation, goal generalization, or repair is a capability-bound procedure. Those names describe possible operations, not a fixed sequence an incident must follow. A more detailed participant can expose its internal work while its parent observes one request/result.

The deduplication digest includes canonical input identity, procedure/profile/schema versions, exact basis, intended effect, and admissible scope. It is compared only among currently authorized equivalent requests. It cannot expose another principal's jobs or combine separate grants. Exact repeats reuse admitted work/receipts where purpose and policy permit; a superseding basis, deliberate independent assessment, or changed outcome requirement needs a separately attributable definition. No digest grants authority.

`work.read` observes actual stored definition/execution/results; it never starts a native turn. `work.cancel` forwards an authorized cancellation request through the existing state machine. `work.reconcile` uses the existing `Reconciliation` shape and current attempt guard. A timeout, observation gap, or missing terminal event alone cannot establish `not_started` or idempotence.

## Codex worker provider

A dedicated provider translates an admitted execution into a qualified Codex app-server thread/turn. It uses a supported configured authentication path and an explicit profile, never inferred credentials or another session's writable auth cache. Native subscription work and separately billed API labor have separate accounting. The [official app-server protocol](https://learn.chatgpt.com/docs/app-server) provides thread lifecycle, turn events, and per-turn output schemas; the adapter must qualify the installed methods/version and actual authentication before advertisement.

1. Before dispatch, persist a private descriptor containing the work/execution/attempt identity, adapter/server identity, exact input/template/schema identities, and intended native operation. It contains no credential values.
2. Claim and heartbeat the existing execution before native effects. Start or resume only a provider-owned thread. Persist acknowledged thread/turn identifiers and stream cursors as they become known. Foreground threads are sources only unless a separate handoff is authorized.
3. Deliver a bounded composed prompt, authorized source material, required output schema, and selected tool profile. Candidate extraction normally has source reads and candidate output only; it has no guidance-adoption, native-goal, release, or recursive job-dispatch tools.
4. Validate returned JSON and references, retain its exact result/evidence, and report through a durable attempt receipt. The coordinator admits candidate observations under current authority. Textual "success" or a schema-valid assertion is not completed product work.
5. Settle observed usage and release resources only after outcome admission. Clean only owned disposable thread/process artifacts whose receipt and recovery requirements are satisfied. Keep enough material to reconcile uncertain dispatch or completion.

The initial analysis default is one active native worker, one turn, a 120-second requested wall deadline, bounded selected sources, and no workspace/external effects. Profiles may declare up to 16 turns and one hour of requested wall time within their parent limits; every larger profile needs matching provider qualification. Deadline expiry requests interruption; actual termination and hard enforcement require observed provider/OS support. Unacknowledged interruption produces an unknown outcome, not manufactured cancellation.

The provider must reconcile a lost native start acknowledgment. It cannot assume that `thread/start` or `turn/start` is idempotent. Use only qualified job/attempt correlation and retained native state to locate a potentially created thread/turn. If dispatch or completion cannot be established, keep `unknown` and its reservation. Do not start another turn merely because an observer timed out. A real replay test must establish any advertised idempotence.

Read-only model instructions and a hidden tool name are not OS isolation. Separate delegate credentials restrict API authority; qualified native sandbox/resource controls restrict host access. Shared owner credentials retain shared authority and attribution. If a provider cannot enforce sub-agent, subprocess, network, token, or memory restrictions, it reports that limitation and is ineligible for profiles requiring the missing guarantee. Parent and nested work share explicit resource bounds; children cannot escape them through another model tool or daemon.

The current isolated Codex helper is a connection/probe, not this execution provider. Qualification uses a test-owned app-server, configuration/state/workspace, and transport. Tests never attach to, restart, upgrade, inject work into, or share writable auth state with the owner's primary daemon. Production connection is a separate explicit host integration using its qualified interface; testing permission does not activate it.

## Evidence-triggered reconciliation

Source adapters emit events only after admitting exact observations. An event identifies its observed project/subjects and source coverage; it is not proof that every file or provider was scanned. Graph/adoption/exception changes identify affected bindings through rebuildable indexes. Relevant changes make assessments eligible for freshness reevaluation. The original immutable result stays intact.

The resolver exposes missing facts or divergence and available applicable procedures. A deterministic rule can select a known check. An agent can propose an investigation or repair when interpretation is required. Native model decisions return proposals or bounded work requests under current delegation. A response is selected because it advances the purpose; no standard swarm, research phase, or checklist is mandatory.

Use existing `schedule.put` edge/each triggers, `rearmAfterCompletion`, coalescing, and occurrence identities. The current scheduler cannot execute arbitrary model code: it must admit `work.request`/an execution for a qualified provider. Registering these destinations and reservations is explicit implementation work. Existing capacity wakes concern logical reservations, not physical host telemetry. Physical idle/memory conditions need qualified observations before they can influence selection.

Multiple related edits coalesce while one assessment is pending. A current matching basis can reuse a prior assessment with its original method. Repeated unchanged findings or an accepted exception should not schedule another identical repair. Use a changed source/criterion, new discriminating evidence, expired exception, explicit request, or appropriate temporal condition to reopen evaluation. Absolute timers need fresh anchors; they must not create an accidental busy loop.

When nothing eligible can make progress, retain next conditions and rest. An unavailable provider can justify a compatible alternative or a truthful wait, not a fabricated result or expanded permissions. A finite assessment job completes independently of the maintained purpose. Completion of an extraction does not activate its candidates or close the product goal.

## Concurrent writers and repair effects

A `RepairProposal` names its supporting assessments, exact record/artifact basis, expected old content identities, proposed content, graph changes, and verification procedures. The current coordinated writer can review/apply it within existing delegation. Background analysis can proceed while another agent develops code; write ownership is checked before effects. One current continuation writer is coordinated explicitly and is not a kernel lease or security principal.

Before application, revalidate all relevant inputs, current permission, intended effect, and actual worktree/subject ownership. A changed input returns a conflict and retains the proposal; it never overwrites newer work. Existing context revision guards remain the first store concurrency mechanism. Introduce read-set admission only after measured false conflicts and dedicated policy/read-consistency tests.

The proposal's `coordinationRefs` identify the current writer agreement or qualified publication custody. References alone grant no permission. A preflight hash check is not an atomic filesystem compare-and-set against non-cooperating editors. Apply only with the qualified publication protocol and its actual coordination/quiet conditions; otherwise retain the proposal for the current writer. Full-access external tools can bypass a cooperative protocol, so no universal host write-exclusion guarantee is implied.

An artifact writer needs a qualified expected-old publication/journal protocol. Filesystem edits and graph writes are not one atomic transaction. Multi-file failure or an external successful effect with lost persistence is unknown/partial until reconciled. Retain per-subject outcomes and exact retry input; do not claim rollback, rerun effects blindly, or update a dependent assessment as though every proposed byte was installed. Verification names actual resulting bytes and behavior. Publication, pushes, releases, infrastructure mutations, and new spending require their applicable authority.

Shared desktop, VM, runtime, or test-resource access is negotiated as a capability with a current owner/lease and scoped cancellation. It is distinct from repository access. A compatible advertisement must state platform, input/output schema, effect scope, concurrency, isolation, resource accounting, cancellation, and receipt/recovery guarantees. The fixed byte verifier does not qualify a graphical or VM provider. New provider implementations require their own actual isolation and recovery evidence.

## Native goal handoffs

Generalization emits a central `GoalDraft` and records how the complete purpose, accepted guidance, unresolved work, and historical sources contributed. It preserves project contracts rather than embedding competing copies. Native objective text is nonempty and within the qualified host's limit; the large canonical intent remains a referenced artifact. Material boundaries remain discoverable and cannot be silently dropped for byte limits.

`NativeGoalHandoff` is an operator/native-host capability input, excluded from ordinary analysis MCP profiles. It names the draft, adapter, exact thread, expected old objective digest/status, intended new state, and authorization references. Runtime admission checks actual current authorization rather than believing those references alone. Existing user authorization for a deliberate goal replacement can permit an autonomous bounded handoff; ordinary source extraction cannot.

Use `/goal edit`, or clear and initialize `/goal <prompt>`, or the independently qualified protocol equivalent that actually replaces the objective. Verify resulting objective bytes, canonical intent basis, target thread, and intended state; report activation separately from observed turn activity. Resuming or setting the old objective active is insufficient. An incident being open, a queued message, or a saved file does not establish native execution.

The adapter needs per-thread mutation coordination. A protocol lacking conditional goal updates cannot promise atomic compare-and-set against simultaneous user edits. If exclusive coordination cannot be established, produce a prepared draft and explicit conflict/manual handoff rather than racing an unconditional overwrite. A clear-then-set sequence is non-atomic and must retain recovery state. An interruption or divergent readback is `unknown`/`conflict`; never automatically restore an old objective over a subsequent user change. A verified receipt records what was actually observed, not a lasting guarantee that nobody will edit it later.

A conflicting replacement is an unsuccessful work outcome; an uncertain replacement retains the existing execution's unknown state. A successful read-only assessment can legitimately report divergence without claiming the affected purpose satisfied.

Native worker jobs ordinarily use finite turns rather than native goals. Their own persisted Moment work/incident supplies continuation. Neither job completion nor a foreground thread message replaces or activates a user's native goal. The integration must test this separation, including the earlier failure where a correct central intent coexisted with an obsolete native objective.

## Cross-context and peer operation

The initial implementation can use explicitly admitted local projections of shared guidance. A qualified import projection identifies exact source records/criteria/support and source context revision, with independent local adoption. Reads check both current source visibility and local use authority. A withdrawn source, revoked grant, unresolved refresh, or unavailable peer yields stale/unknown applicability or refusal as appropriate; cached history cannot restore active permission.

Source and destination contexts retain independent revisions. Each local commit is atomic only in its own context. A failed destination write does not imply rollback of the source, and a partial exchange retains its checkpoint. Imported execution/incident snapshots remain observations rather than active local control state. Authenticate identity and validate exact schema/capability versions, replay IDs, and withdrawal/supersession before use. Local systems can exchange selected evidence without sharing private goals, credentials, or full transcripts.

## Resource and recovery policy

Context, policy, grant, profile, and capability limits intersect. Provider-owned capacity coordinates concurrency across contexts; the initial one-worker analysis provider dispatches at most one job and keeps its slot occupied for unknown dispatch. This dispatch bound is distinct from admission into multiple context queues. The provider must expose queue/capacity limits without leaking hidden work. No new global semantic revision is implied.

Record measured inference usage, host measurements where available, and separately billed spend. A subscription does not provide a known dollar cost per turn or a strict remaining-quota bound. Missing provider accounting cannot be reported as zero or advertised as hard enforcement. Require qualified pre-call bounds for policies that demand a strict spend ceiling. Stop/reconcile at declared budget/deadline boundaries and retain useful partial results without labeling the complete purpose achieved.

Source selection, prompt bytes, output bytes, logs, event queues, artifact retention, and index rebuilds are bounded. Storage pressure defers artifact-producing work and preserves accepted meaning, current state, unknown effects, and recovery inputs. A read-only extraction must not induce unbounded full-snapshot growth. Aggregate cheap observations before committing useful semantic updates; measure before changing the existing storage representation.

On restart, reconcile pending triggers, existing execution leases, native dispatch descriptors, received receipts, imported source freshness, and partial artifact publications before new effects. Exact retry identities and source bases survive. The service does not promise execution while the host is offline, automatic upgrade/restart of the owner's daemon, or off-host backup through local persistence.

## Installed surfaces and rollout

| Policy/profile responsibility | Permitted purpose | Required boundary |
| --- | --- | --- |
| Reader | Resolve selected purpose/guidance and retrieve authorized evidence. | No model dispatch or mutation; incomplete/forbidden knowledge remains explicit. |
| Curator | Adopt source-supported instructions or engineering defaults in an existing delegation. | Scope/issuer/source validation on every admission path; no new operational permission. |
| Analysis worker | Capture/inspect qualified inputs and return candidate observations, judgments, or goal drafts. | Separate execution grant, bounded tools/turns/usage, no acceptance or foreground effects. |
| Repair worker | Apply a selected supported proposal and verify its actual result. | Current artifact/writer/publication custody, exact old inputs, admitted effects, and recovery evidence. |
| Native handoff operator | Replace the chosen native goal after deliberate owner handoff. | Actual host authorization, qualified adapter, prior-state/coordination guards, and exact readback. |

These are responsibility profiles, not new principals or mandatory agent roles. One authorized participant can perform several responsibilities; a worker's authenticated credential and grant still determine its actual authority. A context with zero execution allowance can retain/read guidance while refusing background work. A policy upgrade can independently enable read, scoped curation, or bounded dispatch; enabling discovery does not imply enabling every capability.

The current 22-tool continuity profile includes source registration/refresh, candidate assessment/read and existing execution cancellation/reconciliation. The remaining normative design is separate. Future continuity discovery adds `guidance.resolve`, `purpose.evaluate`, and permitted work reads/requests only after implementation and policy qualification. A read-only analysis profile excludes adoption, repair application, recursive dispatch, installation, service control, and native goal replacement. Operator capabilities remain separately admitted. Each profile is derived from the same contract/catalog and actual authenticated grant; tool visibility is usability, not authorization.

Future human entrypoints are `moment guidance resolve`, `moment guidance adopt`, `moment work request/read/cancel/reconcile`, and `moment purpose evaluate`, accepting structured file/stdin input with existing strict retry behavior. Selective `moment agents` discovery and MCP expose the same installed facts, schemas, availability, and provenance. New methods are unavailable until registered and tested. Existing policies require an admitted upgrade, with actionable discovery when a method is absent or forbidden; no silent owner-credential fallback or blanket policy expansion.

The remaining normative proposal does not itself install a login service, watcher, background schedule, provider, global instruction, repository marker or model thread. The [implementation index](../development/implementation.md#purpose-and-guidance-package) defines all implementation units and end-to-end evidence needed before any such capability is advertised.
