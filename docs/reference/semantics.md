# Executable semantics and proof boundaries

`core/semantics.bend` owns the executable definitions currently used for three-valued condition composition, deny/permit precedence, budget/deadline bounds, reference equality, grant-chain admission, conservative policy narrowing and immutable record/assertion admission. It selects declaration-first graph order while preserving support-command order and withdrawal identity. The native adapters in `runtime/semantic-core.mjs`, `conditions.mjs`, `authority.mjs` and `graph.mjs` encode observations, perform storage lookups, invoke the generated decisions and apply selected effects. Existing transaction, persistence, topology, scheduling and provider boundaries retain their owning modules.

`runtime/generated/semantics.mjs` is the emitted executable. `semantics.json` identifies its exact core, model, checker and toolchain inputs and output digest. The public binding catalog also covers these inputs and the generated executable. Editing generated JavaScript or a covered source without regeneration refuses qualification. A manifest establishes identity and coherence; it does not claim that a proof or native test ran.

`core/execution.bend` owns execution state/action selection and terminal classification. Native execution adapters validate actual provider, lease/fence, evidence, schema, usage and current authority before applying selected state. A claim selects leased work and requires fresh authority; it does not establish dispatch. Positive effect completion requires a dispatch heartbeat. Cancellation preserves an actual later result, and unknown work remains unclaimable until separately justified reconciliation. The model compares every declared state/action pair and all two-step traces; actual lease/provider/persistence tests qualify the separate bridge. A supplied `lost` or `observed` signal is not evidence that loss or an outcome occurred.

## Numbers and representations

The native JSON boundary supports finite IEEE-754 binary64 numbers. The codec preserves their order using two unsigned 32-bit limbs, including fractions, subnormal values, negative numbers and both representations of zero. It does not narrow JSON values to Float32 or pass a 64-bit order key through Bend's JavaScript-host `Nat` representation. Native calendar parsing supplies comparable instants in the same millisecond frame; resource comparison does not change units or frames.

Conditions distinguish true, false and unknown evidence. Malformed query output remains unknown, and an unresolved deny blocks a matching permit. The native traversal retains ordered observations and applies the bounded core decision before invoking a query. A missing observation cannot become authority through negation.

## Qualification

`pnpm build:core` compiles with the pinned Bend release. `pnpm check:core` checks source/output coherence without installing tools or invoking inference. `pnpm test:proof` requires explicitly installed formal tools: it checks Bend's separate kernel verdict, runs the Lean model, audits the declared theorem dependencies and compares the finite model cases with the generated/native consumer. Its output states the exercised scope and assumptions.

`core/LAWS.bend` owns Bend law statements and `core/PROOF.bend` supplies their implementations. `proof/Moment.lean` owns the selected Lean model statements and executable correspondence cases. Its explicit axiom-audit declarations identify the claims being checked. Missing audits, incomplete proofs, warnings and dependencies outside the stated standard axiom set refuse qualification. A helper theorem or model outside this declared claim set is not certified by the report.

The finite truth/support comparison exhausts its named input domains. Numeric execution tests compare the actual native and generated representations over selected boundary and generated values. Neither establishes arbitrary external effects, unbounded native arithmetic, freeform model meaning or compiler correctness. Bend's type-theory translation and emitted JavaScript remain explicit trust boundaries; the Lean kernel checks its stated propositions, not their applicability to every program behavior.

Use the [authority contract](authority.md) for acceptance and delegation. A proof report is attributable evidence bound to inputs and a consumer. It cannot change the policy used to admit itself. Preserve old statements and claims when creating a new identity or qualified successor; reading or verifying a candidate does not activate it.

Moment owns its production definitions, codecs, laws and conformance here. The earlier sibling `rules/moment` models are historical experiments and comparison material, not a second canonical runtime or a dependency of fresh clones/packages. Preserve their claims and limitations when redirecting them; do not advance a stale source gate without actual correspondence. Generic cross-project lemmas may remain with their existing owner.
