# Documentation map

Moment's implementation target is a local kernel whose reactions can be explained, bounded, resumed, and viewed at different semantic levels. The following documents own distinct parts of that contract.

| Need | Owner |
| --- | --- |
| Product purpose and constraints | [Direction](direction.md) |
| Complete purpose, consistency, adaptation, and system boundaries | [Purpose](reference/purpose.md) |
| Source capture, reusable guidance, adoption, discovery, and composition | [Guidance](reference/guidance.md) |
| Bounded agent work, providers, reconciliation, and native goal handoffs | [Work](reference/work.md) |
| Atoms, incidents, relationships, contexts, perspectives, and time | [Model](reference/model.md) |
| Authority, delegation, generated policy, and verification | [Authority](reference/authority.md) |
| Executable definitions, representations and scoped proofs | [Semantics](reference/semantics.md) |
| Reactions, scheduling, resources, and execution recovery | [Reactions](reference/reactions.md) |
| Callable API, errors, transport, and concurrency | [Protocol](reference/protocol.md) |
| Hosts, agents, prompts, messaging, and other systems | [Integration](reference/integration.md) |
| Managed MCP, shared bindings, attachment, lifecycle, installer contract and human commands | [Managed integration](reference/managed-integration.md) |
| Capture dispositions, bounded minimization and operator custody | [Capture preservation](reference/captures.md) |
| Personal store, repository identity, and retention | [Storage](reference/storage.md) |
| Exact programmatic boundary shapes | [API declarations](../contracts/index.ts) |
| Complete proposed evolution API, separate from installed methods | [Evolution declarations](../contracts/evolution.ts) |
| Compile-only consumers and rejection examples for the evolution | [Evolution examples](../contracts/evolution.examples.ts) |
| Typed usage and rejection examples | [Contract examples](../contracts/examples.ts) |
| Work sequence and acceptance scenarios | [Implementation](development/implementation.md) |
| Assessment history, reversible working sets and connected rollout | [Memory continuity design](development/memory-continuity.md) |
| Provisional full implementation directive (reference only) | [Implementation goal](development/implementation-goal.md) |
| Design rationale and unsettled choices | [Decisions](development/decisions.md) |
| Actual checks and limitations | [Verification](development/verification.md) |
| Public package qualification and release | [Releasing](development/releasing.md) |
| Dependency and patch maintenance | [Dependencies](development/dependencies.md) |
| Contribution and private vulnerability reporting | [Contributing](../CONTRIBUTING.md), [security](../SECURITY.md) |
| Documentation ownership and cleanup | [Documentation maintenance](development/documentation.md) |
| Research precedents and applicability | [Research](research.md) |

The binding catalog distinguishes implemented operations from declared surfaces. The separate evolution declarations remain proposals. Owner-established direction, engineering defaults, implemented behavior and verified evidence are different statuses; use their owning documents and actual discovery results.
