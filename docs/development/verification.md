# Verification

Moment was checked on November 12, 2026, on macOS arm64 with Node.js 26.13.0, pnpm 12.18.0, TypeScript 7.0.2, and built-in SQLite 3.54.0. The implemented kernel exposes 24 methods: persistence and identity, operator and delegated authority, semantic transitions, deterministic rule evaluation, and permission-filtered views. Scheduling, execution, messaging, prompt composition, and the full native-agent workflow remain pending.

## Current checks

| Command | Observed outcome | Scope |
| --- | --- | --- |
| `mise run check` | Passed: strict declarations, 17 Markdown files, 50 local links, 44 method entries, and 64 execution tests. | Combined runtime and contract candidate. |
| `node --test test/reactions.test.mjs` | Passed all 15 cases. | Transitions, topology, rules, pointers, and perspectives. |
| `pnpm check:types` | Passed, including nine required rejection examples. | Declared boundaries and native-client method typing. |
| `mise run setup` | Previously passed frozen installation with pnpm 12.18.0. | Exact dependency graph; lifecycle scripts disabled. |
| `node scripts/codex-isolated-probe.mjs` | Previously passed with installed `codex-cli 0.167.2`. | Isolated stdio startup and unauthenticated protocol, without inference. |
| `git diff --check` | Passed for the implementation candidate. | Whitespace checks only. |

The combined check exercised the governed-reaction candidate following `0a2fb881cf26bb8638f90f05b51561064a6f8f4f`. The exact committed revision and selected captures are retained in the central implementation incident checkpoint. Runtime source identities for this candidate are:

| File | SHA-256 |
| --- | --- |
| `runtime/kernel.mjs` | `27060134d7b301c430899c68a0275f75f27154c112a60e3014f51eae66762f2f` |
| `contracts/index.ts` | `c38c4a7aa1b84cb6065b5f90333d1402b6426c8fb3b6f4f201c04a69b58032a2` |
| `test/reactions.test.mjs` | `9e1c7411d13843d6791a0fb6f721cfe3b256e467bc09e3aea40a1fe9b024cc5a` |

## Executed behavior

| Boundary | Actual evidence | Acceptance coverage and limits |
| --- | --- | --- |
| Persistence and concurrency | Actual SQLite transactions, reopen in a new process, competing child processes, and a child killed inside a transaction. Exact response, revision, event, receipt, and outbox survive acknowledged writes; identity conflicts roll back. | Storage portions of E1–E3. No power-loss or multi-host durability claim. |
| Identity and central discovery | Temporary directories, path/symlink escape rejection, exact-byte bootstrap import, actual Git clone and linked worktree, and a confirmed moved locator. Import does not activate an incident. | E12 and bootstrap handling; no required metadata written into touched projects. |
| Authority | Selected-resource delegation, incident scope, ancestor attenuation, expiry observations, branch-specific revocation, current checks before historical reads and receipt replay, autonomous policy narrowing, and rejected expansion. | Authority portions of E4–E5; no OS sandbox or aggregate execution-budget evidence yet. |
| Evidence and ReBAC | Independent support survives withdrawal. Delegated assertions remain ordinary evidence until admitted by policy or supported by an admitted issuer. Relation-path admission disappears after support withdrawal. Hidden provenance cannot influence visible support or selection. | E6 and bounded authorization traversal; no automatic inference or support propagation claim. |
| Semantic transitions | Proposals remain inert, conflicting candidates are refused, commit persists graph and identical receipt atomically, exact retry survives reopen, and intervening changes or revocation refuse commit. A proposer retains authorized access after a different reviewer commits. | M2 semantic path; execution intents still return `CAPABILITY_UNAVAILABLE`. |
| Structural and temporal relations | Installed relation schemas, required endpoint roles, atomic placement replacement, asserted containment cycles and multiple-parent rejection per perspective, and precedence cycle rejection per temporal frame. A relation cannot disguise itself as an atom. | Local asserted topology; no temporal interval applicability or general theorem prover. |
| Perspectives | Selected fields omit private payload and unselected support; hidden changes leave the visible digest unchanged. Grants filter before pagination. Fixed-size encrypted cursors reject tampering, wrong keys, and cross-view, cross-query, or cross-grant reuse. | E7 at the implemented semantic boundary. Timing side channels and provider-internal execution states are not exercised. |
| Deterministic reactions | Trusted context/event bindings produce a validated candidate without executing it. Missing, overlapping, and inherited pointer locations are refused. | Read-only evaluation; scheduling and model-driven policy quality remain untested. |
| Transport | Real test-owned daemons and Unix sockets, private file permissions, incorrect authentication, malformed and duplicate-key frames, abrupt restart, competing daemon refusal, typed client calls, separate credentials, and immediate revocation. | Local authenticated API and process recovery; full-access host processes are not isolated by the socket. |
| Input and conditions | Ajv input rejection, bounded local schema compilation, calendar and pointer constraints, three-valued logic, deny precedence, and unresolved queries that cannot grant rights through negation. | Runtime boundary components; compilation alone proves no admission or isolation. |

## Codex isolation

The opt-in probe resolves the installed executable read-only and directly spawns `codex app-server --listen stdio://`. It creates temporary workspace, configuration, and state roots; removes inherited Codex/OpenAI/ChatGPT environment settings from the child; and selects file credential storage. `initialize`, `initialized`, and `account/read` with token refresh disabled completed, returning no account. The probe stops only its own process and removes its own temporary files. Ordinary checks do not invoke Codex.

The probe never uses the primary control socket or managed daemon proxy, copies credentials, shares writable session/refresh state, creates a turn, or invokes inference. It establishes protocol isolation. M4 still requires a separately qualified supported authentication path and a real isolated native-agent interaction. The existing primary daemon, installation, threads, and agents remain outside test ownership.

## Tooling and check interpretation

The optional mise `secrets` profile was parsed and its tool pins selected without decrypting credentials. No encrypted Moment secret, recipient custody, or real-key recovery has been established. SOPS/age remains optional until a concrete consumer needs it.

The documentation checker validates local links, anchors, fenced blocks, whitespace, titles, and method-table coverage. Its earlier temporary broken-link and method-drift probes were rejected as expected. It does not validate external website availability or semantic equivalence of prose and code. Type examples reject unguarded mutation, generic policy activation, invented success, forged identity, executable policy, unsupported retry justification, mismatched parameters, client identity injection, and implicit full-record projection access.

The remaining completion obligations are [M3, M4, and E15](implementation.md). A synthetic fixture or a directly edited database does not satisfy the required real self-use improvement. No OS isolation, provider recovery, live inference, workload-quality, cost, or performance claim follows from the current checks.
