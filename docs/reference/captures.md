# Capture preservation and minimization

Moment separates a run's durable meaning from the physical custody of its bulky inputs and outputs. A completed incident does not make every embedded file disposable, and a history directory does not require every incidental binary to remain an independent copy forever.

The implemented subset provides versioned run/disposition records, a bounded current-authority reader, active-or-latest-two run selection, and owner-local exact-byte sharing through a qualified Darwin adapter. It does not implement generic orphan pruning, automatic raw retirement, archive construction or a host cleanup scheduler. The broader artifact API remains proposed. [Storage](storage.md) owns governed database, guidance, memory and recovery custody; those components are outside this legacy payload helper.

## Meaning, evidence and representation

[CaptureManifest](../../contracts/captures.ts) identifies one run and generation: target context/incident, meaningful project/worktree/category, source and dirty-input identities, tools/commands/environment, outcomes/limitations, selected claims/evidence, dependencies/pins and continuation. Use known facts and explicit limitations; do not fabricate missing provenance. Keep independent observations independently attributable even when their bytes share storage.

Run selection preserves active/current work and its required dependencies, or the latest two completed working packages when none is active, independently within each meaningful scope. Explicit pins and transitive run dependencies remain selected. An unknown dependency is an actionable gap. Selection is not permission to delete a run or proof of a complete reverse-reference frontier. Historical decisions, corrections, failures and relevant evidence can outlive the two-run working selection. There is no age cutoff.

A selection group includes system identity, project scope or distinctly tagged context scope, optional worktree and artifact category. Runs sort by descending exact order, then scalar string identity; equal IDs in the supplied frontier refuse rather than choose a winner. The core expands dependencies over that complete frontier, retains cycles without repeating them and reports missing required runs. Cancelled work is retained when current, pinned or required by a selected run.

Each payload retains its original relative path, byte count/digest, role, dependencies, claim uses, pins and declared availability. Paths are confined to the selected incident's captures namespace, outside retention metadata. Payload, dependency and claim IDs are validated together. Protected authored/world/state/recovery/private payloads cannot use a minimized availability declaration in this subset.

| Declaration | Meaning |
| --- | --- |
| present | The record expects the original logical path. Presence still requires observation; bytes need separate verification. |
| exact-shared | A recorded operation preserves logical path/bytes while changing physical sharing. Its digest is evidence identity, not proof by itself. |
| packed | An explicitly located archive requires materialization. Require tested restoration evidence; an archive path is not a runnable directory. |
| rebuild-only | A recipe is available, without claiming exact original byte recovery. |
| intentionally-retired | An attributable disposition qualifies the original's current absence; selected historical meaning/evidence remains. |

The last three declarations represent separately qualified owner procedures; this build does not perform those payload transformations. A later rerun cannot recreate a unique original failure, screenshot, trace or measurement. Preserve required originals or tested exact recovery. A digest establishes identity, not recoverability, current accessibility or authority. Remote availability is an observation.

Keep original admitted reports and hashes unchanged. Add a successor disposition when raw custody changes. “Observed pass at revision X” and “exact local raw replay is no longer retained” can both be true. Do not rewrite a historical pass into a current reproduction claim or remove evidence materially supporting a relied-on claim without reconciliation.

## Publication and actual readers

`moment captures record --file PUBLICATION --json` accepts the typed CapturePublication under the selected local operator credential. It uses existing schema/graph admission, reads the admitted body back, publishes a private immutable generation and updates its current pointer. It changes no payload. A context revision, exact retry key, consecutive generation and previous digest guard publication. A lost acknowledgment retains the exact request; replay reconciles it without duplicating history. A completed old retry returns its original receipt without rewinding a newer pointer.

The sidecar layout is `incidents/<id>/captures/retention/`: current.json, immutable generation representations, exact publication journals, and maintenance plans/journals/receipts. The admitted graph record remains the semantic source. A pointer cannot grant access: readers recheck the current incident and record authority and verify the private representation against that immutable record.

`captures.read` is the installed managed/MCP method. Its CLI projection is `moment captures read --context ID --incident ID [--payloads JSON] [--maximum-bytes N] --json`. A workspace packet advertises a registered disposition and its recovery reference. If that optional disposition is unavailable, the workspace packet qualifies that component without concealing the rest of the accessible continuation. Direct capture selection still refuses denied or invalid evidence.

Capture reads report declared availability separately from bounded filesystem presence. present-unverified does not establish a payload hash. An unexpectedly restored path does not erase the earlier retirement record. A present packed representation reports materialization-required rather than silently returning bytes under the old path. Responses preserve omission identities and the manifest record reference within a 1–64 KiB byte budget; graph.query can recover an accessible full manifest that did not fit.

Before materially relying on a stored payload, inspect its current disposition and the needed evidence body, or reuse an actually present verified excerpt. Merely passing a manifest reference or receiving a tool result proves no inspection or comprehension. Unregistered means there is no registered disposition, not that legacy cleanup never occurred: inspect older companion records and relevant owner procedures too. An unread sidecar is insufficient. Preserve path/bytes or defer when an unmodified consumer cannot discover the new availability.

