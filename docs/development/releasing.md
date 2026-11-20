# Public package releases

Moment is published as `@inherent.design/moment` under Apache-2.0 from `inherent-design/moment`. Preview versions use the `preview` dist-tag. Publishing a package does not install it into Codex, enroll sessions or migrate the personal store.

Use the pinned Node and pnpm versions through mise. Keep package metadata, dependency lock, executable CLI and source catalog aligned. Regenerate bindings after changing any catalog source. The runtime validates the exact packaged source bytes, including `package.json`; use `pnpm pack --skip-manifest-obfuscation` and preserve the manifest's packed formatting, including its lack of a final newline. Package managers omit the root lockfile, so generation retains its exact bytes in `runtime/generated/source-lock.yaml`; the runtime uses that copy only when the root file is absent. An existing changed checkout lockfile still refuses startup. Never disable validation to make an archive start.

Before release, run:

```sh
pnpm install --frozen-lockfile
pnpm generate:bindings
pnpm check
pnpm check:package
```

The package check packs the candidate into ignored `dist/`, checks every catalog source in the extracted archive, and installs the exact tarball with production dependencies in a test-owned recipient. It exercises executable/offline discovery, the authenticated local service and typed client, MCP discovery/calls and a separate TypeScript consumer. Its state and processes are isolated from the personal store and primary Codex. No inference credentials are required. It records tarball identity and qualification in `dist/package-verification.json`.

Review the final source diff and archive inventory. Exclude personal state, credentials, sessions, raw runs and unrelated files. Commit the qualified source, publish it to the intended repository and create a matching immutable `v<package-version>` tag. The tag-triggered release workflow repeats the required checks on a fresh runner, then publishes its qualified tarball using the organization publisher. Credentials are available only at the publishing step. The broader CI, security and dependency-maintenance evolution remains owned by the separate repository-polish intent.

The publisher requires npm authentication and may require maintainer two-factor approval according to the actual npm account/package policy. A refused or uncertain publication must be reconciled against registry state before retrying. Staged publishing, if used explicitly, retains the same qualified tarball and still requires maintainer approval; staging is not public release completion. Keep the exact request, version, archive digest and observed registry outcome. Never paste a token or recovery secret into a goal, capture or issue.

After publishing, verify the registry's version, `preview` tag and `dist.integrity` against the qualified archive, then perform an independent registry installation. A successful local pack or workflow upload is not enough. Keep release evidence attributable to the source revision and actual platform; Unix service checks do not establish Windows support or qualify the optional Darwin clone adapter on Linux.

Updating an installed checkout, daemon or MCP bridge is a separate controlled operation. Inspect the current source/catalog, in-flight work and custody; retain recovery evidence, then reload only the affected Moment components and verify readback. Do not restart the owner's Codex/TUIs, replace peer goals or restore an older database over newer writes. Existing integrations keep their selected installation until explicitly changed.
