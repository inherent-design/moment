# Personal store and project identity

Moment keeps active intent and runtime state in one user-owned store. The user-facing entry point is `~/.moment/`; the default backing location is `~/.local/share/moment/`. These are two paths to the same data, not stores to synchronize.

## Discovery and relocation

Resolve the store in this order: an absolute `MOMENT_HOME` value, an existing `~/.moment` directory or resolvable symlink, then the default backing directory. Reject relative overrides, dangling links, and inaccessible destinations with an actionable error. Expand `~` in user-entered configuration before validating, without shell evaluation. Canonicalize the selected path once and display it in diagnostics.

First-time setup creates the selected store with user-only permissions and creates `~/.moment` as a symlink if that name does not exist. If an existing alias resolves elsewhere, preserve it and report the mismatch; an explicit override can still select another store for that process, but setup must not repoint the alias implicitly. Existing directories are never replaced by links. Native Windows implementations must use an explicit supported directory or junction strategy; this initial Unix-host layout does not claim Windows installation support.

Relocation copies or moves the complete store while writers are stopped, verifies manifest and database integrity, and updates the alias through an explicit operator action. Stable IDs remain unchanged. Restoring a backup on a second simultaneously running host requires a new system ID and an import procedure to avoid two independent writers claiming one identity.

## Layout

```text
~/.moment/                         user-facing directory or link
  registry.json                    store version, system ID, project locations
  contexts/<context-id>/manifest.json
  intents/<readable-name>.md        optional link to an incident's intent
  incidents/<incident-id>/
    manifest.json                  identity, context, projects, activation state
    intent.md                      readable purpose and completion contract
    checkpoint.json                current continuation state
    captures/                      selected attributable evidence, when needed
  runtime/                         future database, socket, and writer ownership
  artifacts/sha256/<digest>        future immutable admitted artifact bytes
  cache/                           regenerable bounded material
```

Only registry, context manifests, incident manifests, intent, checkpoints, and a readable intent link are used by the initial documentation bootstrap. `runtime`, artifact storage, and cache are future runtime concerns. The bootstrap files are not evidence of a running service or executed goal. Readable intent links are convenience aliases; they resolve to the incident's canonical file, preserve its identity, and must not overwrite an existing name.

## Bootstrap file contract

Every JSON file has `formatVersion: 1`. Unknown versions are refused rather than silently reinterpreted. All relative paths in manifests are confined to their incident directory after symlink resolution. Write replacements through a temporary file and atomic rename; serialize writers. The future runtime must import these files explicitly before assuming ownership, retaining their original bytes and an import receipt.

| File | Required fields and interpretation |
| --- | --- |
| `registry.json` | `systemId`, `projects`. Each project has `id`, `label`, `locations`, `origins`, and `contextIds`. Each location has `path` and `kind: git-worktree` or `directory`. |
| Context manifest | `id`, `label`, `projectIds`. Defines an association for saved intent; it does not instantiate a runtime `Context` or bootstrap authority. |
| Incident manifest | `id`, `contextId`, `projectIds`, `kind`, `contentPath`, `checkpointPath`, `status`, `activation`. `status` is `draft`, `ready`, or `archived`; `activation` is `manual`. These describe saved input, not runtime incident lifecycle. |
| Checkpoint | `stage`, `completed`, `next`, `blocker`. Optional `revision`, `evidence`, and `decisions` retain exact relevant identifiers. `completed` is an array of concise outcomes; `blocker` is a string or null. |

`intent.md` owns the active text. A tracked reusable template can seed it, but changes do not synchronize automatically in either direction. An optional manifest `sourceTemplate` object records the template's absolute `path` and `sha256` digest of its original bytes; relative links in the saved copy are resolved against that template's directory. The central store's format makes it possible to import the intent into a later Moment runtime without installing metadata in every repository. Saved content always enters that runtime as attributed input, not bootstrap policy.

## Project identity

A central UUID identifies each registered project. Paths are current locators. Git origins are discovery hints and may change, be absent, contain aliases, or identify several clones. A worktree belongs to a registered repository association while retaining its own locator. A branch name is not a stable project ID. Neither path ownership nor origin matching grants write authority.

On discovery, match a known canonical location first, then inspect Git repository/worktree identity and normalized origins for candidates. Multiple plausible matches remain unresolved until existing evidence or user guidance distinguishes them; never merge projects solely because their origin matches. Moves can update locators without changing identity after confirming the association. Copying a repository does not copy Moment authority.

Touched repositories need no `.moment` directory, `.git/goals`, marker, hook, or generated `AGENTS.md` section. Existing project instructions remain in force and can be referenced as evidence with revision and digest. Moment's own repository retains reusable documentation and contract examples.

## Runtime persistence and retention

The first runtime uses one SQLite writer, a durable event/outbox log, and explicit versioned migrations. Configure and test actual durability settings on the supported filesystem; a successful transaction test does not prove power-loss behavior. Backups must capture a consistent database snapshot, referenced artifacts, schema version, and system identity. Restore checks integrity before admitting effects, then reconciles leases and unknown outcomes.

Live intent, current continuation state, unacknowledged messages, idempotency receipts, unresolved effects, active grants, and evidence supporting accepted claims are retained. Raw logs and caches have bounded retention profiles. Cleanup previews candidates with dependency reasons and removes only admitted, unreferenced, regenerable or explicitly expired material. Content deduplication does not erase independent evidence. Secrets are kept in host credential custody and referenced indirectly; they are not stored in goals or ordinary artifacts.

Generated review notes should be folded into their owning contract or checkpoint. Retain useful failure inputs and concise results instead of repeated full transcripts. Storage pressure may suspend new artifact-producing activity; it must not trigger deletion of recovery material or silently discard accepted work.