## Owner-local preview and exact sharing

The structured operator boundary uses CaptureMaintenancePolicy, CaptureCustody, CaptureMaintenanceRequest, CaptureMaintenancePlan and CaptureMaintenanceReceipt. Publication/maintenance requires the selected local operator, while read access follows current incident/record policy. A policy or manifest cannot expand host authorization, impersonate a separate principal or resume paused recurrence.

An enabled private operator policy selects exact target incidents, allowed payload classes and resource ceilings. A separate private custody record binds its exact policy bytes, scope, live coordinated owner, confirmed participants, exclusions and unresolved writers. Record actual coordination/evidence. An alive PID or owner label alone is not custody; a helper lock covers only cooperating participants. Unknown external writers or dependencies are explicit deferrals, not either a deletion assumption or a permanent pin on every capture.

`moment captures plan --file REQUEST [--out PLAN] --json` is read-only for payloads. It freezes the current disposition/context, policy/custody identities, bounded explicit pairs and native file identities. Sources must remain independent survivors, never targets in the same plan. It explains protected, pinned, unavailable, mismatched, unsupported and over-budget candidates. The selected frontier is not a universal reverse-reference index.

`moment captures apply --file PLAN --json` revalidates that exact plan before each selected effect. `moment captures reconcile --file PLAN --json` additionally reconciles an interrupted, exactly bound operation after its old controller is observed retired. Changed authority, policy, custody, generation, paths, metadata or hashes refuse. An unresolved unrelated lock is preserved. Recovery requires serialized operator custody; the scope file is cooperative exclusion, not an operating-system lease. A completed exact reconciliation may settle only its matching retired controller lock without touching payloads. Do not invent a new key or delete an unknown journal to clear a refusal.

Preview and apply use the same core eligibility and observed-file decisions. An edited plan cannot make a packed/unavailable payload or executable eligible. Complete replay requires exact selected-item coverage; incomplete or unknown receipts preserve custody. Publication, pointer and cooperative-lock records validate their supported version and identity before any replay or reclamation.

The first adapter supports same-volume native Darwin copy-on-write sharing of qualified regular non-executable files. It preserves each original logical path and exact bytes with independent writes. It does not hardlink mutable captures or fall back silently to a normal copy. It refuses special bits, multiple links, symlinks/unsafe ancestors, unsupported flags/ACLs/xattrs and metadata differences. The qualified xattr subset includes com.apple.provenance. Birth/mtime and metadata equivalence are checked; nanosecond timestamps and inode identities cross the JavaScript boundary as decimal strings. Inode/ctime changes and access-time observations remain explicit limitations. Executable/signature preservation requires a separately qualified adapter.

World markers and protected state categories remain excluded even when embedded under completed capture trees. In particular, state/.../after-* and recipient-state are not binary-dedup candidates. No worlds/saves/LODs, private instance configuration, uncertain recovery or governed runtime bytes are eligible. No application, compiler or server is killed to establish eligibility.

Under coordinated custody, the adapter stages a private clone, verifies it, journals preparation, swaps paths atomically, verifies the moved original before unlink and records completion. Changed/newer replacements remain intact. Interruption reconciliation covers preparation, swap and removal; completed retries do not touch a later restored path. Only owned adapter processes may be terminated on a deadline, with an explicit unknown outcome and retained journal. These are process-interruption guarantees, not power-loss or adversarial filesystem isolation claims.

The bundled native frame uses protocol 2 and carries the protected component projection from the executed core. Native code inspects components relative to the admitted capture roots and independently checks actual world markers and filesystem safety. Its physical transaction journal validates known phases, bound paths and phase-specific file observations. A bounded legacy reader accepts the original unversioned journal shape; unknown versions, phases and fields refuse effects. This compatibility reader does not reinterpret unsupported recovery state.

## Preservation, recovery and accounting

Before any manual orphan cleanup, current storage policy requires preserving the complete store and qualifying references. This helper is not an orphan collector or a legacy exemption. Raw retirement needs the applicable safeguard or an explicitly admitted scoped preservation policy; a generated plan cannot authorize itself. Protected migration recovery remains separate. Never restore an old database over newer accepted writes.

Backup/quarantine custody must have explicit condition-based settlement and count toward occupied space. Preserve uncertain effects and original exact requests. Do not hide indefinite raw retention in an archive or call a same-volume move reclaimed space. Retain selected proof and concise receipts rather than repeated full scans or competing report histories.

Report logical bytes/paths preserved or removed, duplicate allocated upper bounds, actual observed free-space changes, retained backup/quarantine obligations and concurrent-activity limits separately. Shared extents and snapshots can keep blocks allocated; summed file sizes are not exclusive reclamation. A partial/unknown plan never becomes a completed run because the free-space target was reached.

Native agents may use the operator commands within existing authorization and an admitted policy without repeating per-file approval. Keep each operation bounded and leave actual host scheduling/activation with its owner. [Dependency maintenance](../development/dependencies.md) owns adapter/runtime updates; [verification](../development/verification.md) owns actual qualified snapshots and limits.
