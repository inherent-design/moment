# Dependencies and patches

The manifests and `pnpm-lock.yaml` own JavaScript versions. `packageManager` pins pnpm 12.18.0; `mise.toml` pins the matching pnpm executable and Node.js 26.13.0, which supplies the built-in SQLite binding. TypeScript remains the contract compiler. Ajv 8.20.0 is present for the kernel's in-progress JSON Schema validation; its presence alone does not establish public API validation.

## Setup and updates

Run `mise install`, `mise run setup`, and `mise run check`. The tasks delegate to `pnpm install --frozen-lockfile` and `pnpm check`; the equivalent pnpm commands work when the pinned tools are already on PATH. `mise run test` runs the runtime suite. Keep additional native tools in mise rather than documenting untracked manual installs. Personal overrides belong in ignored `mise.local.toml` files. The optional `mise.secrets.toml` profile is loaded only when the `secrets` environment is selected. [mise configuration](https://mise.jdx.dev/configuration)

Review upstream release notes and compatibility before updating exact pins. Use pnpm for dependency and lockfile changes, then run frozen installation and the affected checks. Do not generate a competing npm lockfile. `pnpm-workspace.yaml` disables implicit dependency repair during script execution and lifecycle scripts during installation; explicitly review any future dependency that requires a build before admitting a narrow exception. Record tool versions and actual results in verification. [pnpm settings](https://pnpm.io/settings)

The project disables mise's automatic upgrade pruning. Do not run global upgrades or prune shared installations as part of project setup. Node changes require actual SQLite reopen, interruption, and competing-writer tests; changing a manifest's engine range alone proves no runtime compatibility. For a new native tool, document its consumer, exact version, installation path assumptions, and meaningful revalidation. Keep agent protocol and sandbox updates coupled to their real integration and boundary checks.

## Private information

Moment currently has no encrypted private configuration. When a concrete consumer needs private data in Git, use SOPS with age rather than plaintext, including if the repository later becomes public. Select intended owner-controlled public recipients and add a narrow `.sops.yaml` creation rule for `secrets/<purpose>.enc.json` or encrypted YAML. Keep private age identities and recovery copies outside the checkout. SOPS configuration carries public recipients, not private decryption keys. [SOPS configuration reference](https://getsops.io/docs/reference/)

Use `MISE_ENV=secrets mise install` to obtain pinned SOPS 3.13.3 and age 1.3.2 when needed. Before relying on a real encrypted file, test a disposable synthetic encrypt/decrypt round trip and refusal with a wrong key; verify recipient and recovery access for the intended custody separately. Do not copy sibling projects' credentials. Editing, decrypting, or loading a private value must be an explicit operation, with only the consumer's required fields passed to its process. Ordinary checks must not require credentials or decrypt a whole account environment. Keep plaintext, temporary decrypted files, private identities, logs, and captured session material out of Git. Record consumers, rotation, recovery, and remaining live-use checks beside the owning operation.

## Owned patches

There are currently no owned dependency patches. Before adding one, record the upstream version and issue, patch purpose, affected consumers, application mechanism, tests, and removal condition. Keep patches reviewable and scoped; do not hide vendored changes in generated lockfile noise. Rebase or remove them explicitly during an upstream update, and preserve any needed compatibility migrations.

## Release preparation

Before a future release, verify repository privacy and licensing intent, check all advertised methods against implemented ones, run relevant integration and recovery checks, and review migration and rollback procedures. A contract version and a runtime release version are separate. Publishing a package, pushing commits, deploying a daemon, or spending on infrastructure requires the applicable authorization; dependency maintenance itself does not imply those actions.
