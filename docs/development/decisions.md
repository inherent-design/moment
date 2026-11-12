# Decisions and open boundaries

This record distinguishes owner-established direction from selected engineering defaults. Defaults may be revised with evidence and coordinated contract changes; they are not claims of owner review or implemented behavior.

| ID | Status | Decision and reason | Consequence |
| --- | --- | --- | --- |
| D1 | Owner direction | Name the project Moment and keep the framework independent of a particular workflow. | Model semantic units and relationships before project-specific task types. |
| D2 | Owner direction | Use one central user store with a shallow home-directory entry point. | `~/.moment` exposes the backing store; touched projects need no Moment metadata. |
| D3 | Owner direction | Support autonomous development and agent-generated policy under current authority. | Routine engineering and in-scope policy activation need no mandatory human gate. |
| D4 | Owner direction | Treat atomicity as perspective-relative and time as relational as well as measurable. | Internal steps can remain invisible in an outer view; temporal containment does not imply structural containment. |
| D5 | Selected default | Use immutable semantic records, independent assertions, and revisioned control state. | Deduplication preserves origins and permissions; lifecycle changes stay governed. |
| D6 | Selected default | Use one local writer, SQLite, context revisions, and an atomic outbox. | Straightforward local recovery; coarse revision conflicts and no cross-system atomicity promise. |
| D7 | Selected default | Express API shapes in TypeScript and use JSON-RPC over a local socket. | Concrete implementation handoff without selecting the runtime language or creating multiple schema authorities. Runtime JSON validation remains required work. |
| D8 | Selected default | Use a bounded declarative policy and reaction language. | Policy evaluation is deterministic; arbitrary programs live behind admitted execution capabilities. |
| D9 | Selected default | Use explicit capability matching and authenticated peer imports. | Advertisements and imported evidence do not acquire local authority automatically. |
| D10 | Selected default | Keep the repository private and select no distribution license yet. | No public publication or package release is implied by repository creation. |
| D11 | Owner direction | Make the next integration MCP-first, with automatic shared-service discovery/startup and central work attachment. | Native tool availability replaces routine manual CLI setup; the kernel remains the authority for domain effects. |
| D12 | Selected default | Keep a versioned binding catalog inside Moment and derive MCP, selective agents discovery and relevant guidance from checked contracts and source. | Generation detects drift; it does not infer permission or replace runtime admission and execution evidence. |
| D13 | Selected default | Deliver on-demand service management and explicit instance-bound stop on the current Unix host; keep login-service registration separate. | Multiple bridges share one writer. Persisted wakes resume after restart, without promising execution while the host/service is stopped. |
| D14 | Selected default | Use explicit routing references and existing owner/delegate credentials for attachment. | No mutable global current incident, inferred actor identity, or authority from a caller label. Automatic distinct per-agent credential provisioning remains separate work. |
| D15 | Owner direction | Defer actual installation. Build and test preview/apply/remove only against explicit test-owned Codex and Moment roots. | The upgrade can finish with a verified installer; primary Codex configuration, startup services and writable auth/session/refresh state remain untouched. |
| D16 | Owner direction | Keep runnable goals solely under the central store and apply empack's outcome/reason/next-action guidance to human output. | Repository documents own specifications, while goals/checkpoints remain personal; structured and human views share facts without identical wording. |

## Open choices

| ID | Boundary | Current treatment | Evidence needed before expansion |
| --- | --- | --- | --- |
| Q2 | Fine-grained concurrency | Context-wide optimistic guard is the default. | Measured contention showing it obstructs real work, plus read-set and policy consistency tests. |
| Q3 | Provider isolation | No default claim of process, container, or VM isolation. | A real consumer and tests of the selected host boundary. |
| Q4 | Automatic prompt and topology selection | Deterministic conditions first; learned proposals remain candidates. | Representative workload outcomes, resource use, and counterexamples to the proposed policy. |
| Q5 | Publication and licensing | Private, unlicensed development. | Owner distribution decision before public release. |

These choices do not block the contract baseline. Resolve implementation choices when their unit needs them; do not ask the owner to supply an entire architecture in advance.
