# Semantic model

This contract defines what the API's records mean. [API declarations](../../contracts/index.ts) own field names and types; [authority](authority.md) governs admissible interpretations and changes.

## Identity and atomicity

An atom is an addressable semantic unit at a selected perspective. It may carry a scalar, structured content, or a reference to further structure. Atomicity does not require physically indivisible storage or a globally minimal meaning. An incident presents a purpose and continuity boundary; it can participate as a unit in one context while exposing many participants through a more detailed perspective.

A `Ref` is `(systemId, contextId, id)`. IDs are lowercase UUID strings, generated independently of paths and content. Identity establishes addressability, not equivalence, truth, or permission. A record's digest identifies exact canonical content. Equal digests never combine authority or independent assertions.

`SemanticRecord` is either an immutable `Atom` or an immutable `Relation`. `record.put` with an existing ID and different content returns `IDENTITY_CONFLICT`; identical content is a no-op within the admitted transaction. A relation is addressable and has named roles containing references, allowing relationships with more than two participants. Its schema defines required roles and cardinalities. References can name semantic records or specialized control objects such as incidents and executions; resolution checks the target's type and permitted visibility.

Specialized control objects have stable IDs and revisioned snapshots. Their dedicated operations govern changes. They are semantic units at their public interface even though their implementation uses several storage rows. Generic graph writes cannot modify policy, grants, execution state, incident state, or other control objects. Exporting a historical control snapshot requires explicitly representing it as an attributed observation; its import never instantiates a local control object.

## Assertion and interpretation

An assertion records independently attributable support for a semantic record. Its author is the authenticated principal recorded by the service, and its evidence identifies sources and method. The immutable record can exist without current support. Withdrawal removes that assertion's current support without erasing the record or other sources' assertions. A record is currently asserted when at least one visible, applicable assertion supports it.

`validDuring` references an interval record. If its applicability is unresolved, rules requiring current validity evaluate to unknown. Withdrawal, contradictory evidence, and changed source revisions emit events. Dependent conclusions carry source references and become candidates for reevaluation; the system does not infer that every dependent claim is false. Acceptance, contradiction, and supersession are explicit relationships under their governing schemas.

An axiom is a premise accepted for a stated reasoning context. It is represented by an assertion and its acceptance basis, rather than a permanently privileged data type. Historical acceptance remains attributable when a later interpretation changes. Policy authority is a separate admission concern.

## Context and system

A system is one identity and execution boundary with its own store and admitted providers. A context selects an interpretation scope, active policy, resource envelope, and imported evidence. Context revisions serialize accepted local changes. There is no global revision across contexts or systems.

Context creation chooses an installed bootstrap profile; it cannot submit its own root authority. Parent relationships between contexts are ordinary typed relations unless an explicit policy attaches additional consequences. Sharing a context means participating in a specified interpretation and exchange scope; it does not imply shared credentials, equal visibility, or mutual mutation permission.

An incident starts `open`, may become `resting`, and can end `completed` or `cancelled`. Creating it in any other state is invalid. `incident.update` may change purpose, completion criteria, continuation references, or status with evidence. Completing requires evidence for the stated criteria under the active policy. Reopening a terminal incident requires `incident.reopen` authority in addition to update authority, with a reason in the evidence method. Rest preserves intent and wake conditions. User cancellation remains effective regardless of an agent's preference to continue.

## Structural relationships

The initial schema vocabulary distinguishes the following relations. Names are identifiers under the `moment` namespace; each definition is versioned and digest-bound through the schema registry.

