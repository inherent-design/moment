# Purpose, consistency, and governed adaptation

This document owns the complete proposed evolution of Moment's purpose model. [Guidance](guidance.md) owns extraction, interpretation, discovery, and composition; [work and providers](work.md) owns execution and operational coordination. [Evolution declarations](../../contracts/evolution.ts) own the proposed boundary fields. These declarations are separate from the installed `Methods`, `ManagedMethods`, and binding catalog. [Implementation](../development/implementation.md#purpose-and-guidance-package) distinguishes the complete design from future implementation; [verification](../development/verification.md) records actual checks.

## System purpose

Moment preserves and develops meaningful work across sessions, agents, projects, runtimes, and perspectives. It makes accepted purposes, relationships, evidence, interpretations, and admissible responses discoverable without requiring a universal project layout or continuous model activity. The native coding agent remains the interactive work environment. Moment supplies continuity, interpretation support, coordination, and governed execution alongside it.

The complete system has five connected responsibilities:

| Responsibility | Observable result | Existing foundation |
| --- | --- | --- |
| Preserve meaning | A recipient can recover the intended outcome, decisive corrections, current evidence, uncertainties, and next action. | Incidents, records, assertions, relationships, and continuation. |
| Discover applicable expectations | An agent receives relevant instructions and can explain their applicability, source, exceptions, and remaining conflicts. | Contexts, schemas, policy, views, and prompt composition. |
| Assess and reconcile divergence | Changes can make earlier assessments stale, trigger bounded investigation, and produce verified repairs or explicit unresolved findings. | Events, deterministic reactions, proposals, and guarded transactions. |
| Coordinate capable participants | Native agents, local processes, optional VM/graphical hosts, and other systems exchange selected information under their actual authority and capabilities. | Messages, advertisements, grants, executions, scheduling, and host adapters. |
| Carry useful learning forward | New goals reuse attributable principles and local refinements while retaining scope, uncertainty, and supersession. | Source capture, extraction candidates, adoption, and goal drafts in this package. |

Simple discussion can use none of the durable mechanisms. A complex purpose can develop participating incidents, independent investigations, shared findings, and bounded work as conditions justify them. Research, comparison, implementation, review, and consolidation are available responses, not required stages or mandatory agent roles.

## Agent runtime and service boundary

Moment is a local service used by capable native agents. In this deployment Codex is the primary agent runtime: it owns its working conversation, reasoning and retrieval choices, native tools, threads, turns, and goals. Its context management includes history and compaction. Other qualified hosts can provide their own equivalent controls. A Moment context instead scopes semantic identity, relationships, evidence, and authority; it is independent of a model's active context window.

| Owner | Responsibility |
| --- | --- |
| Native agent and host | Select relevant information, choose retrieval depth and strategy, manage working context, and control native execution. |
| Repositories and connected systems | Own canonical code, specifications, guides, live facts, and existing operational interfaces. |
| Moment | Preserve selected meaning and source basis across participants; expose scoped expectations, relationships, evidence and durable coordination; admit its operations under current identity, policy and concurrency guards. |

Every public tool should identify the durable information or operation it supplies, its selection and authority scope, and the evidence and recovery information in its output. Typical consumers recover an earlier decision and its scope, resolve a relevant expectation, retain a consequential handoff, or make a conflict-safe attributable change. Existing files and native history remain sources; retrieval and tool availability do not require a second copy of every conversation or a mandatory Moment workflow.

Read success, coverage of the selected view, readiness to act, and purpose satisfaction are independent claims. A metadata projection can be complete for its request while excluding large bodies; a body selection limited by a response budget can return a successful partial result with recoverable omissions. The agent combines those results with its other context and retrieves further material when needed. Backend validation enforces permissions, identity, provenance, transactional guards, and operational bounds; response-size preferences do not define a universal cognitive budget.

## Purpose and incidents

A `PurposeDefinition` is an immutable semantic record describing an objective, its scope, criterion bindings, source basis, and continuation references. The existing incident remains the runtime continuity and lifecycle boundary. A purpose reference can appear in an incident's continuation; the incident's human-readable purpose and completion criteria must agree with the current accepted definition. Replacing a definition creates a new record and an attributable supersession, followed by a guarded continuation update. A file, project, thread, or repository does not automatically become an incident.

Two kinds of purpose share the same foundations:

| Kind | Completion and rest |
| --- | --- |
| `finite` | The stated outcome can be achieved. Required criteria need current, sufficiently complete evidence or an expressly accepted scoped exception; unresolved relevant effects or conflicts prevent a satisfied evaluation. |
| `maintained` | A desired condition is sustained as relevant inputs change. A current satisfactory assessment permits rest. It does not prove perpetual compliance or close the purpose; the owner can deliberately end, replace, or cancel it. |

