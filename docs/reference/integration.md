# Hosts agents and system exchange

Adapters connect Moment's governed operations to concrete execution platforms. An advertisement describes a possible capability; current evidence, permission, capacity, and provider authentication determine whether it can execute.

## Capability negotiation

`capability.advertise` binds the advertisement to the authenticated provider. Names, explicit supported versions, schema digests, required features, and acceptable isolation kinds must match a `CapabilityRequirement`. Version strings are exact values in `0.1`, not implicit semantic-version ranges. An advertisement expires and must be refreshed by publishing a new immutable advertisement ID. Old execution intents retain their exact reference but require a still-valid compatible admission before dispatch.

`capability.match` returns eligibility and unmet requirements. Capability fit and permission are separate checks. The caller selects a candidate; the scheduler rechecks it when claiming and dispatching. An imported advertisement is evidence about a remote capability, not an installed local provider or permission to contact it. Peer configuration binds actual providers to authenticated endpoints.

The implemented registry retains at most 4,096 advertisements per context, forbids names colliding with protocol methods, and validates exact input/output schema references. Publication cannot impersonate another provider. Grant actions may name an advertised capability; publication does not add that action to the active policy. A caller still needs both the explicit action permit and a grant covering the advertisement and incident before queueing work.

Matching considers authorized advertisements of the requested name, reports exact version/schema/feature/isolation mismatches, and orders eligible candidates before unknown and ineligible ones before applying the result limit. Its optional `incidentId` supplies incident-specific admission context. Without it, an incident-restricted grant produces unknown eligibility. Delegates can match only their bound grant. Matching reserves no resources and authenticates no external implementation; claims recheck the exact advertisement, execution grant, policy, input schema, and incident state.

## Host adapter

`HostPort.inspect` reports observed platform and resource measurements with units, timestamp, and source. Missing measurements stay unknown. Memory, disk, CPU, available subscription quota, and billed usage must not be invented from guessed token counts or previous snapshots.

`HostPort.execute` receives the execution, admitted grant, and policy reference. The adapter resolves resource references to installed resource descriptors. A filesystem descriptor binds canonical roots, permitted read/write operations, and symlink handling; a process descriptor binds an executable or command template, argument schema, working-directory roots, allowed environment names, network policy, and output limits. Descriptor changes require admission and an updated reference. An agent-supplied shell string cannot substitute for an admitted descriptor.

Resolve paths and mounts at dispatch, then enforce them with the strongest available host mechanism. A directory label or Git worktree is not a sandbox. `isolation: none` explicitly represents host execution; policy decides where that is acceptable. Container and VM providers must establish actual boundaries through execution tests. Graphical execution is a capability using a display/browser endpoint inside its admitted environment; it is not part of the core scheduler.

Dispatch uses a durable execution ID as the external idempotency identity when the provider supports one. Fencing tokens stop stale workers only where the provider or adapter can enforce them; they cannot revoke an arbitrary external process by themselves. Cancellation and reconciliation follow [reactions](reactions.md). Model output, stdout, screenshots, and traces enter as attributed observations with bounded artifacts.

Host and agent adapters return an `ExecutionReport` containing exact attempt, outcome, and cumulative usage. Reconciliation returns a `ReconciliationReport` with attempt, resolution, and usage. The adapter retains discriminating receipts and submits them through the ordinary finish or reconciliation API. Advertisement and kernel state-machine support are implemented; automatic provider dispatch and a concrete bounded verifier remain implementation work.

## Agent adapter and prompts

`AgentPort.invoke` receives a prompt artifact, execution, and grant. The prompt contains the intent, selected evidence, admitted actions, output schema, current constraints, and continuation references. It can request a proposal or observation, not directly write privileged store state. Tool use within an invocation must pass through the same adapter admission or be bounded by the host's independently configured permissions.

`prompt.compose` is deterministic rendering. Its template is an admitted `moment.prompt-template` atom whose value contains a UTF-8 `text` string and an ordered `sourceSlots` array. Each slot is a unique identifier matched to the corresponding entry in `sourceRefs`. Templates use only `{{slot}}` replacement with the canonical JSON representation of the authorized source; no expressions, includes, filesystem reads, or executable evaluation. Unknown or missing slots are invalid. Trusted template instructions and quoted evidence occupy separate named sections. Retrieved evidence cannot redefine the surrounding instructions.

