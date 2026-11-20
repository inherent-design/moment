# Guidance capture, adoption, and resolution

This document owns the implemented source-backed candidate service and the separate proposed normative guidance layer. [Purpose](purpose.md) owns the system meaning; [evolution declarations](../../contracts/evolution.ts) own fields; [work](work.md) owns effects, workers, and recovery. The normative operations under Public operation contract remain unimplemented until their acceptance units pass. The installed generic graph and prompt operations retain their existing contracts.

## Source-backed candidate service

The implemented candidate service connects canonical sources to a task-specific native handoff. It supplies quoted evidence and model interpretations. It does not adopt instructions, write/activate native goals, create compulsory workflows or implement the separate normative package below. Native agents decide relevance and retrieval depth using their broader conversation and tools.

| Operation | Behavior |
| --- | --- |
| `guidance.register` | Operator-controlled source definition and location associations; revisioned update or withdrawal. |
| `guidance.refresh` | Explicit capture through configured host read access or an authorized semantic record. |
| `guidance.review` | One bounded assessment from ready observations, using existing execution authority and reservations. |
| `guidance.read` | Inert discovery/detail by location, source IDs, capture IDs or execution ID. |

Register sources once and refresh them when a meaningful handoff needs current observations. Discover within the attached context. A location filter names the task’s project or worktree, which can differ from Codex’s launch folder; omit it for context-wide registry discovery. Source locations and context registrations are deliberate associations, not automatic cross-project inheritance or instruction adoption. The model receives the stated task, its selected basis and exact captured sources. A user need not repeat the guidance or know its record IDs: location selects registered candidates. Source population is deliberate; this is not a history crawler or automatic file importer. Unrelated tasks can use none of the candidates. Ordinary conversation need not assess at all.

The initial adapters accept normalized absolute canonical files and existing semantic records in the same context. File access additionally requires a configured canonical root. A registered locator grants no filesystem access; paths resolving differently, inaccessible files, source races, oversize representations and unsupported selections retain explicit observation states. Register a canonical real path rather than silently following an alias that can change owners. Record capture uses canonical JSON of the semantic record envelope; a JSON-pointer string selection is explicitly decoded text, and a non-string selection is canonical JSON. Whole, one-based inclusive lines, UTF-8 byte ranges and JSON-pointer selections share the owning `SourceCapture` type in `contracts/index.ts`. Byte ranges cannot split a UTF-8 character. Line selection preserves the original selected line endings, including a selected final empty line. Registration evidence need not predict the selected-content digest: refresh supplies `capture.contentDigest` for the selected bytes and `wholeDigest` for the original representation. Joining or trimming lines produces different bytes and must not be checked under the original selection digest.

A source retains its last valid capture when a later refresh fails; that body is labeled historical. A capture retains whole/selected digests, the selection and transformation, original location/record revision, observation time and evidence. Unchanged whole/selected content reuses its capture identity; a source's latest observation time is separate. A changed whole source creates a new capture even if its excerpt stays equal. Large bodies live once in private content-addressed component storage. The digest is an integrity claim, not a read credential. Raw model receipts remain unchanged. No public artifact-upload API is implied.

`guidance.read` defaults to 16 KiB and permits up to 256 KiB; `limit` bounds source metadata and `nextCursor` continues discovery with current authority; selected IDs avoid unrelated material. Capture/result reads can use `sourceIds: []` to omit the registry. `representation: "whole"` recovers the original whole representation; `bodyRange` selects a bounded UTF-8 range when one body does not fit. Omissions name their reason and recovery. Service byte bounds do not describe an LLM's context window. A successful partial read, source freshness, applicability, readiness and completed purpose remain separate claims. Reads never refresh the host or invoke inference. `current-observation` identifies the latest retained observation; it is not a new filesystem freshness check. Refresh an already registered source explicitly when a meaningful handoff depends on a changed canonical file; earlier captures remain attributable history.

Assessment accepts at most 32 registered captures and 131072 selected evidence bytes, with an additional composed-dispatch bound. Choose meaningful registered excerpts or fewer sources when needed. These are transparent service defaults. They do not ask a cheap model to replace the native agent's broader intelligence or context. Task statements retain their premises; independent verification is distinct. Missing reproduction evidence in a guidance-only collection is a coverage limit, not a contradiction of a user-stated confirmed defect.

