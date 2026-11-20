# Authority and generated policy

Moment derives permissions from authenticated participation, admitted relationships, explicit grants, and active policy. Agents may author and activate policies within delegated authority. Human review is a possible policy requirement, not an obligatory step for every change.

## Evaluation

The transport binds a request to a principal and an active grant for each admitted context. Caller parameters cannot override that identity. Operations without a grant parameter use that bound grant. Explicit grant parameters must name a grant exercisable by the authenticated caller; they do not permit impersonation. Bootstrap system operations use the host's configured bootstrap authority. `policy.evaluate` evaluates that caller's action against the supplied grant, target incident, resources, and context snapshot. A permit is explanatory evidence for that snapshot, not a reusable authorization token. Commit and effect dispatch repeat the relevant checks against current state.

Effective permission requires all of the following: an authentic, unrevoked grant chain; the requested action within every applicable delegation; incident and resource inclusion; current policy permission; and available resource allowance. Containment, ancestry, model confidence, and matching capability advertisements do not independently grant access.

Policies contain exact action names, permit or deny rules, a condition tree, and limits. Every applicable deny wins. At least one applicable permit is required. If any matching action's deny condition is unknown, the decision is indeterminate even if a permit succeeds. An unknown permit with no successful permit also produces indeterminate; otherwise known false conditions do not apply. Indeterminate decisions cannot authorize effects. Limits combine by the most restrictive applicable bound. A policy without a permit is a valid policy that permits no operations. `Policy.parent` records derivation and does not implicitly import additional permissions.

## Bounded conditions

`Condition` is a declarative evaluator input, not executable shell, JavaScript, or an LLM instruction. Maximum depth is 16, maximum total nodes is 256, and `related.maxHops` is 1 to 8. Reaching an evaluation or read bound produces unknown. These are provisional defaults, changed through versioned profiles rather than guessed during execution.

`all` and `any` require at least one term. They use three-valued logic: false dominates `all`, true dominates `any`, and otherwise an unknown operand yields unknown. `not(unknown)` stays unknown. Equality compares canonical JSON values without coercion. `lessOrEqual` accepts finite numbers only; other operands are invalid. Missing bindings produce unknown. `exists` examines authorized current support at the selected snapshot, returning unknown if the evaluator cannot inspect the required scope. `related` follows admitted directed relation roles `subject` to `object` for the exact listed schemas, with bounded traversal. Bootstrap structural relations do not automatically serve as authorization edges.

The evaluator supplies reserved bindings `contextId`, `principalId`, `incidentId`, `action`, `resourceRefs`, `contextRevision`, and `now`. Reaction evaluation additionally supplies `event.id`, `event.ids`, `event.type`, and `event.subjectRefs` for triggering events. Scheduled evaluation supplies `occurrence.id`, `occurrence.eventIds`, and `schedule.id`; these remain unknown outside that runtime context. Binding registration is versioned. Unregistered names are rejected when publishing a policy or rule. Agents cannot provide trusted binding values through prompt content.

Authorization relationships must be written through admitted authority operations or designated assertions whose source is accepted by the current policy. A generic assertion that a principal is an administrator remains ordinary evidence unless an existing policy explicitly recognizes its authenticated source. Imported assertions never become local grants automatically.

`Policy.authorityIssuers` names locally authenticated principals whose assertions may support authorization queries. Omission preserves the initial context owner's authority for compatibility; an empty list accepts no assertion issuers. The bootstrap policy names its owner explicitly. `exists` and `related` consult current support from those issuers, filtered by the caller's grant. A positive visible proof can succeed; an absent proof under a restricted view remains unknown so negation cannot turn inaccessible information into permission. Changing the issuer list changes interpretation under the new policy without rewriting the original assertion's attribution.

Authorization queries admit at most 4,096 records and 16,384 assertions, with a shared 32,768-unit scan/traversal budget and at most 512 visited path endpoints. Exhaustion returns unknown. These initial bounds constrain policy evaluation, not ordinary evidence retention. Query callbacks treat unsupported, foreign, or unresolved endpoints as unknown. The runtime currently follows `subject` to `object` roles for the exact relationship schemas requested by the rule.

## Delegation and activation

`grant.issue` checks that the issuer may delegate the requested actions, incidents, resources, expiry, and budgets. A child cannot widen any parent's envelope. A grant can name a human, process, or agent principal. Provider ownership is authenticated separately from an advertised provider ID. Revocation applies transitively to descendants and queued or future effects; in-flight effects require cancellation and outcome reconciliation rather than assumed rollback.

