# Implementation sequence and acceptance

The implementation establishes one useful persistent loop before adding provider breadth. This is the single work and dependency index; reference documents own behavior, and [verification](verification.md) owns executed evidence.

## Source-backed candidate delivery

The implemented subset adds registered file/semantic-record sources, explicit refresh, bounded source-backed Luna candidates and read-only native handoff evidence. It reuses execution/cancellation/reconciliation, shares durable native capacity with memory and permits governed operator revision of existing context ceilings. Contracts, generated bindings/directives, CLI/MCP, source projections and current-authority checks share one surface. The broader P1–P10 normative package remains proposed. [Guidance](../reference/guidance.md#source-backed-candidate-service) owns usage and limits; [verification](verification.md) owns the tested snapshot and rollout evidence.

## Units

| Unit | Outcome | Dependencies | Required evidence | Current state |
| --- | --- | --- | --- | --- |
| M0 Contracts | Typed boundaries, coherent reference docs, reusable goal, and central saved intent. | *none* | Type examples, documentation links, method coverage, final diff review. | Complete; static checks recorded in verification. |
| M1 Store and identity | Open the central store, import bootstrap files, persist records and assertions, and recover after restart. | M0 | E1, E2, E3, E12. | Storage, discovery, bootstrap reader, kernel, authenticated socket, and typed native client implemented and tested. The central saved intent has been adopted through the public API with exact intent bytes, source attribution, and its existing context/incident identity. |
| M2 Governed reactions | Evaluate bounded policy, delegate authority, propose changes, and commit one context transition. | M1 | E4, E5, E6, E7. | Semantic transitions, immutable rules, installed relation schemas, and permission-filtered views implemented and tested alongside delegated authority. Execution-intent admission belongs to M3. |
| M3 Scheduling and effects | Rest, wake, queue, lease, cancel, and reconcile one deterministic local test capability. | M2 | E8, E9, E10. | Implemented with the fixed local byte verifier. Actual measured execution, two attributed observations, rest/wake, scoped views, lost completion and receipt reconciliation, context-closure races, and restart are exercised through the real service. OS sandboxing and additional providers remain outside this evidence. |
| M4 Native agent connection | A small client exposes assigned incident context, bounded messages, and validated result submission to an existing coding agent. | M3 | E11 and a real end-to-end interaction with a pinned client version. | Durable recipient messages, deterministic authorized prompt composition, typed native client, and an opt-in isolated Codex 0.167.2 interaction implemented. Real restart and restricted native observation are exercised. The central saved intent and a real CLI file-input improvement were retained, proposed, retrieved after restart, verified and completed through the API (E15). |
| M5 Additional providers | Add an isolated process, VM, graphical worker, or peer only for a concrete consumer. | Relevant M1 to M4 boundaries | Real isolation, resource, recovery, and compatibility checks for that provider. | Deferred until a consumer needs it. |

Private modules, implementation language for the runtime, and persistence table layout remain flexible. The TypeScript API is a language-neutral boundary description expressed in TypeScript. A runtime in another language must preserve wire and semantic compatibility rather than duplicate a divergent specification.

## Acceptance scenarios

| ID | Scenario | Required observation |
| --- | --- | --- |
| E1 | Store restart after an acknowledged graph write. | The exact admitted records, revision, event, and receipt survive; no repeated effect. |
| E2 | The same key is retried; then reused with a changed payload. | The exact retry returns its original response; changed input returns `IDEMPOTENCY_CONFLICT`. |
| E3 | Two writers use the same revision. | One admitted mutation wins; the other receives `REVISION_CONFLICT` without partial writes. |
| E4 | An execution participant receives a restricted child grant. | Admitted work succeeds; sibling resources, increased budget, and self-granted rights are refused. These checks establish API enforcement, not OS isolation. |
| E5 | An agent publishes and activates a policy within delegation, then attempts expansion. | In-scope activation can proceed autonomously; expansion remains denied under the old envelope. |
| E6 | Equal content arrives from two sources and one withdraws support. | Content can share storage; independent attribution, remaining support, and permissions survive. |
| E7 | Several internal execution changes occur under an outer view. | Only declared visible changes appear; hidden intermediate data and counts remain hidden. |
| E8 | An incident rests, restarts, and later receives a relevant event. | No model polling during rest; one persisted trigger occurrence resumes admission with fresh authority. |
| E9 | A worker loses its lease after dispatch and later reports completion. | State becomes unknown, no blind replay occurs, and stale completion cannot overwrite a newer attempt. |
| E10 | Cancellation races with completion or grant revocation. | Recorded outcome reflects evidence; cancellation does not manufacture rollback. |
| E11 | Two participants exchange summaries and request detail. | Durable acknowledgment is distinct from task acceptance; detail access is checked again. |
| E12 | A project moves, or two clones share an origin. | Central identity survives the confirmed move; ambiguous clones are not silently merged or modified. |
| E13 | A peer bundle is replayed, then an old bundle follows a withdrawal. | Exact import is deduplicated; old evidence does not restore newer withdrawn support or grant local authority. |
| E14 | New evidence invalidates a premise used in a conclusion. | The dependency becomes eligible for reconsideration; original evidence and historical interpretation remain attributable. |
| E15 | Moment coordinates one improvement to its own implementation. | A real incident, evidence, proposed change, verification result, and continuation are recorded through its API; a restart preserves the same incident, and the improvement changes observable behavior. |

E13 is required when implementing exchange. E14 is required when implementing automatic support propagation. Both can initially be exercised through explicit graph operations without claiming a complete inference engine.

## First connected consumer

Use a synthetic incident with a real persisted intent, two independently attributed observations, a restricted local verifier capability, and a wake condition. The verifier should perform a harmless deterministic operation in a temporary directory, such as checking an explicit fixture's bytes. Inject a process interruption around dispatch and reconcile through a retained receipt. Then connect the same incident to a real agent without changing its underlying authority or storage contract.

The synthetic fixture establishes kernel behavior, not automatic research quality. Prompt selection and emergent coordination need later evaluation on actual user workloads with recorded cost, latency, correctness, and steering. Start with the cheapest method that meets the outcome; introduce additional agents only when there is useful independent work.

## Self use

After M1 through M3 work, use the native client during M4 to import the central implementation intent and record an actual remaining Moment defect or improvement. Retrieve its authorized context through Moment, implement the change in this repository, attach the real check result, and complete the incident through the admitted API. Restart between recording the intent and reporting the result. A manually edited database or canned fixture does not satisfy E15.

Use that experience to improve one demonstrated problem in continuation, command usability, policy explanation, or result handling. Preserve the same permissions and checks that apply to other consumers; Moment working on itself acquires no special authority to relax verification. E15 is required for the first implementation goal. Further improvements should address observed friction, not generate an indefinite list of tasks merely to keep the system active.

## Managed MCP upgrade

The [managed integration contract](../reference/managed-integration.md) specifies the next architecture. The upgrade is implemented on the completed M1–M4/E15 baseline. The gate evidence and tested scope are recorded in verification. Runnable goals are stored centrally, not in this repository. Real user installation is deferred and is not a prerequisite for completing the test-owned installer.

| Unit | Outcome and concrete owners | Dependencies | Required gates | State |
| --- | --- | --- | --- | --- |
| U1 Bindings and reliable results | Checked contract/schema generation, trusted handler registration, catalog provenance and deterministic discovery/instructions; correct the observed native-client post-commit ambiguity. Owners: contracts, validation, client, kernel method inventory and generation/check tasks. | Current baseline | G1, G4 | Implemented; generated provenance and equivalent public outcomes are exercised. |
| U2 Managed service | Shared on-demand startup, authenticated catalog/instance readiness, conservative ownership, private bounded logs and owner-only instance-bound stop. Owners: server, store claim, home discovery and service client. | U1 | G2, G4, G8 | Implemented; concurrent startup, owned stop/restart and conservative custody are exercised. |
| U3 Attachment and context | Authorized incident listing, central project/context selection and explicit bounded context packets using current rights. Owners: kernel, projects/home, credentials, awareness and managed adapter. | U1–U2 | G3, G4 | Implemented; actual authority, association, history and bounded packet cases are exercised. |
| U4 Agent and human surfaces | SDK stdio bridge, the default typed continuity tools, selective NDJSON `agents`, status/show/stop and shared outcome rendering. Owners: CLI, native client, bindings and MCP adapter. | U1–U3 | G1, G4, G6 | Implemented; complete SDK continuity workflow, equivalent CLI/native outcomes, framing and actual PTYs are exercised. |
| U5 Isolated integration qualification | Preview/apply/remove installer and actual Codex MCP context/observation, persisted restart/resume, reload and bounded child-agent propagation. Owners: isolated native connection/probes, installer and verification/dependency docs. | U1–U4 | G5, G7, G8 and combined regression checks | Implemented; 13 installer cases and actual native MCP parent/restart/resume/reload/child are exercised. Real installation remains deferred. |

Implement one connected U1–U4 path early, then complete the other advertised operations and negative cases before U5 qualification. The finite goal is not satisfied by a discovery catalog, MCP fixture or one happy-path tool call alone. Do not restart M1–M4, expand into M5 providers, or build a second scheduler, auth system, schema authority or coding harness.

| Gate | Authoritative completion evidence |
| --- | --- |
| G1 Contract and provenance | Deterministic catalog and generated-byte identities, exact input/output shape coverage, implemented handler/method agreement, collision and stale-generation rejection, and matching `agents`/MCP metadata. Declared-only methods never become callable. Current eligibility remains a separate policy result. |
| G2 Lifecycle | Real simultaneous managed clients converge on one ready service; bridge exit preserves shared work; actual daemon termination/restart preserves identities, pending wakes, receipts and unknown effects. Live/uncertain ownership, stale nonce, incompatible catalog/database and unowned socket fail conservatively. No inference during idle. |
| G3 Context and authority | Explicit/implicit association, ambiguity, empty/terminal incidents, confirmed move/clone cases and historical pages through actual client boundaries. Hidden alternatives are filtered before counts; wrong credential/principal claims, expired/revoked grants, cross-context routing, inaccessible detail and forged attachments cannot widen rights. No required touched-project metadata. |
| G4 Equivalent results and retries | The same admitted operations and refused inputs through CLI, native client and MCP produce the same domain outcomes. Cover strict framing, duplicate keys/UTF-8, stale revision, changed retry input, post-commit response loss/oversize, invalid replies, explicit cancellation and late completion. Preserve exact requests; verify durable readback/receipt identity and no repeated effect. |
| G5 Actual Codex MCP | Test-owned Codex instance/config/state/workspace/transport uses the pinned SDK bridge: discovers tools, attaches, retrieves actual selected context and submits an attributed schema-valid observation. After a real persisted turn, restart and resume the same native thread/incident; reload configured tools and verify a bounded native child can use the inherited Moment surface. Record actual version, schemas, protocol and observed result. No primary daemon/config/auth changes. |
| G6 Public UX | Executed status/show/help, empty/no-op, missing input, denial, partial/uncertain/interrupted outcomes and actionable detail/recovery guidance. JSON/NDJSON stdout is clean and follows declared schemas. Real PTYs cover changed progress/layout behavior, plain/redirected output and narrow widths; fast paths do not fabricate progress. |
| G7 Installer | Explicit temporary roots: preview has no config effects; apply/repeat/remove preserve unrelated bytes/comments, detect ownership conflicts and external edits, retain recovery state after interruption, and preserve all runtime data. Exercise the actual Codex configuration command path and exact emitted launcher. Real-home installation is neither run nor claimed. |
| G8 Resources and handoff | Bounded streams/logs/context/caches, no credential leakage, no leaked owned processes, and cleanup preserving unknown effects, active state and recovery inputs. Test recoverable and insufficient-evidence cases. Full checks run on the settled candidate; selected captures and explicit limitations stay central and the owning docs match shipped behavior. |

[Verification](verification.md) maps each gate to current execution evidence and limits. The actual SDK/native case supersedes the earlier fixture-only G5 probe. Tests distinguish unsupported native capabilities, host approval refusals, domain faults and unverified model claims.

## Purpose and guidance package

This is the single complete implementation/dependency and acceptance index for the proposed evolution. [Purpose](../reference/purpose.md), [guidance](../reference/guidance.md), and [work](../reference/work.md) own semantics; [evolution declarations](../../contracts/evolution.ts) own proposed APIs and [examples](../../contracts/evolution.examples.ts) exercise consumer types. The current kernel, 15-tool profile, qualified verifier, and isolated native connection remain the implemented baseline. A complete design package is not completion of P1–P10.

| Unit | Complete outcome | Dependencies | Acceptance | State |
| --- | --- | --- | --- | --- |
| P0 System contract | Coherent full purpose/guidance/work architecture, proposed typed APIs, examples, ownership, rollout, and full implementation directive. | M0–M4 basis. | Type/rejection examples, current binding identity unchanged, local links, combined existing regression. | Design package complete; static checks pass as recorded in verification. |
| P1 Semantic admission | Versioned schema bundle, purpose/criterion semantics, source/target/binding/fact/assessment/adoption validators, semantic checks shared by graph and transition paths. | M1/M2, P0. | C04–C05, C08–C09, C13, C29. | Proposed. |
| P2 Selected source adapters | Qualified artifact/conversation/record capture, privacy, ranges, exact bytes, source coverage, and incremental cursors. | P1. | C01–C03, C11, C27. | Proposed. |
| P3 Resolution and purpose evaluation | Deterministic applicable guidance with explanations, freshness, scoped coverage, conflicts, pagination, and finite/maintained evaluation. | P1/P2. | C07–C13. | Proposed. |
| P4 Shared delivery | Registered/validated APIs, conditional guided workspace reads, trusted composition, generated MCP/CLI/native discovery, and explicit old-policy upgrade. | P3. | C10, C12, C29, C32. | Proposed. |
| P5 Bounded native work | Atomic work/execution admission, source/budget/profile checks, durable Codex provider descriptors/receipts, observed usage, read/cancel/reconcile, owned test isolation. | M3/M4, P1/P2. | C14–C18, C28. | Proposed. |
| P6 Extraction and goal generalization | Manually triggered/incremental agent passes produce attributable candidates, meaningful generalizations, local refinements, and faithful future goal drafts. | P3/P5. | C01–C05, C14, C22, C30. | Proposed. |
| P7 Reconciliation and handoffs | Affected-source invalidation, coalesced/resting responses, guarded verified repairs, coordinated writers, and separately authorized native objective replacement. | P3/P5/P6. | C11, C19–C24, C28. | Proposed. |
| P8 Shared context and system exchange | Qualified source/local projections, current visibility/support, scoped independent adoption, exact capability matching, withdrawal/replay recovery, and two owned local-system exchange. | P1–P5. | C06, C25–C26, C28. | Proposed; local attributed copies are the baseline until live projection is qualified. |
| P9 Operational stewardship | Bounded provider capacity, artifacts/indexes/logs, storage growth measurements, protected retention, private credentials, restart/restore, and actionable refusal/unknown UX. | P2/P5/P7/P8. | C03, C16–C18, C25–C29, C32. | Proposed. |
| P10 Representative self use | Actual fresh-recipient discovery, bounded extraction/assessment/repair, faithful handoff, and measured useful learning across related and unrelated purposes. | P1–P9. | C30–C32 plus recorded use of the complete system. | Proposed. |

These are implementation dependencies, not enforced runtime phases. Deliver connected capabilities while retaining every mandatory outcome. The package's complete local system includes source capture, shared discovery, scope-safe adoption, bounded Codex work, reconciliation, goal generalization, controlled native handoff, and local-system exchange. A VM, graphical provider, paid API provider, remote network deployment, distribution license, or new service purchase remains conditional on an actual consumer and matching authority; their capability/refusal contracts are required even when the implementation is absent. M5 qualifies each selected additional provider separately.

### Concrete code and contract changes

| Boundary | Required change |
| --- | --- |
| `contracts/evolution.ts` → installed API | Integrate implemented method/type definitions into the authoritative installed declarations only with handlers, validators, policy actions, schemas, and generated availability. Keep unimplemented declarations visibly separate. |
| Semantic schema layer | Add versioned ordinary schema definitions and shared admission validation; prevent acceptance bypass through generic graph/transition paths. Reuse immutable records/assertions and current context transactions. |
| Source and provenance layer | Add qualified source adapters and range/cursor/capture validation. Candidate extraction consumes their bounded output, not arbitrary host paths or a whole conversation archive. |
| Guidance service | Add derived field indexes, authorized candidate discovery, applicability/freshness/supersession, conflict explanations, and purpose evaluation. No model invocation inside deterministic reads. |
| `runtime/managed.mjs` and `runtime/awareness.mjs` | Deliver the negotiated guided workspace packet and compose exact accepted instructions with quoted evidence. Preserve old input rejection, byte bounds, truthful scoped coverage, and current credential checks. Let the native agent select retrieval depth and judge readiness. |
| Execution/provider layer | Add atomic work definition/execution admission and a qualified native provider using existing state/lease/reconciliation. A native connection alone is not a dispatched worker. |
| Scheduler/reconciliation layer | Register new work destinations explicitly; observe qualified changes, coalesce affected subjects, rest without inference, and protect current source/writer ownership before effects. |
| Context/system exchange | Implement the missing local-reference/import projection boundary with current visibility and retained origin, independent local adoption, and authenticated peer replay/withdrawal behavior. |
| `runtime/operations.mjs`, input schemas, generator, and MCP/CLI | Derive all surfaces and profile availability from the same actually implemented definitions. Generate actionable upgrade/refusal guidance; do not silently widen existing policies. |
| Storage, operations, and tests | Retain exact retry/native descriptors, safe publication journals, input coverage, bounded caches, and proof of advertised isolation/accounting; exercise all cases below. |

Private module names can follow the existing runtime layout. This table fixes ownership/effects rather than prescribing helper files or introducing a parallel implementation roadmap.

### Complete acceptance

| ID | Case | Required observation |
| --- | --- | --- |
| C01 | Recover a decisive correction from actual user/agent items. | Exact selected user item and subsequent accepted direction survive; an assistant summary or forged role cannot establish the correction. |
| C02 | Repeat extraction and edit a source without changing its timestamp. | Exact equivalent work reuses its retained identity; changed bytes produce a distinct basis and cannot reuse stale interpretation. |
| C03 | Capture escaped, hidden, private, sensitive, and oversized sources. | Authorized bounded selection only; no symlink/root escape, secret leak, unrequested transcript, or fabricated complete coverage. |
| C04 | Candidate tries to activate itself through adoption, graph, and transition paths. | All paths enforce the same issuer/scope checks; candidate output and schema publication grant no authority. |
| C05 | Adopt an ordinary delegated refinement, then attempt scope expansion. | In-scope adoption works autonomously; widened project/incident/effect authority is refused without asking for repeated routine approvals. |
| C06 | Reuse a target across two contexts under different visibility. | Local projections retain exact origin and independent adoption; current kernel locality is not bypassed; forbidden/withdrawn source access is not revived by cache. |
| C07 | Resolve docs, UI, dependency, and ordinary-discussion tasks. | Only applicable guidance is selected with reasons. Discussion does not trigger cleanup; similar file names do not establish applicability. |
| C08 | A correction supersedes an older instruction in one scope. | New direction applies there, older applicable scopes remain, and unresolved semantic conflict stays explicit instead of timestamp-based precedence. |
| C09 | Facts are missing, ambiguous, stale, or supplied as caller hints. | Applicability becomes unknown where appropriate; hints cannot become trusted classification or kernel permission. |
| C10 | Read a metadata projection and a budget-limited body selection, including hidden and required guidance. | Metadata can be complete for its scope; a partial body selection succeeds with explicit visible omissions/recovery. Omission does not waive required guidance. No hidden counts or cursor leakage; incomplete discovery prevents full-coverage claims. Minimum-packet overflow remains an error; read success certifies neither agent readiness nor purpose completion. |
| C11 | Change source bytes, criterion, support, or exception validity. | Only relevant assessments become stale/unknown; history remains; unchanged valid evidence is reusable with its original scope. |
| C12 | Compose accepted instructions with malicious or oversized evidence. | Evidence remains quoted, template authority is current, required guidance is preserved/refused truthfully, and digest/basis identify the exact result. |
| C13 | Compare deterministic proof with qualitative judgment. | Each reports its method and actual coverage; passing links does not prove tone, nor does a model's agreement prove runtime behavior. |
| C14 | Native output has invalid JSON/schema, unresolved references, or unsupported conclusions. | Work fails or retains bounded candidates/uncertainty; it cannot manufacture an empty success or activate the proposed instruction. |
| C15 | Run actual bounded native work in an owned test environment. | Qualified app-server/profile/authentication and actual source/result readback; owner daemon, config, goals, threads, and writable auth remain untouched. |
| C16 | Lose native start/turn/completion acknowledgment. | Durable descriptors and actual native evidence reconcile the same attempt; otherwise unknown retains reservation and prevents duplicate dispatch. |
| C17 | Race cancellation, late completion, lease expiry, and authority loss. | Existing execution/attempt semantics remain accurate; no invented rollback or terminal result. |
| C18 | Exceed budget/profile or encounter unavailable measurement. | Actual supported limits are enforced/reported, unsupported guarantees refuse admission, missing usage is not zero, and recursive work cannot escape declared bounds. |
| C19 | Interleave changes under an ongoing consistency purpose. | Relevant events coalesce; finite jobs finish; the maintained purpose rests and wakes without model polling or repeated unchanged repair. |
| C20 | Another writer changes proposed artifact inputs. | Expected-old/source/ownership guards reject stale repair and preserve unrelated changes; a coordinated writer handles the updated basis. |
| C21 | Fail after some artifact effects but before graph/receipt completion. | Per-subject outcomes and journal permit reconciliation; no cross-system atomicity or rollback is invented. |
| C22 | Generalize a goal with completed, superseded, and unresolved material. | The full objective and real remaining gates survive; completed work and historical permissions are not reactivated or dropped. |
| C23 | Replace an obsolete native objective with the correct central intent. | Objective, thread, source basis, intended state, and actual activity are separately read back; merely resuming the old goal fails acceptance. |
| C24 | User edits a goal during handoff or clear/set is interrupted. | Unsupported compare-and-set yields prepared/conflict/unknown behavior; no unconditional overwrite or restoration over later owner work. |
| C25 | Replay an import, then replay history after withdrawal/revocation. | Exact receipts deduplicate, current local/source authority governs, origin remains, and old evidence cannot reinstate permission. |
| C26 | Negotiate a mismatched/unqualified process, VM, GUI, or peer capability. | Exact schema/platform/resource/receipt guarantees are checked; unsupported capabilities refuse or rest with an explanation. Isolation is claimed only for a qualified provider. |
| C27 | Pressure storage and rebuild indexes. | Required accepted/supporting/recovery evidence remains; regenerable indexes rebuild with truthful coverage; pressure defers work instead of deleting meaning. |
| C28 | Restart with pending work, stale imports, partial effects, and cached guidance. | Reconciliation precedes new effects, source/current-policy checks remain, and the same purpose/work identities survive. |
| C29 | New operations meet an old denying policy or expired delegate. | Actionable refusal and an admitted bounded upgrade path; no automatic owner fallback or permission expansion. |
| C30 | A fresh native recipient receives the earlier CAPTCHA testing correction and an unrelated task. | It identifies the obsolete prerequisite, the accepted isolated-testing boundary, remaining live proof, and useful next action; the unrelated task inherits none of that requirement. Use synthetic, source-faithful fixtures in Git. |
| C31 | Moment uses the complete system for a real change to itself. | Exact sources, guidance/adoption, assessment/work, actual implementation verification, restart, and next-goal carry-forward are retrieved through the API; output shows a useful result and measured cost/limitations. |
| C32 | Open a fresh clone and inspect CLI/MCP/native discovery. | No required personal markers/store for ordinary checks; installed availability, schemas, policy, compatibility, and human/machine outcomes agree. |

P0 requires static checks and review of the complete package. P1–P10 require the actual execution evidence above; these planned cases are not current passes. Integration tests use test-owned services and native instances. Retain representative before/after retrieval failures and useful coverage, not private raw sessions or a new permanent review diary. Completion of this package's implementation requires every mandatory unit and acceptance case; conditional providers remain explicitly unavailable until separately qualified.
