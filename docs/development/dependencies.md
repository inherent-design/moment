# Dependencies and patches

The repository has one direct development dependency: TypeScript, pinned exactly in `package.json` and resolved in `package-lock.json`. Node.js 26.13.0 or later supplies the runtime and built-in SQLite binding; npm supplies dependency installation. No external database driver, model SDK, policy engine, or VM provider is installed.

## Updates

Review the upstream release notes and compatibility of a candidate before changing the exact version. Update the lockfile with lifecycle scripts disabled unless a specific required script has been inspected and admitted. Run `npm ci --ignore-scripts`, `npm run check`, and inspect lockfile and generated-file changes. Record the actual compiler and Node versions in verification. Do not infer compatibility from a successful install alone.

When introducing a runtime dependency, document its consumer, version, platform constraints, update command, coupled adapters or schema formats, and meaningful revalidation. A storage engine update requires actual reopen, migration, and recovery tests. An agent SDK or app-server change requires the exact affected protocol and integration cases. A sandbox update requires renewed boundary tests on its supported host.

## Owned patches

There are currently no owned dependency patches. Before adding one, record the upstream version and issue, patch purpose, affected consumers, application mechanism, tests, and removal condition. Keep patches reviewable and scoped; do not hide vendored changes in generated lockfile noise. Rebase or remove them explicitly during an upstream update, and preserve any needed compatibility migrations.

## Release preparation

Before a future release, verify repository privacy and licensing intent, check all advertised methods against implemented ones, run relevant integration and recovery checks, and review migration and rollback procedures. A contract version and a runtime release version are separate. Publishing a package, pushing commits, deploying a daemon, or spending on infrastructure requires the applicable authorization; dependency maintenance itself does not imply those actions.
