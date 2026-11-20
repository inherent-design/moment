# Contributing

Moment is a local Node service, CLI, typed client and MCP integration. Read [AGENTS.md](AGENTS.md), the [documentation map](docs/README.md) and the owner of the boundary you intend to change. Proposed evolution contracts are separate from installed behavior.

Use the pinned mise/Node/pnpm toolchain, `pnpm install --frozen-lockfile` and `pnpm check`. Formal changes additionally require `pnpm setup:formal`, `pnpm build:core`, `pnpm test:proof` and regenerated bindings. Follow [verification](docs/development/verification.md) for package/native/security consumers. Keep checks independent of personal credentials and stores; do not test against the owner's daemon or sessions.

Keep one contract owner, meaningful positive/negative cases and attributable source/proof scope. Preserve existing identities, independent support, exact retry and uncertain outcomes. Use small focused changes, retain unrelated edits and explain actual checks and limitations. Dependency, patch and toolchain procedures live in [dependencies](docs/development/dependencies.md).

Use GitHub issues for ordinary defects with reproducible behavior and sanitized versions/commands. Follow [security reporting](SECURITY.md) for sensitive findings. Do not attach credentials, personal stores, raw sessions or large private captures. Publishing and installation follow the separately authorized [release procedure](docs/development/releasing.md).
