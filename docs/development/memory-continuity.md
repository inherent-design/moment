# Memory continuity design

Status: implemented contracts and runtime, with matching local loading qualified. The current callable surface is [contracts/index.ts](../../contracts/index.ts) and the generated catalog. The central memory-continuity intent owns exact source identities and MC1–MC14 acceptance; its ordinary native canary is now observed and source-verified. This document owns the design and connected completion requirements, rather than a second deployment ledger.

The [integration contract](../reference/integration.md#session-conversational-memory) owns existing conversational memory. [Guidance](../reference/guidance.md) owns registered-source discovery; [storage](../reference/storage.md) and [authority](../reference/authority.md) retain their independent boundaries. The broader [purpose package](../reference/purpose.md) remains proposed outside its implemented subset.

## Outcome and scope

An authorized native agent can inspect a recent memory decision, recover an omitted original, select or return to task-specific working memory, and discover relevant registered guidance without duplicating whole conversations or changing operational authority. The ordinary default remains simple: one native session, one active selection, one eligible-input checker call and no mandatory task taxonomy.

Use the existing sources, incidents, references, candidate service and native runtime. A memory working set is a local selection over evidence, not a new Moment context, principal, native goal or execution environment. Generality, current applicability, salience, source status and permission remain distinguishable. A narrow condition can be essential current steering; newness or low generality alone does not justify deletion.

This assignment includes inspectable assessments, reversible working sets, source-backed guidance handoffs, bounded presentation, compatible storage evolution and qualified activation. Completing the diagnostic reader alone does not complete the assignment. Cross-session automatic conversation sharing, unrestricted history ingestion and a general workflow engine are outside this boundary.

## Information and ownership

| Representation | Meaning and owner |
| --- | --- |
| Original source | Existing immutable message text, identity, attribution, origin and exact selection metadata. An assessment never rewrites it. |
| Profile snapshot | Immutable data needed to reconstruct a recognized checker request: prompt text, role instructions, schemas/parameters, renderer identity and effective provider settings. Store each distinct value once. Credentials and refresh state remain outside it. |
| Assessment basis | Ordered references to original and context-only sources, prior selection and notes/weights, incoming originals, capacity, selected working-set revision, focus revision and profile identity. |
| Assessment outcome | Observed output or failure, resulting selection, explanation, actual usage and terminal/reconciliation state. An explanation is a model judgment, not evidence that its asserted reason is true. |
| Working set | Session-local purpose anchor, compact return point, source-backed focus basis, selected entries and references to applicable project work/guidance. |
| Active focus | A revisioned pointer to the selected working set. Selecting another set changes relevance; it does not retract a source, activate a goal or grant permission. |
| Native continuation | The host's actual conversation, goal, tools, processes and context management. Moment supplies evidence and recovery handles without claiming to evict native history. |

Preserve semantic identities and independent support when physical values match. Byte deduplication can reuse content; it cannot merge permissions, source attributions or independently scoped decisions. Conversation originals remain single cache units, with context-only exchanges separately attributed. Sub-message extraction remains optional rather than a new compulsory pipeline.

## Inspectable assessment history

Give each prepared assessment a stable identity, normally its dispatch ID. Publish its complete immutable basis before possible model dispatch. Retain ordered source references and the prior selection so the canonical request can be reconstructed without an earlier debug snapshot. Save the profile snapshot and recognized rendering recipe as data; never evaluate executable code recovered from storage.

Record prompt/request/schema digests, model and observed native/API identity, effective permissions and provider settings, outcome, before/after selections, explanation and measured usage. Reconstruct the exact role instructions, structured-output schema and rendered input, and verify them against recorded digests. Missing or unsupported evidence yields an explicit unavailable/legacy qualification. It never becomes a guessed reconstruction from the current cache.

Renderer 2 preserves complete source text, attribution, session and context links while omitting repeated private locator/selection metadata from model presentation. The full immutable request still retains it. Recorded renderer 1 remains reconstructable; a historical profile or result is never relabeled as the current version. Retain the whole valid native result, within the existing output bound, once alongside its decoded form or a verified reversible representation. An oversized or invalid result gets an explicit status and bounded attributable diagnostics; a truncated projection is not served under the original result digest. Unknown dispatches retain their preparation, observations and original retry identity. Provider recovery must not submit another model call merely to regenerate missing evidence.

The most recent successful assessment descriptor exposes its incoming source IDs and basis availability even when every incoming message was omitted from the cache. Its ID is a recovery handle. Failed, skipped and pending input coverage remains distinguishable from successful assessment. Exact source bodies continue through the existing source read path.

For earlier receipts, recover only metadata actually retained, such as input identities and known hashes. Mark complete historical basis as unavailable when it was not saved. Independently verified historical exports may be imported with their original provenance; there is no silent backfill from current notes or replacement of the original failure record.

## Reversible working sets

Each session starts with a default working set that preserves its existing cache. A native agent may select another set at a meaningful task boundary or return to an earlier set. Explicit selection invokes no checker, does not enroll automatic memory and does not discard conversation history. Unadopted projects remain supported through an opaque local purpose key; adopted work can bind the existing project/incident reference.

Use an existing purpose identity to reuse a set. A label is explanatory text, not identity or authority. Small changes revise that set rather than create policy contexts or full copies. A brief aside can stay within current work; it can also use a compact return point when that would help. Duration and return conditions may remain uncertain. They are attributable hypotheses rather than executable schedules.

A working set stores references to immutable entry values and source evidence, a compact current purpose/return point and its latest assessment. Returning restores the retained selection without replaying its entire conversation. The agent checks relevant project/source freshness before material reliance. A released working set can lose its cached selection under explicit retention while original sources remain subject to their separate policy; release is not source deletion.

Focus basis can name a few original messages or admitted work/guidance references. This preserves the actual task change even when the ordinary input was already queued for the previous set. These are original evidence references, not newly manufactured instructions. The next eligible assessment for the new set may consider its original human/unknown-authorship focus sources as selectable units; registered guidance and assistant exchanges remain separately attributed context.

At a clear user redirect, canonical goal change or deliberate handoff, the native agent inspects the retained working-set catalog and selects or reuses a stable purpose key, compact return point and original redirect evidence. Short asides normally stay in place. The installed map and tool guidance carry this procedure; available APIs alone do not establish use. The native agent manages focus through normal tool selection within existing delegation. The cheap checker may return a bounded focus hypothesis, with source basis and uncertainty. Its hypothesis does not apply a focus mutation, create a native goal or authorize an effect. A second routing model or one checker per dormant set is not required. The existing default behavior stays available when no explicit focus is useful.

## Revisions and concurrent work

Keep enrollment revision, focus revision and per-working-set revision independent. Preserve a monotonic session cache-content revision for the active projection; switching to identical entries can leave that content revision unchanged while focus revision changes. A read of an inactive set identifies both the selected set/revision and actual active focus.

At input admission, bind the input to its actual session and selected set. At claim, freeze the exact set revision, focus revision, sources and profile used. A later focus change cannot retarget that dispatch. Its result can update only the set it assessed, with the relevant revision guard. If that set is now inactive, it cannot replace the visible active cache or move focus back. Session processing cursors still advance truthfully.

Report the latest successful session assessment and the active set's latest assessment distinctly when they differ. Pending, unknown and failed records identify their bound set. Processed input is not proof that its meaning is retained in the active selection. A stale same-set writer preserves the conflicting result and reports the conflict instead of silently repairing it or dispatching another call.

An exact focus retry returns its original admission receipt without restoring an older focus after later changes. Fresh focus mutations require the observed focus revision. Observe/rebuild/operator paths must bind their target set explicitly at admission; preserve legacy exact receipt reconciliation and fail ambiguous fresh legacy requests with a scoped diagnostic. Focus changes never cancel a process or reconcile an unknown model outcome.

## Proposed callable surface

These names are design targets. Installed schemas remain authoritative until implementation and matching rollout.

| Surface | Selection and result |
| --- | --- |
| `memory.read` extension | Select the actual session, optionally a retained working-set ID and a bounded catalog view. Return active/selected identities and revisions, focus evidence, existing cache/source/coverage fields and explicit omissions. Without a set selector, return the active projection as before. Reading does not select focus or invoke inference. |
| `memory.assessments.read` | With a session and assessment ID, recover a bounded basis/outcome or qualified tombstone. Without an ID, page summaries newest first using a request-bound cursor. Return incoming source IDs and omission/recovery handles. Wrong-session IDs receive the same unavailable response as unknown IDs. |
| `memory.focus` | Owner-local guarded mutation with session, expected focus revision, idempotency key, target reuse/create/release selection and attributable evidence. Return the admitted focus/set identity and revision; preserve uncertain exact requests. It changes no enrollment or native goal. The active set cannot be released without a replacement target. |
| Existing guidance operations | Discover by attached context and task location, refresh a permitted canonical source when needed, and optionally request a bounded assessment. Existing authority and resource checks remain. |

New mutations use typed bounded fields, admitted source IDs/references and parameterized storage, without caller-selected storage paths. Source bodies and omission handles require the selected session association. External Moment references are read only under current context/grant authority; inaccessible references cannot enter a served packet through an old cached binding.

Implement native-client, CLI, MCP and `moment agents` projections from the same contract/binding source. Proposed human commands are `moment memory assessments` and `moment memory focus --file PATH|-`, with JSON input/output and explicit target/revision diagnostics. Do not maintain a separate prompt-only interpretation of their effects. Shared credentials retain shared attribution; native labels and set IDs are not independent principals.

## Guidance and presentation

At a meaningful goal change or structured handoff, the native agent attaches/reads selected work, discovers registered candidates for its location and judges relevance. It records source/capture/digest, selection, applicability and material omissions only for the evidence actually used. A working set can retain that binding and recovery path. This supports reuse across goals without moving personal conversation caches between sessions.

Current registered-source refresh and review provide the extraction/assessment building blocks. Use native, deliberately triggered curation for additional canonical prompts or project procedures when warranted. The assignment adds no global filesystem crawler, automatic instruction promotion or fixed research/review/implementation slots. A source's availability is separate from body inspection, adoption and outcome.

Default automatic injection is a compact map of current purpose, important selected descriptions, current coverage and recovery handles. Set its initial total UTF-8 budget to 4 KiB, including its preface. This is an adjustable presentation preference, independent of model context size and MCP detail ceilings. Reserve known omissions before adding whole items; supply optional detail through the normal read tools. Derived descriptions keep their attribution; truncated originals never inherit the full source digest.

Native hook spill and retention settings have their own units and semantics. Qualify actual model-visible output on the installed host; do not equate the native additional-context setting with this byte budget or assume file edits refresh loaded threads. Keep the cheap disabled-session path and default-off fork behavior. No new trusted-hook hash is written by the service.

## Bounds and retention

Initial configurable defaults are five selected original messages per set, at most eight retained sets per session, an 8 MiB aggregate working-set value/metadata budget, a 16 MiB aggregate full-assessment budget and a 1 MiB profile-snapshot budget. Keep current source/input/session/output limits unless a measured consumer justifies changing them. Account for payloads, notes, indexes and metadata; a count limit alone is insufficient.

The hook carries current material, not every dormant set. A catalog request returns compact descriptors and known omissions; it does not load all bodies into the checker. Preserve shared native-labor accounting and at most one assessment call per eligible new input. Focus/read operations and idle sessions create no model queue. A focus hypothesis can wait for native judgment.

Default to retaining the newest 32 full assessments within the aggregate byte budget, retiring older eligible details first. Protect in-flight/unknown work, retained working sets' current bases, required profile snapshots and recovery inputs, even when they are older. Preserve metadata/tombstones, incoming source handles and original hashes within the existing receipt bounds; do not introduce an unbounded secondary journal. Retention settings are owner-local configuration. Explicit exports can preserve selected historical proof independently. No automatic source-history pruning or deletion of existing migration backups is part of this change.

When protected data exhausts a bound, retain the current cache, release unused preparation resources and report the affected component's limit. Preserve input/unknown-outcome custody and make pending/failed intake coverage truthful. Ordinary conversation and unrelated Moment graph operations continue. Increasing a bound requires owner-local configuration; pressure cannot silently discard evidence or trigger extra inference.

## Storage and rollout

Plan memory store format 3 with versioned immutable assessment/profile/entry values and independently readable set manifests. Reuse private pooling/codecs where their invariants fit; avoid a mutable decoded-state cache without measurements. Kernel format 2 and existing historical generations remain unchanged.

Use explicit consistent backup, cutoff/revision/identity checks, exclusive publication and forward recovery for the memory upgrade. Convert each existing session cache to its default set without changing source identities, cursor/gap history, receipts or enrollment. Historical assessments remain honestly partial. An interrupted publication must resume from its retained plan; a rollback cannot erase subsequent accepted work.

Implement the actual profile/schema extension only after isolated source-based comparisons. Archive exact profile data, preserve uncertain legacy dispatch custody and refuse a real unsupported decoder boundary without resetting state or falling back to another model. Continue to depend on consumed Codex APIs rather than an exact CLI version label. Use the configured inexpensive Luna subscription path; new billed APIs and model fallback are not assumed.

Qualification precedes a coordinated matching service/client/catalog install. Recheck current ownership and active work, use exact-instance service retirement only with qualified custody, and preserve unresolved dispatches. Refresh only required MCP/hook configuration through supported paths; do not restart the owner's primary daemon/TUIs, alter peer goals or overwrite trust. Verify actual consumer tools and domain reads after loading. No activation follows merely from storing this design or its central intent.

## Connected acceptance

| ID | Required evidence |
| --- | --- |
| MC1 | A prepared assessment survives restart; its exact request, role instructions, schema and observed result reconstruct against digests without an external debug snapshot. |
| MC2 | A rejected incoming original is discoverable from ordinary model-facing reads and recoverable by ID; legacy unavailable basis, invalid results and byte omissions remain explicit. |
| MC3 | Old cache/source/receipt/gap/enrollment state survives the format upgrade, interrupted forward recovery and current-authority checks; protected originals/backups stay. |
| MC4 | Same-purpose reuse, a temporary aside, a separate task and a return preserve scope and references without creating policy contexts or full source copies. Duration may remain unknown. |
| MC5 | Competing focus writers and exact older retries cannot resurrect old focus. A pending/running assessment for A finishing after focus moves to B updates only A or retains an explicit conflict. |
| MC6 | Original-message units and contextual attribution survive selection; a narrow hold, conditional request and older distinctive correction remain recoverable without an invented supersession or authority upgrade. |
| MC7 | A real phase-change case, acknowledgment, ambiguous shift and changed-source return are evaluated against the existing flat-cache baseline with comparable model/resource conditions. Preserve original failures and judge actual surviving meaning. |
| MC8 | Source IDs, set IDs and guidance references cannot bypass session association or current permissions; fork/default-off behavior and manual-focus-without-enrollment are exercised. |
| MC9 | Registered guidance is discovered, its needed body inspected and its actual applicability retained in a goal/handoff. Availability alone cannot satisfy the case; no automatic global adoption is implied. |
| MC10 | Automatic injection obeys its complete UTF-8 budget with truthful omissions; explicit reads recover whole evidence. Actual owned-host and ordinary-use observations distinguish served bytes from model-visible context. |
| MC11 | Trace/set/profile limits, protected-data exhaustion, provider preparation failure and cancellation/unknown recovery preserve custody and release owned resources without a model retry loop. |
| MC12 | Generated contracts, native/MCP/CLI/agents surfaces, docs and dependency procedures agree. Required ordinary checks pass on the final source; owned real API/provider cases retain their exact snapshots and usage. |
| MC13 | A deliberately enrolled ordinary canary demonstrates the connected selection/retrieval/guidance behavior after matching loading. Active peer turns may contain useful handoffs; completion of every peer goal is not a gate. |
| MC14 | Final storage/inference/presentation measurements, known limitations, readable central continuation and current source identities support the whole assigned outcome. A partial slice, valid schema or favorable weight is insufficient. |

If selection comparisons do not support the intended behavior, preserve the result, keep that acceptance incomplete and refine the connected design or discuss a material change. Do not declare success by disabling an assigned capability or narrowing the goal to its easiest implemented part. A fixed number of retries or reviewers is not evidence of semantic quality.

Implementation proceeds through the observable boundaries above: exact assessment basis first, guarded reversible selection next, native guidance/presentation integration, then qualified migration and ordinary-use loading. These are dependency checkpoints for this finite delivery, not permanent modes imposed on future work. Keep one current checkpoint and the smallest necessary failure/recovery corpus in the central task store. Fold durable findings into their owning reference/contract rather than accumulating parallel manuals.

## Research basis

The [research index](../research.md#memory-and-task-continuity) owns upstream sources and applicability. The investigation found scoped retrieval, small injected maps, source-backed consolidation and persistent work anchors; it did not find a published universal temporary/permanent switch classifier. Routine budgets and representation choices above are engineering defaults for this implementation, subject to measured refinement while preserving the stated invariants and full acceptance scope.
