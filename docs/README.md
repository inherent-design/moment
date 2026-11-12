# Documentation map

Moment's implementation target is a local kernel whose reactions can be explained, bounded, resumed, and viewed at different semantic levels. The following documents own distinct parts of that contract.

| Need | Owner |
| --- | --- |
| Product purpose and constraints | [Direction](direction.md) |
| Atoms, incidents, relationships, contexts, perspectives, and time | [Model](reference/model.md) |
| Authority, delegation, generated policy, and verification | [Authority](reference/authority.md) |
| Reactions, scheduling, resources, and execution recovery | [Reactions](reference/reactions.md) |
| Callable API, errors, transport, and concurrency | [Protocol](reference/protocol.md) |
| Hosts, agents, prompts, messaging, and other systems | [Integration](reference/integration.md) |
| Managed MCP, shared bindings, attachment, lifecycle, installer contract and human commands | [Managed integration](reference/managed-integration.md) |
| Personal store, repository identity, and retention | [Storage](reference/storage.md) |
| Exact programmatic boundary shapes | [API declarations](../contracts/index.ts) |
| Typed usage and rejection examples | [Contract examples](../contracts/examples.ts) |
| Work sequence and acceptance scenarios | [Implementation](development/implementation.md) |
| Earlier baseline goal template (reference only) | [Implementation goal](development/implementation-goal.md) |
| Design rationale and unsettled choices | [Decisions](development/decisions.md) |
| Actual checks and limitations | [Verification](development/verification.md) |
| Dependency and patch maintenance | [Dependencies](development/dependencies.md) |
| Documentation ownership and cleanup | [Documentation maintenance](development/documentation.md) |
| Research precedents and applicability | [Research](research.md) |

The `0.1` contract is a development proposal. Owner-established direction, agent-selected engineering defaults, implemented behavior, and verified evidence are different statuses. The decision record identifies the first two; implementation and verification records identify the latter two.
