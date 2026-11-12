# Research precedents

These sources inform boundary choices. They do not establish Moment's runtime correctness, performance, or compatibility. The initial source review occurred on November 12, 2026; mutable product documentation must be rechecked when implementing an adapter.

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