Each candidate separates interpretation, scope, reason and proposed quotations. One mixed source can support several distinct candidates; source identity does not define semantic atomicity. Source projection returns exact UTF-8 offsets into the captured selected representation. A unique initial-letter case difference is labeled `editorial-initial` and renders the exact original. Ambiguous occurrences stay ambiguous; stitched, materially changed or absent quotes remain unanchored. Matching quote bytes does not verify an interpretation or authorize an effect.

Result freshness means agreement with the latest explicit source observations, task basis and policy, never a new host check during read. Changes during inference produce a stale historical result rather than a rebased current claim. Withdrawal excludes new observations/assessments while retaining authorized history. Current source/evidence/grant access is checked again on reads, cached results, execution detail and exact retry. Two authorized collaborators can share the same work. Native agent labels sharing a credential honestly share attribution.

At a meaningful goal change or handoff, a native consumer reads applicable candidates, refreshes selected sources when needed and optionally requests an assessment. `guidance.read` can return a candidate capability, grants and per-job envelope; request still rechecks task/source access, current policy and capacity. The native writer chooses guidance, retains the actual basis with the central intent/handoff and verifies retrieval. Discoverable, read, selected, declared used and verified outcome are different evidence states. Saved readiness does not invoke `/goal`, and native goal activation does not complete the underlying purpose.

### Operator setup

Enable capture roots and the qualified provider in the private `runtime/guidance.json`:

```json
{
  "formatVersion": 1,
  "enabled": true,
  "fileRoots": ["/absolute/canonical/project"],
  "provider": {
    "kind": "codex",
    "credentialFile": "/absolute/private/access-session.json",
    "model": "gpt-6-luna",
    "binary": "/absolute/installed/codex"
  }
}
```

The provider uses only a selected ephemeral access-token session; refresh and primary auth writes remain with the owning host. Keep this file private and outside Git. Without a provider, registered source reads/capture remain useful. Without allowed roots, registration does not enable host capture. Configuration errors retain an explicit unavailable component rather than resetting it.

For compatibility discovery alone, use `moment guidance setup --context CONTEXT --read-only`: it adds only owner `guidance.read` if absent and preserves all other predicates, denies, ceilings and delegates. It adds no registration/refresh/review action, capability or execution grant. Use `moment guidance setup --context CONTEXT --actions-only` to admit precise owner actions while retaining the current ceiling. Use `context.limits` with current revision, retry key and nonempty evidence to revise an existing ceiling. This is local accounting, not OpenAI quota. Raising it does not widen the active policy or any grant. Full `moment guidance setup --context CONTEXT [--refs FILE]` explicitly admits the profile at that ceiling and returns a new bounded grant/capability. `--refs` supplies additional task-basis references; new/changed source dependencies require newly admitted grant coverage. No setup command refreshes, invokes a model or changes goals.

The current per-job defaults are one execution, 32768 model tokens, 30000 CPU milliseconds, 256 MiB peak memory, 64 KiB output and zero API spend. They are accounting reservations; the native provider does not enforce OS CPU/memory or subscription quotas. Actual token counts and output bytes are retained. Unmeasured CPU/peak memory and missing token accounting remain explicit. Cumulative unmeasured resources retain their reservation after a known outcome; peak memory is released when the owned native process is settled. An observed overrun is recorded and blocks further dispatch rather than being discarded.

Requests need both `guidance.review`/`execution.request` and the installed capability action, current source/task scope, a grant and capacity. Local operator setup does not make another principal an operator. Cancellation/reconciliation use `execution.cancel` and `execution.reconcile`; Moment retains the exact execution, dispatch/profile basis, native IDs and raw receipt. Memory and guidance share one durable native-labor slot. Unknown dispatch holds that slot across restart until attributable evidence settles it; neither a timeout nor a release label authorizes replay. Guidance failure leaves registered evidence and prior results readable.

## Records and boundaries

The package admits version `1` schemas for the following ordinary atom payloads. Record IDs, schemas, independent assertions, and context revisions retain the existing [model](model.md). Publication of a schema does not activate its contents as instructions.

