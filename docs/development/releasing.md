# Public package releases

Moment publishes `@inherent.design/moment` under Apache-2.0 from `inherent-design/moment`. Preview releases use the `preview` dist-tag. Publication does not install MCP, enroll sessions, activate goals or migrate a personal store. Apply current user authorization at publication and rollout boundaries.

## Qualify source and exact bytes

Use the pinned Node/pnpm toolchain and frozen graph. Review the complete source diff, package inventory, private-data boundary and applicable migration/recovery evidence. Covered semantic changes require a rebuilt core, separate proof verdict/audit/correspondence and refreshed bindings. Ordinary checks perform no inference.

```sh
pnpm install --frozen-lockfile
pnpm build:core
pnpm test:proof
pnpm generate:bindings
pnpm check
pnpm test:integration
pnpm test:codex-protocol
pnpm test:codex-mcp:protocol
pnpm check:package
pnpm check:release
mise -E security exec -- pnpm check:ci
pnpm check:renovate
mise -E security exec -- pnpm security:scan
```

Formal and optional security tools must be installed explicitly before their checks. Native protocol/installer checks use an installed read-only Codex binary and owned state. Live inference is separate and necessary only for an unqualified affected provider/profile boundary. See [verification](verification.md) for coverage and limitations. New sources and unresolved failures require affected revalidation; a source pin alone is no proof result.

Commit the reviewed source and generated outputs before package qualification. The package checker requires a clean tracked checkout, compares actual bytes and executable modes with immutable Git blobs, and checks every packed file against that frozen revision. Untracked files included by the package whitelist refuse qualification. Unrelated untracked files outside the archive do not enter the receipt.

The checker creates `dist/`, verifies every catalog source, installs the exact archive into a fresh production-only recipient and exercises CLI/offline discovery, shared service, MCP/client calls, retirement and an independent typed consumer. It rechecks the source after those operations and records the source revision/tree/file digests, platform, catalog, inventory and results in `dist/package-verification.json`. Suite and recipient HOME/CODEX_HOME remain isolated from the owner. Offline discovery must create no service state.

The runtime verifies exact source bytes. Use `pnpm pack --skip-manifest-obfuscation` and preserve the manifest's packed formatting, including no final newline. Generation retains the otherwise omitted root lock in `runtime/generated/source-lock.yaml`; fallback is permitted only when the root lock is absent. A changed existing lock still refuses. Never disable integrity checks to make packaging pass.

## CI and publication

`checks.yml` owns fresh Linux/macOS runtime/package/native qualification, Linux formal rebuild/proofs and security/dependency checks. PR jobs have read-only repository permissions and no publication credentials. `security.yml` also runs independently on its schedule. Quick checks are diagnostic subsets; workflow validation does not establish runner success.

The release workflow calls that complete qualification once, then downloads its exact Linux-qualified archive and receipt. `scripts/publish-package.mjs --check` binds package name/version/license, catalog, inventory count, SHA-256, SHA-512, byte length, qualification-script digest and the actual clean source revision. Changed checks, implementation or documentation require requalification even when archive bytes match. It refuses stale or substituted inputs and never rebuilds the artifact. Publication also resolves `v<package-version>` to the qualified commit and checks the workflow commit when supplied. A matching tag name alone is insufficient.

A manual branch dispatch qualifies without publishing. After actual required checks pass and publication is authorized, publish source and create the matching tag. Only the publisher job has OIDC provenance permission; npm authentication is passed only at its publishing step. Fork/ordinary PR jobs never receive publishing credentials. A normal update or green dependency PR grants no publication authority.

Npm can accept an upload before its scanning makes the version installable. The publisher waits up to 15 minutes. On refusal or uncertainty, retain exact version, digest and observed outcome, then reconcile registry state before retrying. Never republish an already accepted version merely because availability is pending. A stage or GitHub prerelease is not a completed public npm release. If actual account policy requires maintainer approval, retain the concrete qualified artifact and required action without implying publication succeeded.

Verify the public version/dist-tag and registry integrity against the qualified artifact, then perform an independent registry installation. Keep provenance and workflow receipts attributable to the actual source/platform. macOS/Linux service checks imply no Windows support; optional Darwin cloning has separate evidence. No credential, personal store, session or large private capture belongs in a public artifact or workflow output.

## Local rollout

Inspect current source/catalog and in-flight Moment work. Retain exact preconditions, recovery evidence, credentials and uncertain requests. Preview any actual store-format conversion and rehearse its all-history readback/recovery on an isolated copy. Pure source changes do not require reinitializing data or inventing a new format.

Install the qualified artifact/selected checkout, reconcile only the owned MCP configuration and cut over Moment with matching source/catalog identity. Test work remains in owned processes; production reload is a separately authorized operator action. Preserve peer goals and active work. Never restore an old database over newer admitted writes.

Use the supported configuration/MCP refresh where qualified and verify actual loaded catalogs plus selected domain reads in the intended threads. Reload acknowledgments alone prove no tool availability or hook execution. Hook definitions/trust and enrollment are independent. Restart only the necessary authorized components; do not restart primary Codex/TUIs merely for tests or edit peer goals. Retain the final installation and live-read receipts separately from public publication evidence.