The implemented chain check bounds ancestry to 32 grants, rejects cycles and missing ancestors, and rechecks revocation and wall-clock expiry on every call. Each delegated issuance names the session's bound parent. Resource references may reserve future record IDs, but must remain within the same system and context. A grant's incident list scopes incident operations; its resource references scope graph records, evidence, and protected control reads. Schema admission currently requires operator authority. Closure and policy activation additionally require context-wide incident scope and the context's own resource reference. Possessing an incident does not grant authority over its containing context.

An issuer may revoke a grant it issued under its current delegation branch, or revoke the bound grant itself when permitted. Another credential for the same principal does not inherit that branch's administrative scope. Revocation prevents receipt replay and historical reads under the revoked chain. Acknowledged work and its provenance remain stored.

`policy.publish` stores an immutable candidate with evidence. `policy.activate` changes the active policy reference under the current policy and bootstrap envelope, with an optimistic revision guard. The candidate cannot authorize its own activation. Autonomous activation is allowed when the caller has `policy.activate`, the policy stays within its delegation envelope, and configured verification criteria pass. Changes to the host bootstrap envelope use an authenticated operator control outside the candidate's policy language.

The initial delegated activation check uses conservative syntactic implication. It preserves every existing deny, permits only existing conditions with equal or narrower action lists, preserves the authority-issuer set, and bounds limits by the grant, current policy, and context. It does not attempt general logical theorem proving. A context-wide delegate can therefore activate a proven narrowing autonomously; broader rules or different authorization issuers require the configured operator's admitted policy change. Publication can retain a broader candidate for discussion without activating it.

Policies can be represented, discussed, compared, and superseded as data. Runtime activation is a separate operation. The bootstrap profile defines who may issue initial grants, admit authority schemas, activate policy, recover the store, and close contexts. Initial host-owner authorization can be broad; execution grants remain explicit subsets appropriate to each effect.

## Verification and deduplication

Verification returns evidence against a named criterion and exact input revision. It does not create authority. A policy may require that evidence before admitting a transition. Criteria must distinguish a schema check, a test run, a source observation, and a model judgment. Model agreement alone cannot certify external behavior.

Exact identity deduplication rejects conflicting content under one ID. Exact-content deduplication can share immutable storage bytes. Semantic deduplication creates an attributable `moment.equivalent` relationship naming its criterion and version. It may consolidate a view, but it preserves independent assertions, provenance, scopes, and grants. Unknown equivalence leaves both records available.

## Policy development

Begin with deterministic policy sufficient for the next real consumer. Agents can propose changes using observed failures, user steering, and measured resource use. Admit each change against retained positive and negative cases. Keep consequential outcomes inspectable through policy references and supporting facts. Once activated, a new policy governs future admission; it does not rewrite historical permission receipts or imply that earlier effects never occurred.

## Instruction adoption and consistency guidance

The proposed [guidance admission contract](guidance.md#adoption-exception-and-supersession) distinguishes accepted normative expectations from observed facts, inferred preferences, and operational permission. It requires the same semantic checks through dedicated adoption, graph, and transition paths. In-scope engineering defaults may be adopted under existing delegation; accepting a target never activates an authorization policy or broadens a grant. Current graph behavior does not implement this new schema-specific admission layer.

Cross-context instruction reuse additionally requires the proposed [import projection boundary](work.md#cross-context-and-peer-operation), current source/local visibility, and explicit local adoption. A context import field, cached source, native thread label, or extracted instruction supplies no independent authority. Missing policy actions produce an actionable refusal and an admitted upgrade path, preserving old policies until actually changed.


## Candidate and resource authority

Source registration/locator revision and `context.limits` require the authenticated local operator plus current policy; neither a native agent name nor a model score grants this role. Resource revision requires nonempty accessible evidence and the observed revision/retry identity. It preserves all usage and queued/unknown reservations, refuses invalid reductions and changes no policy or grant. Explicit profile setup first admits precise actions under the old ceiling, then uses separately admitted ceiling/policy/grant updates. Selected delegated credentials never fall back to the owner during setup.

Refresh requires access to the registered source and its dependencies plus a configured host capture root or authorized semantic record. Cached source/results, execution detail and exact retry recheck current access. Assessment additionally needs current execution/profile actions, its selected grant, task/source basis and capacity. Native inference returns candidates as evidence; adoption and effects retain their separate authority. Shared authorized work remains collaborative rather than requiring agent/incident/intent isolation.
