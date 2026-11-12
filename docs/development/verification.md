# Verification

Moment was checked on November 12, 2026, on macOS arm64 with Node.js 26.13.0, pnpm 12.18.0, TypeScript 7.0.2, and built-in SQLite 3.54.0. The implemented kernel exposes 37 methods: persistence and identity, operator and delegated authority, semantic transitions, deterministic rule evaluation, permission-filtered views, capability negotiation, durable execution control, scoped event delivery, and wake scheduling. The fixed local byte verifier dispatches real guarded processes and retains recoverable receipts. Messaging, prompt composition, and the full native-agent workflow remain pending.

## Current checks

| Command | Observed outcome | Scope |
| --- | --- | --- |
| `mise run check` | Passed: strict declarations, 17 Markdown files, 52 local links, 45 method entries, and 115 execution tests. | Combined runtime and contract candidate. |
| `node --test test/events.test.mjs test/scheduler.test.mjs` | Passed all 15 cases. | Scoped events, long-poll cleanup, persisted occurrences, coalescing, feedback bounds, and execution completion. |
| `node --test test/executions.test.mjs` | Passed all 21 cases. | Capability matching, reservations, leases, cancellation, reconciliation, proposals, and views. |
| `node --test test/verifier.test.mjs test/verifier-server.test.mjs` | Passed all 13 cases within the combined check. | Actual verifier CPU/RSS, permission guards, receipt publication, crash recovery, same-ID context separation, closure races, and explicit installer. |
| `node --test test/reactions.test.mjs` | Previously passed all 15 cases. | Transitions, topology, rules, pointers, and perspectives. |
| `pnpm check:types` | Passed, including nine required rejection examples. | Declared boundaries and native-client method typing. |
| `mise run setup` | Previously passed frozen installation with pnpm 12.18.0. | Exact dependency graph; lifecycle scripts disabled. |
| `node scripts/codex-isolated-probe.mjs` | Previously passed with installed `codex-cli 0.167.2`. | Isolated stdio startup and unauthenticated protocol, without inference. |
| `git diff --check` | Passed for the implementation candidate. | Whitespace checks only. |

The combined check exercised the execution candidate following `09b7c11ada1b5e41d677902964cd0d0c7395e509`. The exact committed revision and selected captures are retained in the central implementation incident checkpoint. Runtime source identities for this candidate are:

| File | SHA-256 |
| --- | --- |
| `contracts/index.ts` | `6063285de026c454d638c79e82630825323225392dfdb17677c498f719756258` |
| `runtime/kernel.mjs` | `a8d855913e427210b26f621d471b82c0b7b37d05aeaf0d40d4578c42cd38d77e` |
| `runtime/executions.mjs` | `b179ba9b5280254c39c2fff8a2d2f3a54712b85bc292ffcf7e79f26a76edd56f` |
| `runtime/providers/bytes-worker.mjs` | `64faf3364e02bdf9439b24c5738e657e87acc79fe54f32de8dd7d02e6a408a02` |
| `runtime/providers/bytes-host.mjs` | `2b0b460b9128fe5bec919fece183d5c0464f67ef460b41666f7b602311d2c5fc` |
| `runtime/providers/bytes-runtime.mjs` | `e060822df373008e7b374b7d660f2d7493122ba84ee9d8d3f06bdf6b9e37a220` |
| `test/verifier.test.mjs` | `34325ca3cfbab91e67e7e264a370a1b88e21201c791221e47f6ae31bbb9a998a` |
| `test/verifier-server.test.mjs` | `f8252661a80d59d5ce888368cedb2b6bbacadc2f47e807f6123235cbb0035748` |

## Executed behavior