| Schema | Payload | Owner of its meaning |
| --- | --- | --- |
| `guidance.source` | `SourceCapture` | Exact selected content and qualified origin. |
| `guidance.fact` | `GuidanceFact` | A named observed/interpreted input, exact basis, and assessment evidence. |
| `guidance.purpose` | `PurposeDefinition` | Objective, scope, and accepted closure/maintenance criteria. |
| `guidance.target` | `ConsistencyTarget` | Reusable desired relationship and assessment criterion. |
| `guidance.binding` | `GuidanceBinding` | Target realization, named subject roles, and local interpretation. |
| `guidance.procedure` | `GuidanceProcedure` | Exact capability, schemas, trusted template, applicability, and effect class. |
| `guidance.assessment` | `GuidanceAssessment` | Observation against exact criterion and input basis. |
| `guidance.exception` | `GuidanceException` | Scoped reason and its explicit ending condition. |
| `guidance.adoption` | `GuidanceAdoption` | Currently supported scoped acceptance under existing authority. |
| `guidance.packet` | `GuidancePacket` | Retained immutable derived guidance with exact input/policy/catalog basis. |
| `guidance.worker-profile` | `WorkerProfile` | Qualified execution composition and bounded native turn behavior. |
| `guidance.work` | `WorkDefinition` | One immutable work definition tied to an existing execution. |
| `guidance.repair` | `RepairProposal` | Proposed artifact/graph changes, input guards, and verification. |
| `guidance.goal-draft` | `GoalDraft` | Reusable complete objective and explicit carry/discharge/supersession. |
| `guidance.goal-handoff` | `NativeGoalHandoff` | A guarded operator/native-host replacement request. |
| `guidance.goal-receipt` | `NativeGoalReceipt` | Observed handoff outcome, including conflict or uncertainty. |

`Basis` is an input vector: exact stored record references/digests/revisions and selected source content digests. It does not create a global snapshot across contexts, lock files, or establish provider freshness. Each record and capture must resolve with actual current authority. A stored Moment revision identifies an admitted store change, not a Git revision or tested artifact.

All payloads must pass strict runtime JSON/schema and semantic validation. Proposed bounds are 256 KiB per payload, at most 64 source references per record, 128 criterion bindings per purpose, 32 named binding roles, and 256 total role endpoints. Scope arrays and task reference arrays are bounded at 128 entries each. Unknown fields, duplicate keys, invalid scalar values, escaping locators, unknown schema versions, and unresolved required references are refused. Larger purposes compose sub-purposes/views instead of silently truncating. These are selected defaults for implementation qualification, not current runtime guarantees.

Typed references inside payloads have one canonical owner. Derived indexes may follow them for discovery, with access filtering before projection/counting. They do not change `graph.query`'s existing relation-only adjacency semantics or create competing editable edge copies. Explicit accepted derivation, support, contradiction, and criterion-bound equivalence use the installed relation schemas. A custom `guidance.refines` relation has `specific` and `general` roles, one endpoint each, and must be acyclic among currently accepted refinements. It is provenance for a proposed specialization, not proof of logical implication or delegated permission. Supersession comes from the scoped adoption record, not timestamp order.

## Source capture

Line selections are one-based and inclusive, preserve selected raw line endings, and require `first <= last`. JSON Pointer selection uses canonical JSON bytes of the selected value, with the original parsed source identity retained as derivation evidence; it cannot claim to be an unchanged raw byte slice. Locator and selection semantics are part of the qualified adapter version.

A capture identifies an artifact, actual conversation item, existing record, or retrieved web source. It retains the exact selection, bytes digest, media type, observation time, classification, and evidence of origin. Inline text hashes its exact UTF-8 bytes; binary or larger content uses a bounded artifact reference. A transformed/redacted excerpt is a separate capture with its own digest and attributable derivation. It must not retain the original hash as though the bytes were unchanged.

The host/source adapter checks authorized roots, project/worktree identity, symlinks, selected ranges, accessible conversation items, and private-data handling before content reaches a model. A URL or path supplied by an agent is a requested locator, not access authority. Credentials, decrypted secrets, browser sessions, raw authenticated responses, and unrelated private messages remain outside ordinary captures. Classification is metadata rather than an access grant; `unknown` does not qualify content for a worker profile that requires known-safe input.

Conversation capture uses the actual selected user/assistant/tool items and stable native identifiers through a qualified reader. An agent summary or a thread reader that omits user messages cannot establish an owner's correction. Preserve actual edits, supersession, and source selection coverage. Record `role: user` only when the adapter observed that role; it still does not prove applicability to another project. Compaction, thread branching, or archive relocation cannot silently replace the source basis.