| Schema name | Required roles | Meaning and invariant |
| --- | --- | --- |
| `moment.within` | `child`, `parent`, `perspective` | Structural containment in one perspective. Exactly one endpoint per role; no cycles or multiple immediate parents within that perspective. |
| `moment.partOf` | `part`, `whole`, `perspective` | Composition. Exactly one endpoint per role; a part can participate in several wholes. |
| `moment.viewOf` | `view`, `subject` | A view exposes aspects of a subject. One endpoint per role. |
| `moment.supports` | `evidence`, `claim` | One or more evidence endpoints support one claim; support is attributable, not automatic acceptance. |
| `moment.contradicts` | `left`, `right` | One endpoint per role; conflict under a declared interpretation, not automatic deletion. |
| `moment.equivalent` | `left`, `right`, `criterion` | One endpoint per role; equivalence under an exact comparison criterion. No permission union. |
| `moment.precedes` | `earlier`, `later` | One occurrence per role; strict order is acyclic within the same temporal frame. |
| `moment.during` | `inner`, `outer` | One interval per role; temporal containment, independent of structural parentage. |
| `moment.derivedFrom` | `result`, `source` | One result, one or more source references, retaining provenance. |

The `owner-local` bootstrap installs these nine schemas at version `1`, bound to the actual document digests. Installed relationship schemas accept relation records only. `moment.precedes` and `moment.during` additionally accept one optional `frame` endpoint; omission selects the current context as the temporal frame. Custom schemas may extend the vocabulary. They do not acquire built-in authority semantics by using similar labels. The reserved `moment.` namespace admits only exact installed definitions.

Containment and precedence invariants apply to the final asserted graph of an admitted change, after withdrawals and new support. A conflicting hypothesis can remain an unasserted immutable record. Multiple independent assertions of the same placement retain their provenance. Record declarations in a batch are available to all of its assertions and relation endpoints, regardless of declaration order; support commands execute in their supplied order. Replacing an accepted placement requires withdrawing all conflicting support in the same transaction. Old contexts can admit the exact installed schemas through operator `schema.publish`; opening a context does not silently rewrite its history.

## Perspectives

A view defines selection, visible fields, and optional grouping. Authorization filters records before projection and aggregation; counts, missing-field markers, and cursors must not expose hidden records. `Projection.complete` means complete for the authorized selection and snapshot, not complete knowledge of reality. Pagination sets it false until the final page.

`View.fields` contains JSON Pointers into a stored semantic record, such as `/value/value/summary`. Each projected record returns its exact reference and a `fields` dictionary keyed by the requested pointers; absent fields are omitted. An empty pointer explicitly selects the full stored record. The special `/support` field includes authorized assertion states in `Projection.support`; support is otherwise empty. Nested support pointers are unsupported. Grouping sorts by record ID or schema name and record ID using code-unit order. Schema grouping requires the schema name to be explicitly visible.

`Projection.version` hashes the visible page, view reference, authorized support, and completeness. It excludes global revision and cursor bytes. Hidden changes therefore leave the version unchanged unless a requested field exposes their effect. Cursors conceal snapshot metadata using authenticated encryption and fixed-size envelopes. These guarantees concern returned data; they do not promise timing side-channel isolation or conceal information available through separately authorized methods.

Different detailed transitions may project to the same visible state. This is expected. An investigation can observe an execution as a pending interaction and then a result while a host perspective exposes intermediate steps. Views do not independently mutate the underlying state. Field suppression never changes the authority required to access the remaining content.

## Time

Temporal relations express sequence, interval containment, overlap through custom schemas, and measured gaps. A duration record carries a value, unit, and measurement source; ordering alone cannot produce a metric duration. Time references are scoped to a temporal frame rather than one assumed global clock.

The API uses RFC 3339 UTC instants for deadlines and observations, integer milliseconds for delays, and local monotonically increasing event sequences for delivery. A sequence is not a physical duration or cross-system causal order. `causeIds` record declared event dependencies. `recordedAt` is server receipt time; `occurredAt` is an attributed observation and may be absent or uncertain.

Elapsed leases use a monotonic clock within one boot. Persisted wall deadlines and a boot identity support restart reconciliation; old monotonic readings cannot be compared across boots. Scheduling and side effects follow [reactions](reactions.md).