`purpose.evaluate` observes the selected purpose and its accepted criterion bindings. For a finite purpose it returns `satisfied`, `incomplete`, or `unknown`. For a maintained purpose, sufficient current assessments and no outstanding relevant work return `resting`; divergence returns `incomplete`, and missing coverage returns `unknown`. Evaluation neither runs checks nor updates incident state. An authorized incident update records a resulting lifecycle decision with evidence. API completion remains an admitted claim: semantic quality is only as strong as the actual assessments and their supporting checks.

Advisory criteria inform choices without becoming hidden completion gates. Empty required criteria cannot establish that an unexamined textual objective is complete. A finite purpose with no accepted executable or reviewable closure criteria evaluates `unknown`. Exclusions and deferrals must be explicit; the agent cannot narrow the objective to its easiest passing subset.

An ongoing purpose can contain finite assessments and repairs under a selected perspective. Temporal overlap, structural composition, and causal dependence remain distinct relationships. Completing a repair does not complete its parent purpose; a resting parent does not imply that unrelated purposes or systems must stop.

## Consistency targets and reification

A `ConsistencyTarget` expresses a desired relationship and the criterion for assessing it, with rationale and sources. A `GuidanceBinding` realizes that target for named subjects in a scope. Role names identify each representation's responsibility: for example, `definition`, `implementation`, `guide`, and `example`. A subject can be an artifact, collection/view, capability, incident, or another addressable semantic unit. Its identity and source coverage must be established before a whole-project claim is made.

| General premise | Example binding | Evidence that can support an assessment |
| --- | --- | --- |
| Representations agree with their owning definition. | An API contract, implementation, operator guide, and examples describe the same operation. | Contract tests, actual behavior, link checks, and semantic review at identified revisions. |
| Repeated decisions have coherent semantic owners. | This application's layout/style tokens and reusable components encode shared presentation decisions. | Usage analysis, behavior and accessibility checks, rendered inspection, and deliberate exceptions. |
| Changes preserve maintainability and reproducibility. | A dependency pin, local patch, build inputs, and update procedure remain compatible. | Reproducible builds, focused regressions, patch applicability, and procedure review. |
| Explanations serve their intended readers. | Engineering guides use direct prose and distinguish durable contracts from transient narration. | An attributable review against accepted audience guidance and representative examples. |
| Meaningful work survives participant changes. | A canonical intent, ledger, conversation correction, and current continuation agree. | Exact source identity, explicit supersession, retrieval, and a recipient's correct next-action selection. |

Generalization retains the common premise and its independent supporting sources. It preserves local realizations, checks, tradeoffs, and exceptions. Equal wording or similar markup does not establish semantic equivalence. A component extraction must preserve behavior; a document consolidation must preserve useful meaning; a dependency procedure update does not authorize a new dependency, release, or host operation.

An interpretation can be revised when new evidence changes the premise. A target is not a permanently privileged axiom. Acceptance, refinement, contradiction, exception, derivation, and supersession stay explicit and attributable.

## Facts, judgments, instructions, and authority

The following meanings remain separate even when they refer to the same artifact:

| Meaning | Representation and admission |
| --- | --- |
| Observed fact | A selected capture or observation with exact identity, method, coverage, and current support. |
| Interpretation | A candidate or assessment whose author, criterion, evidence, and uncertainty are recorded. |
| Normative expectation | A target/binding with a current scoped adoption supported by an admitted instruction issuer. |
| Operational permission | The current host permissions, policy, grants, resources, and qualified capability. |

An explicit user correction can establish a normative source when its origin and applicability are verified through an admitted source adapter. A text field claiming role `user`, an assistant summary, or a frequently repeated phrase cannot establish that origin. Inferred preferences remain candidates until adopted within existing delegation. Agents can adopt ordinary engineering defaults autonomously within their admitted scope. Broader changes need the authority applicable to that broader scope; no universal human approval step is introduced.

An instruction adoption never publishes or activates an authorization policy. Existing policy operations remain the only authority-changing boundary. Adopting quality guidance cannot expand a grant, make a native agent a new principal, spend funds, grant filesystem access, or waive an operational gate. Both dedicated adoption and equivalent generic graph/transition writes must run the same semantic admission checks; an alternate write path cannot manufacture acceptance.

## Context and system boundaries

Shared personal guidance can live in a separate context. Project bindings select its accepted targets through explicit authorized import associations. A context's `imports` field alone is not an implemented cross-context data plane: the current kernel enforces local references. The evolution requires a permission-filtered import projection with captured source identities, current support/revocation checks, and local adoption where necessary. Until qualified, a locally admitted attributed copy is the supported pattern. Imported origins and local copies remain connected by provenance; copying does not copy authority.

