# Verification

The `0.1` contract baseline and first storage implementation were checked on November 12, 2026, using macOS arm64, Node.js 26.13.0, npm 11.20.0, TypeScript 7.0.2, and built-in SQLite 3.54.0. The public daemon, policy kernel, scheduler, and agent integration remain unimplemented.

## Storage execution evidence

`node --test test/*.test.mjs` passed eleven tests against temporary directories and actual SQLite databases. `test/store.test.mjs` exercises atomic state/event/receipt/outbox persistence, reopen in a new process after closing the original connection, exact retries, conflicting retries, full rollback on identity conflict, historical snapshots, independently withdrawn support, two competing child processes, rollback after a child receives `SIGKILL` inside a transaction, and system-scoped bootstrap retry identity. Canonical JSON tests reject nonfinite values, unsupported objects, sparse arrays, and unpaired Unicode surrogates.

`test/home.test.mjs` exercises existing directories, aliases, explicit overrides, dangling links, unsupported bootstrap versions, exact-byte import preservation, changed-input rejection, and path/symlink escape refusal. Import does not activate an incident or create a runtime context. `test/projects.test.mjs` creates actual Git repositories, a clone, and a linked worktree to exercise shared identity, unresolved clone hints, and an explicitly confirmed moved locator. The first home test run exposed an incorrect test expectation about macOS `/var` canonicalization; the assertion now compares canonical paths as the storage contract requires.

These tests establish the storage portion of E1, E2, E3, E6, and E12. They do not establish public API admission, OS sandboxing, power-loss durability, cancellation, or external effect reconciliation. The backend is trusted internal code; untrusted input must pass the pending kernel before reaching it.

## Executed checks

| Command or check | Outcome | Evidence scope |
| --- | --- | --- |
| `npm install --ignore-scripts --no-audit --no-fund` | Passed; exact dependency lock created. | Compiler and native platform package installed with lifecycle scripts disabled. |
| `npm ci --ignore-scripts --no-audit --no-fund` | Passed. | Clean reinstall from the committed dependency-lock candidate. |
| `npm run check` | Passed after correcting the documentation checker. | Strict declarations, seven expected type errors, 17 Markdown documents, local links, and 44 documented methods. |
| `node --check scripts/check-docs.mjs` | Passed. | Check script parses on the tested Node version. |
| Temporary broken-link probe | Rejected as expected. | A link to a nonexistent local file produced a nonzero checker exit; the temporary file was removed. |
| Temporary method-drift probe | Rejected as expected. | Replacing one declared method's table entry with an undeclared name produced both coverage errors; original bytes were restored. |
| Central intent inspection | Passed. | Saved text, context/project references, home alias, readable intent alias, and rewritten local document links resolve. No goal was activated. |
| `git diff --cached --check` | Passed. | Initial staged baseline has no Git whitespace errors. |

The first documentation-check attempt assumed a JavaScript compiler API unavailable in the installed TypeScript package. Type checking passed in that attempt; the documentation check failed. The corrected checker reads the explicit method declaration convention directly and passed its positive and negative checks. This finding does not affect the proposed runtime contracts.

## Tested source identifiers

The original contract-baseline checks exercised these SHA-256 source identities. The dependency lock subsequently gained the runtime's Node engine requirement. Current runtime snapshots are identified by Git and the central task checkpoint.

| File | SHA-256 |
| --- | --- |
| `contracts/index.ts` | `b53bea8e3851691420111175730fd3fe44545259d615a4de549ae15f73c7cc90` |
| `contracts/examples.ts` | `a519e89b5668673d68d2f42613d70852b61d6cc3c4a444e3838f0ed8e629ab4f` |
| `scripts/check-docs.mjs` | `8a1f81e371fe6e06c28f35672e5353ec91d1da3500b24b2dec72e19b47d5820f` |
| `package-lock.json` | `2090e2e610f68292d11b6e1bb98936d78c1ce2dd1d3d291c085ca33dd6d0aeb8` |

## Check scope

`npm run check:types` compiles all declarations and usage examples with strict TypeScript settings. Seven negative examples require the compiler to reject unguarded mutation, generic policy activation, invented success, forged caller identity, executable policy, unsupported replay justification, and mismatched method parameters.

`npm run check:docs` checks local document links, Markdown anchors when present, balanced fenced blocks, trailing whitespace, titles, and a one-to-one mapping between declared methods and protocol table entries. It does not validate external website availability or prove that prose and code have identical semantics.

The acceptance scenarios in [implementation](implementation.md) remain overall completion obligations. Storage execution evidence above covers their specified storage portions. Policy evaluation, sandbox isolation, provider execution, and Codex invocation are not proven by compiling declarations or passing the storage suite.