A recorded conversation role is distinct from human authorship. Native goal reminders, recovery notices and control notices can have `role: user` while their available provenance identifies the harness and `client_authored: false`. Retain that source evidence and classify its meaning rather than counting the text as a personal preference or fresh owner approval. A control notice can establish an observed action without establishing that its wording was authored by the owner. Missing authorship evidence remains unknown. Current host instructions keep their native authority; a persisted historical notice remains quoted evidence in Moment.

Qualify readers against actual native item representations and the adapter version. The observed rollouts contain both `function_call` and free-form `custom_tool_call` items; omitting a representation leaves a coverage gap. Pair invocations with actual results when claiming admission. Static invocation expressions identify candidate call sites; missing or unparsed results leave their outcomes unknown.

Incremental passes keep per-source cursors plus content identity. A changed item/file with the same timestamp must be detected. An unavailable source, a gap in history, or a partial scan remains explicit coverage uncertainty. Ingestion has named sources, ranges, byte bounds, and a retention policy; there is no automatic whole-host or whole-account crawl.

## Extraction and consolidation

Extraction is an admitted finite work request, not a hidden side effect of a read. Its output is `ExtractionOutput`: candidates with source references, interpretation class, possible duplicate/refinement/conflict matches, unresolved questions, and consumed source coverage. Candidate status is always `candidate`. Suggested record IDs must resolve or refer to the same admitted candidate batch; invented references cannot become evidence.

The worker separates explicit direction, inferred preference, engineering proposal, task-specific instruction, and a superseded instruction. It retains conditions, exceptions, and material permissions. Repeated phrasing can suggest a reusable target; it cannot establish semantic equivalence. Similarity search, if later useful, proposes candidates and never merges authority, independent support, source scope, or acceptance.

Consolidation proposes a common premise, retained local realizations, and explicit relationships. It preserves concrete consumers and closure checks rather than replacing every instruction with an empty rule such as "be consistent." The result must explain the common meaning, where it applies, useful differences, excluded contexts, and source changes that would require reevaluation. Tone, component extraction, and dependency procedures remain separate realizations when their semantics differ.

Schema validation proves output shape. Evidence resolution proves addressability and permitted access. Neither proves that the inferred meaning is correct. Acceptance uses direct source review, discriminating checks, or a qualified judgment appropriate to the candidate. Agent agreement is not independent evidence.

## Adoption, exception, and supersession

`guidance.adopt` admits a new adoption record and attributable support under one context revision/retry identity. Its subject references must already be admitted or belong to an explicitly atomic graph/transition batch. It verifies input basis, structural scope, exact source/delegation basis, issuer authority, exception/supersession validity, and policy limits. It grants no execution rights. A semantically equivalent graph or transition write must run the same validation; handler choice is not an alternate trust path.

Explicit direction requires verified origin and applicable scope. A delegated default references the existing delegation and cannot exceed it. Existing host/user instructions remain authoritative. Normal in-scope engineering defaults can be adopted without another human interaction. Broadening scope, removing an owner gate, or replacing a consequential unresolved product decision requires the applicable authority; source repetition or an extraction confidence score cannot supply it.

The adoption's structural scope must fit the admitted delegation. Each referenced exception has the same or narrower effective scope than its binding. An exception ends at its instant, upon its condition, or through explicit supersession. An expired/unknown condition cannot silently waive a required criterion. Undecidable prose refinement is not a permission-subset proof.

`supersedes` names prior adoptions and applies only in the new adoption's effective scope. The previous immutable records and independent assertions remain. Supersession cycles and two irreconcilable current interpretations produce conflict, never "last writer wins." A project refinement can add local detail without weakening its shared target. An authorized change can deliberately replace that target; record it as replacement, not as a logically equivalent refinement.

## Resolution

`TaskFacts.intent` names the currently accepted purpose definition; its canonical intent text is identified through that definition's sources. Other task facts are selected explicitly or derived from a qualified current observation under admitted associations. `purpose.evaluate` accepts explicit fact references and inspects its purpose's full accepted criterion scope; missing applicability facts remain unknown. It cannot infer a whole-purpose result from one narrow task description.

A binding declares its default required/advisory obligation. A purpose can require an advisory binding explicitly. An effective requirement remains required when either the current binding or purpose requires it; reducing it needs a current scoped exception or authorized replacement. A new required binding is an acceptance change and must be admitted within existing delegation, not inserted as an unreviewed hidden completion gate.