Bindings select context, project, incident, and subject dimensions. Empty arrays mean unrestricted within that one declared context; nonempty dimensions intersect, while entries within a dimension are alternatives. Project, incident, and subject membership is resolved from admitted facts. Ambiguous or absent association is unknown. Conditions can further restrict applicability but cannot prove that arbitrary prose or another condition is a safe narrowing. Structural scope subset checks and current delegation determine admission.

One project can participate in several purposes. A single purpose can span related repositories without merging their identities, write ownership, or release permissions. Documentation ownership, the coordinated current writer, and an authorization principal are separate relationships. Worktree locality is not a security boundary.

Peer systems negotiate exact schemas, capability versions, input/output contracts, platform support, resource enforcement, and authority. They exchange selected evidence through authenticated, replay-resistant imports. A remote advertisement or imported result cannot instantiate a privileged local control object. Missing interoperability yields an explanation and a resting or alternative response. No external service, VM, GPU, vector index, or particular model is a mandatory dependency.

## Assessment and freshness

A `GuidanceAssessment` names the binding, criterion digest, exact input basis, observations, and method. Outcomes are `satisfied`, `divergent`, `unknown`, `not-applicable`, `excepted`, or `conflicted`. `excepted` requires a currently admitted scoped exception; `not-applicable` requires evidence for exclusion. An unknown applicability result cannot be converted into either one merely to continue.

The original result remains immutable when sources change. Freshness is a derived `current`, `stale`, or `unknown` judgment. Current means the recorded relevant inputs and accepted criterion still match a sufficiently complete fresh observation; it never means that an unobserved filesystem or provider has not changed. Changed relevant bytes, withdrawn support, an expired exception, or a replaced criterion require reconsideration. Timestamps record observations and freshness policy; they do not override content identity or establish causality.

Deterministic checks, agent judgments, and human observations retain their separate methods and limits. Their agreement is not independent verification when they share one underlying assumption. Assessment strength must match the criterion: a link checker does not prove explanatory quality, and a synthetic provider fixture does not establish live configuration.

## Reconciliation and adaptation

The system observes relevant changes, resolves applicable expectations, selects an admissible assessment or investigation, and retains its result. Demonstrated divergence can justify a repair proposal. A qualified procedure applies authorized changes under source and writer guards, then runs the relevant verification. Each of these responses is optional according to current evidence, authority, resources, and purpose; the model is not a mandatory pipeline.

Novel questions can justify exploratory agents. Conflicting observations can justify comparison or fact checking. Sufficient evidence can justify consolidation. Waiting for an external input can justify rest. The system retains the reason for the selected response and its measurable outcome. It does not optimize a universal health score or reward the number of agents, records, or rewritten files.

Coalesce related changes, reuse evidence only while its inputs remain valid, and assess affected relationships rather than rechecking the entire world. An accepted exception prevents repeated repair of the same intentional difference. After repeated failures without discriminating evidence, change the observation or rest with an explicit missing condition. Budgets, deadlines, cancellation, and storage pressure can defer further activity while preserving the purpose. Rest needs no model polling.

## Goal generalization and native work

Generalization produces a `GoalDraft` from a current purpose, accepted guidance, selected evidence, unresolved work, and explicit carried/discharged/superseded references. It is a reviewable artifact, not activation. The draft retains the complete actual objective and material operational boundaries; it does not append every historical prompt or silently reactivate completed work. Repository contracts remain their owners, and central aliases locate personal intents.

A new native goal uses `/goal edit` or `/goal clear` followed by `/goal <prompt>`, or an independently qualified equivalent replacement operation. Read back the exact resulting objective, canonical intent basis, thread, and intended state. Resuming the old goal or updating Moment's incident does not replace the native objective. Background finite work has its own job and native turn; it does not rewrite the foreground goal. [Work and providers](work.md#native-goal-handoffs) owns the concurrency and recovery contract.

## System boundaries and acceptance

Source repositories own implementation, specifications, guides, and their native ledgers. Moment owns the selected purpose, context, provenance, instruction adoption, assessments, proposals, work receipts, and current personal continuation. The binding catalog owns the relationship between installed APIs, MCP, CLI discovery, and directives. Source adapters observe reality; providers perform bounded operations; native Codex owns its threads, turns, and native goals.

The complete package must demonstrate correct discovery, scoped autonomous adoption, faithful generalization, real execution/recovery, concurrent-writer protection, cross-context visibility, and honest rest/completion. The [single implementation and acceptance index](../development/implementation.md#purpose-and-guidance-package) assigns these obligations. A static design pass establishes coherence and type compatibility, not operational homeostasis, agent quality, sandbox isolation, or model-cost enforcement.
