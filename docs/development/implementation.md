# Implementation sequence and acceptance

The current deliverable is a checked contract baseline. Implementation should establish one useful persistent loop before adding provider breadth. This is the single work and dependency index; reference documents own behavior, and [verification](verification.md) owns executed evidence.

## Units

| Unit | Outcome | Dependencies | Required evidence | Current state |
| --- | --- | --- | --- | --- |
| M0 Contracts | Typed boundaries, coherent reference docs, reusable goal, and central saved intent. | *none* | Type examples, documentation links, method coverage, final diff review. | Complete; static checks recorded in verification. |
| M1 Store and identity | Open the central store, import bootstrap files, persist records and assertions, and recover after restart. | M0 | E1, E2, E3, E12. | Storage, discovery, bootstrap reader, kernel, authenticated socket, and typed native client implemented and tested. Saved-intent adoption through the public API remains for M4. |
| M2 Governed reactions | Evaluate bounded policy, delegate authority, propose changes, and commit one context transition. | M1 | E4, E5, E6, E7. | Semantic transitions, immutable rules, installed relation schemas, and permission-filtered views implemented and tested alongside delegated authority. Execution-intent admission belongs to M3. |
| M3 Scheduling and effects | Rest, wake, queue, lease, cancel, and reconcile one deterministic local test capability. | M2 | E8, E9, E10. | Capability negotiation, transactional queueing, reservations, fenced leases, cancellation, reconciliation, scoped durable events, and wake scheduling implemented. Real-daemon rest/wake, expiry, and restart cases pass. Actual verifier dispatch and retained provider receipts remain. |
| M4 Native agent connection | A small client exposes assigned incident context, bounded messages, and validated result submission to an existing coding agent. | M3 | E11 and a real end-to-end interaction with a pinned client version. | Unimplemented. |
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