`guidance.resolve` is a bounded, read-only deterministic operation over the selected authorized snapshot vector, task references, admitted facts, and one clock observation. It invokes no model, captures no new file, changes no policy, and dispatches no work.

1. Validate the attachment target and current credential. Resolve explicit purpose/project/incident/subject associations. Preserve ambiguity instead of silently selecting a nearby repository.
2. Read accepted bindings from explicit project/context associations and qualified imported projections. Check current support, adoption authority, scope membership, exceptions, and supersession. A schema-compatible but unadopted candidate remains evidence only.
3. Materialize authorized task facts and subject roles from selected source observations. `TaskFacts.description` is a retrieval hint. It cannot become a trusted classification or authorization binding by being supplied in the request.
4. Evaluate both target and binding applicability with the existing three-valued `Condition` language under a documented guidance binding namespace. Initially support `guidance.projectId`, `guidance.incidentId`, `guidance.purposeKind`, `guidance.task.concern`, and admitted graph `exists`/`related` queries. The concern value comes from a selected fact and its acceptance basis, not keyword inference. Missing, conflicting, stale, or unauthorized facts yield unknown. No arbitrary evaluation code is admitted.
5. Select required/advisory obligations, authorized instructions/procedures, and relevant assessment freshness. Return false exclusions, unknowns, supersession, conflicts, and selection explanations as `GuidanceDecision` entries. Missing applicability evidence can justify a separate investigation; it does not automatically apply every rule.
6. Form the bounded packet with exact basis, current policy and catalog provenance, source coverage, omissions, clock observation, and digest. Counts, cursor metadata, timing claims, and reasons must not expose inaccessible material. Explicit inaccessible required dependencies fail with the existing generic access failure.

The first four guidance bindings are scalar when associations are unique. Multiple projects/concerns are represented by admitted facts queried through `exists`/`related`; they are not coerced into a misleading scalar. Unknown namespace bindings are rejected during definition admission or evaluate unknown for an older qualified reader; the catalog states supported semantics.

Selection does not infer instruction precedence from similarity, timestamps, repository nesting, or apparent expertise. Host hierarchy governs host instructions; scoped current adoption governs this guidance layer. A remaining semantic conflict is retained and explained. A harmless independent task can proceed while a conflicting required criterion prevents the affected purpose from being declared complete.

The proposed `maximumBytes` range is 1–65,536 and `limit` is 1–100, matching the current managed-read bounds as an initial operational choice. The caller selects retrieval depth within the service limits; these numbers do not describe the model's context capacity. [Read budgets](managed-integration.md#read-success-coverage-and-budgets) separates host context management, response preferences, and actual transport/resource bounds.

Pagination cursors bind the selection, visible basis, principal/grant scope, and relevant clock observation. A changed basis requires a fresh resolution. An incomplete authorized candidate scan or a budget-limited selection makes `complete: false`; empty results cannot mean "no applicable guidance" if discovery coverage is unknown. Known visible selected references omitted from the response are reported in `omittedRefs`; remaining discovery uses the qualified cursor/coverage basis. Required instruction, applicability, exception, or conflict material can be recovered through those references or further pages. Its omission cannot waive an obligation or support a complete-guidance or purpose-satisfaction claim.

Successful partial results remain useful to an agent that already has other context. Completeness applies to the named authorized selection, never global knowledge or readiness to act. A metadata projection can be complete when bodies were not requested. If the minimum routing, basis, and truthful coverage information cannot fit, return `LIMIT_EXCEEDED`. The installed `prompt.compose` contract separately preserves its explicitly required source slots or refuses an insufficient budget; partial retrieval does not silently make those inputs optional.

## Composition and delivery

The packet digest hashes canonical packet content with the `digest` field omitted. The basis includes the actual input vector, visible current policy/catalog references, and the relevant clock observation. Equal rendered prose with changed acceptance or sources is not the same packet. Retaining a packet as `guidance.packet` preserves its historical basis, never a permanent claim of current applicability.

The packet contains instruction references separately from evidence references. Composition uses currently supported admitted templates and exact authorized sources through the existing `prompt.compose` boundary. Raw source text and extraction output remain quoted evidence; they cannot alter the instruction envelope. Native host instructions and current permissions remain authoritative.

