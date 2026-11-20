# Research precedents

These sources inform boundary choices. They do not establish Moment's runtime correctness, performance, or compatibility. The initial source review occurred on November 12, 2026; mutable product documentation must be rechecked when implementing an adapter.

The complete [purpose/guidance package](reference/purpose.md) additionally uses the primary precedents below, reviewed November 13, 2026. It retains Moment's local semantic graph and native-agent architecture rather than adopting a new runtime dependency from a conceptual precedent.

| Source | Relevant precedent | Boundary of applicability |
| --- | --- | --- |
| [W3C SHACL Recommendation](https://www.w3.org/TR/shacl/) | Separates targeted subjects, desired constraints, and validation results. | Borrow the separation; Moment's qualitative judgments and authority require their own evidence and do not become RDF conformance proofs. |
| [Kubernetes controllers](https://kubernetes.io/docs/concepts/architecture/controller/) | Observes current state, follows a desired condition, performs bounded reconciliation, and reports outcomes. | Supports maintained purposes/rest; it does not provide a universal project-health score or require Kubernetes to run Moment. |
| [Codex app-server](https://learn.chatgpt.com/docs/app-server) | Separate native threads, turns, structured per-turn output, events, and native goal state. | A qualified work provider and source/goal guards still need implementation against the installed version; protocol documentation is not actual worker or isolation evidence. |

The managed integration review additionally used the owner's empack UX/reporting goals and selected direct session steering. Source locations, short excerpts, and attribution classifications remain in the central specification incident. Their general lessons are outcome/reason/next-action presentation, truthful progress and checked scope, bounded interoperability work, direct structured communication, and everyday state recovery. Empack release permissions, domain workflows and forwarded agent claims do not become Moment authority.

| Source | Relevant precedent | Boundary of applicability |
| --- | --- | --- |
| [Jensen and Milner, Bigraphs and mobile processes](https://www.cl.cam.ac.uk/techreports/UCAM-CL-TR-570.html) | Separates locality/nesting from connectivity and defines reactive reconfiguration. | Moment borrows the distinction; it does not implement or claim the full bigraph formalism. |
| [Abadi and Lamport, The Existence of Refinement Mappings](https://www.microsoft.com/en-us/research/publication/the-existence-of-refinement-mappings/?lang=fr-ca) | Relates detailed state machines to more abstract specifications. | Perspective mappings need their own correctness argument; hiding fields alone does not prove refinement. |
| [Allen, An Interval-Based Representation of Temporal Knowledge](https://ijcai.org/proceedings/1981/46) | Represents relative temporal knowledge with uncertainty and variable scale. | Runtime timers additionally require measured clock behavior and restart rules. |
| [Google, Zanzibar](https://storage.googleapis.com/gweb-research2023-media/pubtools/pdf/10683a8987dbf0c6d4edcafb9b4f05cc9de5974a.pdf) | Combines relationship data, policy configuration, and consistent authorization. | Moment does not inherit Zanzibar's distributed implementation or performance. |
| [Biscuit specification](https://doc.biscuitsec.org/reference/specifications) | Supports restricted delegation through attenuation and contextual checks. | The initial local grant chain is not a Biscuit token implementation. |
| [Syndicated Actor Model](https://synit.org/book/syndicated-actor-model.html) | Uses assertions, interests, and change propagation for reactive interaction. | Equal-value assertion deduplication does not solve semantic equivalence or durable execution recovery. |
| [W3C PROV-DM](https://www.w3.org/TR/prov-dm/) | Describes derivation, responsibility, alternate aspects, specialization, and provenance bundles. | Provenance does not certify truth or permission. Moment uses a subset of the concepts without requiring RDF storage. |
| [Hellerstein and Alvaro, Keeping CALM](https://arxiv.org/abs/1901.01930) | Identifies when monotonic distributed computation permits coordination-free consistency. | It is a coordination diagnostic, not a requirement that beliefs never change. |
| [Codex app server](https://learn.chatgpt.com/docs/app-server) | Provides supported external thread, turn, and goal operations. | Adapter methods must be qualified against the installed version and available account capabilities. |
| [Using goals in Codex](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex) | Persistent objectives can reference detailed instructions in files. | Saving an intent file does not activate a goal or prove execution. |

The existing simulacrum, arch0n, and atlas projects supplied experiential context in the preceding review. Their implementation is not imported into this repository, and their capabilities are not prerequisites. Reuse requires a targeted source and compatibility review at the point of implementation.

## Managed protocol sources

| Source | Design evidence | Limit |
| --- | --- | --- |
| [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) | Local stdio registration and server instructions. | Configuration is not proof of a live tool connection. |
| [Codex app-server](https://learn.chatgpt.com/docs/app-server) | MCP status/tool-call/reload methods and thread operations. | The installed schema and actual isolated calls qualify compatibility; an empty thread is not a persisted conversation. |
| [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) | Parent MCP/permission inheritance. | Runtime child propagation and attribution need their own checks. |
| [MCP 2025-06-18 tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools) | Structured object results and text fallback for the observed Codex opening. | It does not establish permissions or service readiness. |
| [SDK 2.4.0 legacy clients](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/docs/serving/legacy-clients.md) | One server factory can serve negotiated older stdio clients. | The selected SDK still needs execution checks against the installed Codex client. |
| [SDK 2.4.0 release](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.4.0) | Versioned dependency target and upgrade notes. | A release note is not Moment conformance evidence. |

## Memory and task continuity

These precedents inform the [planned memory continuity design](development/memory-continuity.md). Publisher descriptions establish design possibilities, not comparative quality on this host. The private research capture retains inspected excerpts, source identities and the independently verified code manifest; implementation must preserve its own reproducible evidence.

| Source | Applicable mechanism | Boundary |
| --- | --- | --- |
| [Augment Context Connectors](https://docs.augmentcode.com/context-services/context-connectors/how-it-works), [pinned source](https://github.com/augmentcode/context-connectors/tree/f7d6472ae626c98fd768f64cdfd6160145eefa77) | Incremental indexing, unchanged-state reuse and compact search exports separate maintenance from retrieval. | The inspected connector is not the proprietary context engine; local MCP access does not establish a self-hosted retrieval backend. |
| [Augment Cosmos memory](https://docs.augmentcode.com/cosmos/experts-memory), [review memory](https://docs.augmentcode.com/cosmos/experts-code-review-memory) | Scoped, curated persistent material can be loaded for relevant work instead of replaying a full evidence log. | Curated relevance still needs source attribution, freshness and actual-use evaluation. |
| [Harness chat memory](https://developer.harness.io/harness-ai/use-harness-ai/context-and-memory/memory-chat-history.md), [knowledge graph](https://developer.harness.io/harness-platform/use-harness-platform/knowledge-graph/overview) | Conversational memory and a typed operational graph answer different questions. | Product descriptions do not prove automatic cross-project applicability or Moment-equivalent authority. |
| [OpenAI Symphony, pinned specification](https://github.com/openai/symphony/blob/be10a1b79df723d6d7612b5651c8522704dafb2e/SPEC.md) | Persistent workspaces and bounded continuation within an issue-oriented session preserve operational progress. | The inspected implementation reuses its app session across turns; it does not provide a general task-memory selector. |
| [Letta MemFS](https://docs.letta.com/concepts/memfs/index.md) | A small visible root with deeper, versioned memory supports selective retrieval. | A useful index does not demonstrate that every relevant original was retained or inspected. |
| [Anthropic memory components](https://www.anthropic.com/research/components-of-agent-memory), [context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) | Separate transcript, maintained notes, organized memory and a small injected index; evaluate maintenance as well as retrieval. | Vendor observations are not local quality results. More instructions or a larger maintained wiki can increase noise. |
| [OpenAI harness engineering](https://openai.com/index/harness-engineering/) | A short instruction map, repository-owned truth and executable constraints support durable navigation. | Team-specific workflow and merge practices are not universal policy for Moment. |

The pinned Symphony and connector files were compared with their Git blob identities and independently hashed. No third-party program was executed and no proprietary retrieval behavior was reverse engineered. The resulting working-set, assessment-history and presentation choices are Moment design decisions to test, not capabilities inherited from those projects. None of these sources establishes a reliable temporary-versus-permanent task-switch classifier.
