# Verification

Moment was checked on November 12, 2026, on macOS arm64 with Node.js 26.13.0, pnpm 12.18.0, TypeScript 7.0.2, and built-in SQLite 3.54.0. The implemented kernel exposes 37 methods: persistence and identity, operator and delegated authority, semantic transitions, deterministic rule evaluation, permission-filtered views, capability negotiation, durable execution control, scoped event delivery, and wake scheduling. Actual verifier dispatch, messaging, prompt composition, and the full native-agent workflow remain pending.

## Current checks

| Command | Observed outcome | Scope |
| --- | --- | --- |
| `mise run check` | Passed: strict declarations, 17 Markdown files, 50 local links, 45 method entries, and 101 execution tests. | Combined runtime and contract candidate. |
| `node --test test/events.test.mjs test/scheduler.test.mjs` | Passed all 15 cases. | Scoped events, long-poll cleanup, persisted occurrences, coalescing, feedback bounds, and execution completion. |
| `node --test test/executions.test.mjs` | Passed all 20 cases. | Capability matching, reservations, leases, cancellation, reconciliation, proposals, and views. |
| `node --test test/reactions.test.mjs` | Previously passed all 15 cases. | Transitions, topology, rules, pointers, and perspectives. |
| `pnpm check:types` | Passed, including nine required rejection examples. | Declared boundaries and native-client method typing. |
| `mise run setup` | Previously passed frozen installation with pnpm 12.18.0. | Exact dependency graph; lifecycle scripts disabled. |
| `node scripts/codex-isolated-probe.mjs` | Previously passed with installed `codex-cli 0.167.2`. | Isolated stdio startup and unauthenticated protocol, without inference. |
| `git diff --check` | Passed for the implementation candidate. | Whitespace checks only. |

The combined check exercised the execution candidate following `20a570a2da4a3d14ac5602b9417fde28e12889bc`. The exact committed revision and selected captures are retained in the central implementation incident checkpoint. Runtime source identities for this candidate are:

| File | SHA-256 |
| --- | --- |
| `contracts/index.ts` | `948dd35cffcd6c3ce034a94669c1dc856c1119a049cfdb8514c552d68252b516` |
| `runtime/kernel.mjs` | `a8d855913e427210b26f621d471b82c0b7b37d05aeaf0d40d4578c42cd38d77e` |
| `runtime/events.mjs` | `d06457c279c6d38e0be330c0bf9ffb6b58491ee6f5e2fc982845951bb7b31782` |
| `runtime/scheduler.mjs` | `c804584475842cb22fccfe3ce69d2c59630060c78a06a4eae08c383663a7eb98` |
| `runtime/server.mjs` | `1c19803f61190ac4bdf836a39a170dff00ec5aac02dad0307e01e994a5967e6e` |
| `test/events.test.mjs` | `def63148abce81853f68428ecddb7eb164333f7d2badacb22e014113a5c62f18` |
| `test/scheduler.test.mjs` | `5ac35d698d7ce2e7f968b686db67f500188c823107c43236f42bd1570cd575bf` |

## Executed behavior

