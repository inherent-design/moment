# Dependencies and patches

## Setup and ownership

`package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` own JavaScript dependencies. `packageManager` pins pnpm 12.18.0; `mise.toml` pins matching pnpm and Node 26.13.0 for built-in SQLite. Use `mise install`, `mise run setup` and `mise run check`, or the equivalent pinned pnpm commands. Normal setup is frozen and runs no dependency lifecycle scripts. Checks do not repair the graph. Keep personal overrides ignored, preserve shared-host installations and never enable automatic global pruning.

| Dependency | Consumer and update checks |
| --- | --- |
| MCP server/client 2.4.0 | One negotiated SDK surface: server is shipped, client is development-only. Check strict framing, schemas, structured results, legacy/modern negotiation, actual native discovery and installed-package calls together. |
| TypeScript 7.0.2 | Strict public contracts, examples and companion declarations. Run `pnpm check:types`. |
| `typescript-schema: npm:typescript@6.0.2` | Development-only compiler API for schema generation. The qualified TypeScript 7 package lacks `createProgram`/`createSourceFile`. Preserve the alias until the actual API works; do not downgrade the contract checker. |
| Ajv 8.20.0 | Deterministic input/output and local schema validation. Preserve rejection of unsupported/remote/executable schemas, scalar coercion and condition bounds. |
| Knip 6.46.1 | Executable dependency/export analysis with actual dynamic workers and explicit operator consumers in `knip.jsonc`. Companion declarations remain TypeScript's responsibility. |
| Bend and Lean | Exact versions/platform archive hashes in `toolchain.json`; actual emitted core and independent proof checks. |
| Trivy/actionlint | Optional exact native tools in `mise.security.toml`; scanner inventory/redaction and workflow validation. |

Review upstream releases and real consumers before changing pins. Use pnpm for changes and retain one lockfile. Regenerate bindings after covered changes, run frozen installation and qualify affected boundaries. `pnpm check:bindings` refuses drift without rewriting. Boundary shapes, input refinements, declarations, schemas and CLI/client/MCP projections must agree. A file extension or version label is not a compatibility result.

## Formal tools

`mise run setup:formal` delegates to `pnpm setup:formal`. The installer verifies exact platform archive SHA-256 before extraction, preserves existing installations and checks selected versions. Explicit local `MOMENT_BEND_HOME`/`MOMENT_LEAN_HOME` overrides are development conveniences; source qualification is independent of their location. A fresh checkout uses its own `.tools` directory. The distributed runtime executes the included JavaScript and installs neither compiler.

Setup streams bounded archives instead of holding them in memory, retains the whole upstream bundle and publishes a complete validated installation through exclusive link creation. It does not duplicate the extracted Lean tree during publication. A competing destination is preserved. Interrupted setup retains its process/bundle record and refuses automatic reclamation; inspect that custody and the selected destination before repairing only the matching setup. Never delete a selected or externally used bundle to clear a lock.

When updating a pin, review backend/ABI changes, refresh actual platform archive digests, rebuild with `pnpm build:core`, run `pnpm test:proof`, regenerate bindings and run native/package checks. Audit actual theorem dependencies and the declared finite comparison sets. Preserve mismatches as counterexamples; changing a source pin does not repair correspondence. Historical JSON encodings, numeric units and native frames must survive. Bend's JavaScript-host arithmetic is not an unbounded mathematical Nat. See [semantics](../reference/semantics.md).

## Automated proposals and security

`renovate.json` proposes weekly maintenance, separately permits urgent vulnerability proposals, limits open PRs and disables automerge. It groups the actually coupled MCP surface and Node/pnpm pins while keeping the schema compiler alias on its qualified API. Native compiler version/checksum updates still require the formal procedure. Configuration does not install or authorize a hosted bot.

`pnpm check:renovate` uses an explicitly versioned transient validator with lifecycle scripts disabled. Its strict check validates this policy. Optional RE2 is unavailable in that installation; the current policy uses literal/glob matches rather than custom regular expressions. Introducing regex extraction requires qualifying that additional consumer instead of treating the earlier check as sufficient. Do not enable arbitrary install scripts to silence a warning.

Use `mise -E security install`, then `mise -E security exec -- pnpm check:ci` and `mise -E security exec -- pnpm security:scan`. The scan checks source, secrets, recognized misconfigurations and locked dependencies, including development dependencies. It refuses a report omitting any declared dependency or alias version. The report records database identity and exact manifest/lock digests. Secret matches, excerpts and raw report fields are never published. Temporary raw reports are private and removed after the allowlisted result is written.