The template defines optional slots explicitly with an `optionalSlots` array. If the final UTF-8 content exceeds `maximumInputBytes`, omit optional slots from last to first, replacing their marker with `[omitted]`, and report their references in `omittedRefs`. Required content that still exceeds the budget returns `LIMIT_EXCEEDED`. The digest covers the exact rendered content, template reference, sources, omissions, and output schema. This is a byte bound, not a tokenizer estimate.

Prompt selection can begin as policy over context, evidence gaps, recent outcomes, and capacity. Model-assisted template generation is an ordinary bounded execution; its output is a candidate template requiring schema and policy admission. There is no mandatory sequence of brainstorm, research, review, and finalize modes. Select behavior because it addresses the current condition, and retain evidence needed to evaluate whether that choice helped.

## Codex boundary

The first integration direction is a local client or MCP adapter for Moment, alongside native Codex usage. A later app-server adapter can manage explicitly assigned threads and goals. Official app-server documentation exposes thread, turn, and goal operations; an implementation must generate or inspect the schema of the installed Codex version and qualify the exact methods it uses. Private internal agent tools are not assumed to be an external API. [Codex app server](https://learn.chatgpt.com/docs/app-server)

Keep Codex authentication within supported Codex flows. Subscription usage and separately billed API labor remain different budgets; using a daemon does not provide unlimited inference. Full-approval Codex operation is owner-reported host configuration, not evidence that a sandbox exists. Moment's narrower execution policies govern admitted Moment operations; direct host tools retain their actual host authority.

Real Codex verification uses a dedicated app-server process, never the owner's primary managed daemon. A direct `codex app-server --listen stdio://` process supplies a private pipe transport. Its child environment selects a separate Codex state root, and its working directory is a disposable test workspace. Do not use the managed daemon's proxy, default control socket, shared writable configuration, or primary sessions. The installed binary can be read and executed without modification; record its actual version and qualify the installed protocol. Protocol initialization can be tested without logging in. Live inference additionally needs a supported independent authentication path that does not rotate or rewrite the primary session. [Codex environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables)

Saved goal text is reusable input. Creating a file does not activate a Codex goal or schedule an agent. A user can explicitly point `/goal` at the central intent file when ready. [Using goals in Codex](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex)

## Messages and awareness

Messages carry a bounded summary and detail references so participants can discover relevant work without loading all histories. Initial limits are 8 KiB of UTF-8 summary text and 32 detail references. Sender identity is recorded by the service. The recipient must be admitted to the incident; reading a message still rechecks access to its referenced details. A response names the request in `inReplyTo` and has its own ID and provenance.

Delivery is at least once. Exact send retries use the mutation key; recipients deduplicate message IDs. Acknowledgment records delivery processing, not agreement, successful work, or permission to act. Expired messages remain auditable but no longer request new work. Detail retrieval uses ordinary authorized query or artifact operations. Mailbox reads cannot enumerate another principal's messages without a separately admitted administrative operation, which is outside `0.1`.

## Exchange between systems

An `ExchangeBundle` contains selected immutable records and assertion states from one source context and revision. Export checks permission for every included element and reference disclosure. Limit bundles to the transport frame size; split larger transfers into independent bundles with distinct IDs. The digest uses canonical JSON excluding the digest field itself. A digest detects content changes but does not authenticate a peer.

Import authenticates the peer through installed configuration, verifies the bundle digest, and checks its declared source system. Retain foreign references unchanged and record a local import receipt binding peer, bundle, and admission revision. Local policy decides whether imported assertions contribute evidence. They cannot create local grants, replace policy, activate rules, launch executions, or declare themselves trusted. Unknown referenced records remain unresolved and cannot satisfy a condition requiring resolved evidence.

The same `(sourceSystemId, bundle.id)` with identical content is deduplicated; different content is an identity conflict. Local edits never rewrite foreign assertions. A later withdrawal is a new imported state supported by the authenticated source and ordered by its source revision; an older bundle cannot restore newer withdrawn support. Equal-revision contradictory states are rejected. Cross-system atomic commits and automatic transitive trust are outside this contract.