| Boundary | Actual evidence | Acceptance coverage and limits |
| --- | --- | --- |
| Persistence and concurrency | Actual SQLite transactions, reopen in a new process, competing child processes, and a child killed inside a transaction. Exact response, revision, event, receipt, and outbox survive acknowledged writes; identity conflicts roll back. | Storage portions of E1–E3. No power-loss or multi-host durability claim. |
| Identity and central discovery | Temporary directories, path/symlink escape rejection, exact-byte bootstrap import, actual Git clone and linked worktree, and a confirmed moved locator. Import does not activate an incident. | E12 and bootstrap handling; no required metadata written into touched projects. |
| Authority | Selected-resource delegation, incident scope, ancestor attenuation, expiry observations, branch-specific revocation, current checks before historical reads and receipt replay, autonomous policy narrowing, and rejected expansion. | Authority portions of E4–E5; no OS sandbox or independent provider-usage measurement evidence. |
| Evidence and ReBAC | Independent support survives withdrawal. Delegated assertions remain ordinary evidence until admitted by policy or supported by an admitted issuer. Relation-path admission disappears after support withdrawal. Hidden provenance cannot influence visible support or selection. | E6 and bounded authorization traversal; no automatic inference or support propagation claim. |
| Semantic transitions | Proposals remain inert, conflicting candidates are refused, commit persists graph and identical receipt atomically, exact retry survives reopen, and intervening changes or revocation refuse commit. A proposer retains authorized access after a different reviewer commits. | Semantic and execution-intent admission; no automatic provider dispatch. |
| Structural and temporal relations | Installed relation schemas, required endpoint roles, atomic placement replacement, asserted containment cycles and multiple-parent rejection per perspective, and precedence cycle rejection per temporal frame. A relation cannot disguise itself as an atom. | Local asserted topology; no temporal interval applicability or general theorem prover. |
| Perspectives | Selected fields omit private payload and unselected support; hidden changes leave the visible digest unchanged. Grants filter before pagination. Fixed-size encrypted cursors reject tampering, wrong keys, and cross-view, cross-query, or cross-grant reuse. | E7 at the implemented semantic boundary. Actual queue, lease, heartbeat, and finish changes stay hidden until an admitted semantic result changes the view. Timing side channels are not exercised. |
| Deterministic reactions | Trusted context/event bindings produce a validated candidate without executing it. Missing, overlapping, and inherited pointer locations are refused. | Read-only rule evaluation; model-driven policy quality remains untested. |
| Events and wakes | Mixed-transaction notices preserve visible record discovery without disclosing hidden support. Cursors survive restart and reject other grant/query scopes. Long polls release listeners and recheck revocation. Persisted occurrences commit with their operation, survive restart, coalesce with source IDs, retain overflow cursors, avoid causal feedback, and wait for admitted execution completion before rearming. A real daemon stays idle without writes, survives abrupt restart, receives an event through a long poll, and admits one saved wake. | E8 and native event transport. These are real kernel operations with test intents, not model-generated work or verifier process execution. |
| Execution control | Durable queue/outbox, provider-only claims, heartbeat before effects, fenced completion, attempt-bound reconciliation, aggregate context/ancestor reservations, cancellation/unknown races, current policy narrowing, and grant expiry. A real daemon expires leases without RPC activity, observed through read-only SQLite, and recovers running work as unknown after `SIGKILL` and restart. | E9–E10 at the kernel/transport boundary. Reports in these fixtures are synthetic; a real verifier and its receipts remain required. |
| Transport | Real test-owned daemons and Unix sockets, private file permissions, incorrect authentication, malformed and duplicate-key frames, abrupt restart, competing daemon refusal, typed client calls, separate credentials, and immediate revocation. | Local authenticated API and process recovery; full-access host processes are not isolated by the socket. |
| Input and conditions | Ajv input rejection, bounded local schema compilation, calendar and pointer constraints, three-valued logic, deny precedence, and unresolved queries that cannot grant rights through negation. | Runtime boundary components; compilation alone proves no admission or isolation. |

## Codex isolation

The opt-in probe resolves the installed executable read-only and directly spawns `codex app-server --listen stdio://`. It creates temporary workspace, configuration, and state roots; removes inherited Codex/OpenAI/ChatGPT environment settings from the child; and selects file credential storage. `initialize`, `initialized`, and `account/read` with token refresh disabled completed, returning no account. The probe stops only its own process and removes its own temporary files. Ordinary checks do not invoke Codex.

The probe never uses the primary control socket or managed daemon proxy, copies credentials, shares writable session/refresh state, creates a turn, or invokes inference. It establishes protocol isolation. M4 still requires a separately qualified supported authentication path and a real isolated native-agent interaction. The existing primary daemon, installation, threads, and agents remain outside test ownership.

## Tooling and check interpretation

The optional mise `secrets` profile was parsed and its tool pins selected without decrypting credentials. No encrypted Moment secret, recipient custody, or real-key recovery has been established. SOPS/age remains optional until a concrete consumer needs it.

The documentation checker validates local links, anchors, fenced blocks, whitespace, titles, and method-table coverage. Its earlier temporary broken-link and method-drift probes were rejected as expected. It does not validate external website availability or semantic equivalence of prose and code. Type examples reject unguarded mutation, generic policy activation, invented success, forged identity, executable policy, unsupported retry justification, mismatched parameters, client identity injection, and implicit full-record projection access.

The remaining completion obligations are [the rest of M3, M4, and E15](implementation.md). A synthetic fixture or a directly edited database does not satisfy the required real self-use improvement. No OS isolation, provider recovery, live inference, workload-quality, cost, or performance claim follows from the current checks.
