# Verification

The `0.1` contract baseline was checked on November 12, 2026, using macOS arm64, Node.js 26.13.0, npm 11.20.0, and TypeScript 7.0.2. Runtime behavior in the reference documents remains unimplemented.

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

The checks above exercised these SHA-256 source identities. Documentation-only completion records may change without changing these inputs.

| File | SHA-256 |
| --- | --- |
| `contracts/index.ts` | `b53bea8e3851691420111175730fd3fe44545259d615a4de549ae15f73c7cc90` |
| `contracts/examples.ts` | `a519e89b5668673d68d2f42613d70852b61d6cc3c4a444e3838f0ed8e629ab4f` |
| `scripts/check-docs.mjs` | `8a1f81e371fe6e06c28f35672e5353ec91d1da3500b24b2dec72e19b47d5820f` |
| `package-lock.json` | `2090e2e610f68292d11b6e1bb98936d78c1ce2dd1d3d291c085ca33dd6d0aeb8` |

## Check scope

`npm run check:types` compiles all declarations and usage examples with strict TypeScript settings. Seven negative examples require the compiler to reject unguarded mutation, generic policy activation, invented success, forged caller identity, executable policy, unsupported replay justification, and mismatched method parameters.

`npm run check:docs` checks local document links, Markdown anchors when present, balanced fenced blocks, trailing whitespace, titles, and a one-to-one mapping between declared methods and protocol table entries. It does not validate external website availability or prove that prose and code have identical semantics.

The acceptance scenarios in [implementation](implementation.md) are future runtime obligations, not passing tests in this baseline. No storage recovery, policy evaluation, sandbox isolation, provider execution, or Codex invocation has been tested by compiling the declarations.