Trivy recognizes specific configuration formats; actionlint separately checks workflow structure. Missing/interrupted scans are failures, not empty successful reports. Ordinary checks do not download a vulnerability database. Keep scanner updates and databases attributable. For a finding, fix it or retain a narrow source/package/version disposition, owner, reason and review condition. There are no standing suppressions. Never silently dismiss development vulnerabilities or expose credential matches in logs/artifacts. Follow [security reporting](../../SECURITY.md).

## Codex API boundary

Accept compatible additive changes and refuse actual consumed-boundary disagreement. Record the executable version as evidence rather than enforcing an exact release label. CI's 0.169.0 qualification baseline is a reproducible test input, not a runtime ceiling or floor. Historical source codecs, installed catalog identity and component storage formats have independent compatibility rules.

`runtime/codex-api.mjs` owns consumed response/notification checks and selected model/permission agreement. Unknown additive fields and notifications do not create requirements. Missing/malformed required fields or refused consumed parameters produce a scoped `CODEX_API_MISMATCH` diagnostic. Preserve authentication, model, permission, profile/output and uncertain-dispatch boundaries; never silently relax them or switch to billed API execution.

A request observed before dispatch can fail as not started; a possibly dispatched turn remains unknown until evidence reconciles it. Preserve the exact job/request and attempt identity. Recovery can settle a qualified retained result without another inference even if the current executable label changed. Do not infer replay safety from a version string. Runtime diagnostics omit raw accounts, requests and upstream payloads; no automatic developer-notification channel is installed.

`pnpm test:codex-protocol`, `pnpm test:integration` and `pnpm test:codex-mcp:protocol` use read-only installed binaries with test-owned state and no inference. The latter derives tool expectations from the actual catalog and checks the admitted result at the negotiated protocol. Source organization and generated schema filenames are supporting evidence rather than the wire API itself. A future schema-layout disagreement in a qualification script must be diagnosed rather than worked around with a guessed contract.

Live native checks are explicit and separate. Select an owned root and a private unexpired access-session source; use external in-memory authentication with no refresh token or shared writable auth state. Preserve current tool annotations and the fixture's narrowly authorized write approval. Parent and child share their credential principal. Verify actual child-attributed events and admitted records rather than inherited history or model claims. Never test in primary threads or change peer goals. See [verification](verification.md).

## Profiles, storage and native adapters

Memory core prompt 6, native strategy/profile 6 and compact input renderer 2 have separate identities. Retained qualified profile-5 results remain recoverable with their frozen preparation. Guidance owns its separate profile in `runtime/guidance-profile.mjs`. Change the relevant identity when semantics change; do not relabel historical output or reconstruct an old digest with a newer renderer. Check source attribution, purpose/focus routing, late results, quotation anchoring, bounded omissions, cancellation, lost acknowledgments and current authority together. Live inference is justified by an unqualified provider/profile boundary, not routine metadata edits.

The private memory-binding adapter uses authorized work/guidance readers. A validated immutable body omitted by a response limit is distinct from native inspection/adoption. Preserve denial-before-byte-access, corruption/range, historical qualification, association and restart cases when changing this boundary.

Storage changes require explicit preview, exact preconditions and isolated all-history migration/recovery before live use. Retain immutable references, credential custody, receipt history and protected payloads. Never restore an older database over newer writes. See [storage maintenance](../reference/storage.md#explicit-migration-and-recovery). Pure semantic-source changes need no gratuitous format bump.

The shared memory hook loads the service only after a positive private enrollment hint. New sessions default off. Hook command/metadata edits affect native trust hashes; ordinary native review remains required. Qualified configuration refresh can update a loaded definition without trusting it. Verify actual metadata and admitted intake, not only a file or reload acknowledgment.

Exact capture sharing is an optional Darwin consumer of platform `/usr/bin/python3` (3.9 or later), native clone/birthtime/rename APIs and the supported metadata subset. It is not installed by portable checks. Qualify actual calls, permissions, precision, protected content, custody, interruptions and retries per supported platform. Unsupported cases refuse without a copy/hardlink fallback. A version label alone establishes no native capability. Preserve uncertain journals before replacement.

## Private information and owned patches

There are no tracked Moment secrets or owned dependency patches. Keep ordinary setup/checks independent of credentials. If a concrete tracked private consumer appears, use the optional `mise.secrets.toml` profile (SOPS 3.13.3, age 1.3.2), ciphertext and intended public recipients. Keep private identities/recovery outside Git, test encryption/decryption and wrong-key refusal, and verify actual custody separately. Never copy sibling secrets or put plaintext in logs/captures. [SOPS reference](https://getsops.io/docs/reference/)

Before adding a patch, record upstream version/issue, purpose, affected consumer, application method, tests and removal condition. Rebase or retire it deliberately on upstream updates. Do not hide vendored changes in lockfile noise. Dependency maintenance authorizes neither publication nor deployment; follow [releasing](releasing.md) and the current owner request.