The rendered working guidance names the relevant desired relationships, local interpretation, source/criterion identity, meaningful checks, unresolved conflicts, exceptions, and next useful response. It remains brief when little applies. A prompt is a derived view; changing its wording cannot change accepted requirements or activate an execution.

The future workspace contract adds an explicitly requested guidance query and returns `GuidedContextPacket`. Existing callers keep the current `ContextPacket`; unsupported versions reject the new input rather than ignore it. Explicit `guidance.resolve` is available for later task changes or deeper explanations. Stable server guidance tells agents when to request it; dynamic project instructions stay in data rather than being copied into every tool description. CLI, MCP, offline discovery, and native typed clients derive from the same implemented binding catalog.

During a task, the agent retains the selected packet/basis with its continuation. A relevant new user correction, target adoption, source change, or unknown result prompts selective reevaluation. Moment does not transparently inject updated instructions into every existing native turn. An integration can provide a bounded native notice at a safe boundary, with its exact source references; the recipient still resolves current authority and guidance.

## Public operation contract

| Proposed operation | Input and result | Admission and effects |
| --- | --- | --- |
| `guidance.resolve` | `GuidanceRequest` → `GuidancePacket` | Read-only current-authority selection. No capture, model, activation, or native-goal effects. |
| `guidance.adopt` | `Mutation`, adoption ID/content, `Basis` → stored adoption | One guarded context mutation with current normative issuer/delegation checks. Equivalent graph writes obey the same checks. |
| `purpose.evaluate` | Attachment target, purpose ref, selected fact refs, byte bound → `PurposeEvaluation` | Read-only current criteria/effect/coverage evaluation. No check dispatch or incident completion. |
| `work.request` | `Mutation`, immutable `WorkDefinition` → `WorkReceipt` | Atomic admission of one definition and existing execution/outbox, under current profile and resource limits. |
| `work.read` | Attachment target and work ID → `WorkReceipt` | Read authorized job/execution/native references and retained results; no turn resume. |
| `work.cancel` | `Mutation`, work ID and reason → `WorkReceipt` | Authorized cancellation request through the existing execution state machine. |
| `work.reconcile` | `Mutation`, work ID, attempt, existing `Reconciliation`, usage → `WorkReceipt` | Evidence-backed existing execution reconciliation; no timeout-only replay. |

These seven methods form `EvolutionMethods`, not installed methods. Implementations reuse existing error codes and retain exact requests on uncertain writes. Source/basis mismatches return `REVISION_CONFLICT` with a safe actionable reason; explicit inaccessible objects use the existing non-disclosing access failure. A model output/schema mismatch is a failed work result, not `ok: true` with invented empty findings.

CLI requests should accept validated structured file/stdin inputs using the existing exact-retry mechanism. Human views lead with outcome, reason, and next action; JSON output preserves exact packet and receipt semantics. New MCP tools must appear only after handlers, input/output validation, permissions, compatibility behavior, and acceptance tests are implemented. Existing saved policies receive an admitted upgrade proposal; catalog regeneration cannot expand them.

## Dependency and retention behavior

New package event names are `guidance.source.observed`, `guidance.adopted`, `guidance.assessed`, `guidance.coverage.changed`, and `work.admitted`. Their subject references name the admitted capture, adoption, assessment/binding, index-frontier observation, or work/execution respectively. Existing `Event` context/revision/sequence/cause fields carry ordering and declared causality. Visibility follows every referenced dependency; payloads contain bounded identifiers/reasons, not raw source or credential content. A derived stale judgment alone does not mutate history; a retained reevaluation observation can emit an event. Existing execution lifecycle events report dispatch/outcomes without per-token or model-polling events.

Derived discovery indexes are caches of admitted schema fields and authorized provenance. They carry a schema/extractor version and source frontier, can be rebuilt from retained records, and cannot become a second authority. A missing or stale frontier yields incomplete discovery. Cross-context projection invalidation and source adapter gaps remain visible instead of converting into zero matches.

Retain accepted targets/adoptions, current bindings, criteria, required supporting evidence, unresolved work, exact retry receipts, and native handoff recovery inputs. Extraction traces, duplicate rendering, and regenerable indexes have bounded retention. GC follows reference/support dependencies and an explicit retention policy; it cannot delete a still-supported rationale or uncertain effect to satisfy storage pressure. Current full-snapshot SQLite growth needs measurement before high-frequency observation. No daemon-wide watcher or new automatic garbage collector is implied by this specification.