| Boundary | Actual evidence | Acceptance coverage and limits |
| --- | --- | --- |
| Persistence and concurrency | Actual SQLite transactions, reopen in a new process, competing child processes, and a child killed inside a transaction. Exact response, revision, event, receipt, and outbox survive acknowledged writes; identity conflicts roll back. | Storage portions of E1–E3. No power-loss or multi-host durability claim. |
| Identity and central discovery | Temporary directories, path/symlink escape rejection, exact-byte bootstrap import, actual Git clone and linked worktree, and a confirmed moved locator. Import does not activate an incident. | E12 and bootstrap handling; no required metadata written into touched projects. |
| Authority | Selected-resource delegation, incident scope, ancestor attenuation, expiry observations, branch-specific revocation, current checks before historical reads and receipt replay, autonomous policy narrowing, and rejected expansion. | Authority portions of E4–E5; no OS sandbox. The fixed verifier supplies independently sampled process usage; broader provider enforcement remains unqualified. |
| Evidence and ReBAC | Independent support survives withdrawal. Delegated assertions remain ordinary evidence until admitted by policy or supported by an admitted issuer. Relation-path admission disappears after support withdrawal. Hidden provenance cannot influence visible support or selection. | E6 and bounded authorization traversal; no automatic inference or support propagation claim. |
| Semantic transitions | Proposals remain inert, conflicting candidates are refused, commit persists graph and identical receipt atomically, exact retry survives reopen, and intervening changes or revocation refuse commit. A proposer retains authorized access after a different reviewer commits. | Semantic and execution-intent admission; automatic dispatch is restricted to the exact installed verifier profile. |
| Structural and temporal relations | Installed relation schemas, required endpoint roles, atomic placement replacement, asserted containment cycles and multiple-parent rejection per perspective, and precedence cycle rejection per temporal frame. A relation cannot disguise itself as an atom. | Local asserted topology; no temporal interval applicability or general theorem prover. |
| Perspectives | Selected fields omit private payload and unselected support; hidden changes leave the visible digest unchanged. Grants filter before pagination. Fixed-size encrypted cursors reject tampering, wrong keys, and cross-view, cross-query, or cross-grant reuse. | E7 at the implemented semantic boundary. Actual queue, lease, heartbeat, and finish changes stay hidden until an admitted semantic result changes the view. Timing side channels are not exercised. |
| Deterministic reactions | Trusted context/event bindings produce a validated candidate without executing it. Missing, overlapping, and inherited pointer locations are refused. | Read-only rule evaluation; model-driven policy quality remains untested. |
| Events and wakes | Mixed-transaction notices preserve visible record discovery without disclosing hidden support. Cursors survive restart and reject other grant/query scopes. Long polls release listeners and recheck revocation. Persisted occurrences commit with their operation, survive restart, coalesce with source IDs, retain overflow cursors, avoid causal feedback, and wait for admitted execution completion before rearming. A real daemon stays idle without writes, survives abrupt restart, receives an event through a long poll, and admits one saved wake. | E8 and native event transport. The connected verifier case also completes an actual guarded worker from a saved event wake; no model-generated work is claimed. |
| Execution control | Durable queue/outbox, provider-only claims, heartbeat before effects, fenced completion, attempt-bound reconciliation, aggregate context/ancestor reservations, cancellation/unknown races, current policy narrowing, and grant expiry. A real daemon expires leases without RPC activity, observed through read-only SQLite, and recovers running work as unknown after `SIGKILL` and restart. | E9–E10 at the kernel/transport boundary. Synthetic control fixtures are complemented by the actual provider cases below. Observed overruns retain true usage and outcome, block new dispatch, and survive restart. |
| Fixed verifier | Actual fixed-code processes measure SHA-256, CPU and peak RSS; mismatch is a real failed outcome. Actual Node API attempts deny outside reads/writes, network, subprocesses and workers. Private receipts survive a daemon killed before finish; restart settles the unchanged attempt without dispatching again. Interrupted exclusive publication is normalized. Separate contexts with the same execution ID remain distinct. A late real result remains attributable after context closure without reopening graph writes. | Concrete E9–E10 and connected verification evidence. The process sample excludes host staging/finalization. Node guards are not hostile-code OS isolation; CPU/RSS are measured rather than hard ceilings. |
| Transport | Real test-owned daemons and Unix sockets, private file permissions, incorrect authentication, malformed and duplicate-key frames, abrupt restart, competing daemon refusal, typed client calls, separate credentials, and immediate revocation. | Local authenticated API and process recovery; full-access host processes are not isolated by the socket. |
| Input and conditions | Ajv input rejection, bounded local schema compilation, calendar and pointer constraints, three-valued logic, deny precedence, and unresolved queries that cannot grant rights through negation. | Runtime boundary components; compilation alone proves no admission or isolation. |

## Codex isolation

The opt-in probe resolves the installed executable read-only and directly spawns `codex app-server --listen stdio://`. It creates temporary workspace, configuration, and state roots; removes inherited Codex/OpenAI/ChatGPT environment settings from the child; and selects file credential storage. `initialize`, `initialized`, and `account/read` with token refresh disabled completed, returning no account. The probe stops only its own process and removes its own temporary files. Ordinary checks do not invoke Codex.

The probe never uses the primary control socket or managed daemon proxy, copies credentials, shares writable session/refresh state, creates a turn, or invokes inference. It establishes protocol isolation. M4 still requires a separately qualified supported authentication path and a real isolated native-agent interaction. The existing primary daemon, installation, threads, and agents remain outside test ownership.

## Tooling and check interpretation

The optional mise `secrets` profile was parsed and its tool pins selected without decrypting credentials. No encrypted Moment secret, recipient custody, or real-key recovery has been established. SOPS/age remains optional until a concrete consumer needs it.

The documentation checker validates local links, anchors, fenced blocks, whitespace, titles, and method-table coverage. Its earlier temporary broken-link and method-drift probes were rejected as expected. It does not validate external website availability or semantic equivalence of prose and code. Type examples reject unguarded mutation, generic policy activation, invented success, forged identity, executable policy, unsupported retry justification, mismatched parameters, client identity injection, and implicit full-record projection access.

The remaining completion obligations are [M4 and E15](implementation.md). A synthetic fixture or a directly edited database does not satisfy the required real self-use improvement. Provider recovery is demonstrated only for this fixed local verifier. No hostile-code OS isolation, live inference, workload-quality, general cost, or performance claim follows from these checks.
