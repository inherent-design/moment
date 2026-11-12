# Implementation sequence and acceptance

The implementation establishes one useful persistent loop before adding provider breadth. This is the single work and dependency index; reference documents own behavior, and [verification](verification.md) owns executed evidence.

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

The [managed integration contract](../reference/managed-integration.md) specifies the next architecture. These units are proposed; the current runtime remains the completed M1–M4/E15 baseline. Runnable goals are stored centrally, not in this repository. Real user installation is deferred and is not a prerequisite for completing the test-owned installer.

| Unit | Outcome and concrete owners | Dependencies | Required gates | State |
| --- | --- | --- | --- | --- |
| U1 Bindings and reliable results | Checked contract/schema generation, trusted handler registration, catalog provenance and deterministic discovery/instructions; correct the observed native-client post-commit ambiguity. Owners: contracts, validation, client, kernel method inventory and generation/check tasks. | Current baseline | G1, G4 | Core implementation underway; see verification for executed checks and remaining gates. |
| U2 Managed service | Shared on-demand startup, authenticated catalog/instance readiness, conservative ownership, private bounded logs and owner-only instance-bound stop. Owners: server, store claim, home discovery and service client. | U1 | G2, G4, G8 | Core implementation underway; see verification for executed checks and remaining gates. |
| U3 Attachment and context | Authorized incident listing, central project/context selection and explicit bounded context packets using current rights. Owners: kernel, projects/home, credentials, awareness and managed adapter. | U1–U2 | G3, G4 | Proposed. |
| U4 Agent and human surfaces | SDK stdio bridge, the default typed continuity tools, selective NDJSON `agents`, status/show/stop and shared outcome rendering. Owners: CLI, native client, bindings and MCP adapter. | U1–U3 | G1, G4, G6 | Proposed. |
| U5 Isolated integration qualification | Preview/apply/remove installer and actual Codex MCP context/observation, persisted restart/resume, reload and bounded child-agent propagation. Owners: isolated native connection/probes, installer and verification/dependency docs. | U1–U4 | G5, G7, G8 and combined regression checks | Proposed; no real installation. |

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

The unauthenticated fixture probe in [verification](verification.md) is preliminary G5 evidence only. SDK negotiation, post-inference persisted resume, child propagation, installer recovery and the managed lifecycle still require implementation and actual execution. Tests must distinguish an unavailable native capability from a fabricated success or an unrelated failure.
