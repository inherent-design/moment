/** Moment 0.1 draft. Shapes are normative; reference documents own semantics. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Id = string;
export type Digest = string;
export type Revision = number;
export type Instant = string;
export type Cursor = string;

export interface Ref {
  systemId: Id;
  contextId: Id;
  id: Id;
}

export interface SchemaRef {
  name: string;
  version: string;
  digest: Digest;
}

/** Every write is scoped to one context revision and one durable retry identity. */
export interface Mutation {
  contextId: Id;
  expectedRevision: Revision;
  idempotencyKey: string;
}

export interface Read {
  contextId: Id;
  atRevision?: Revision;
}

export interface Page<T> {
  items: T[];
  snapshotRevision: Revision;
  nextCursor?: Cursor;
}

export interface Evidence {
  sources: Ref[];
  method: string;
  artifactDigests: Digest[];
}

export interface Atom {
  kind: "atom";
  id: Id;
  schema: SchemaRef;
  value: Json;
}

export interface Relation {
  kind: "relation";
  id: Id;
  schema: SchemaRef;
  roles: { [role: string]: Ref[] };
}

export type SemanticRecord = Atom | Relation;

/** Independent support for a record; multiple assertions may support one record. */
export interface Assertion {
  id: Id;
  record: Ref;
  evidence: Evidence;
  validDuring?: Ref;
}

export interface Stored<T> {
  value: T;
  ref: Ref;
  digest: Digest;
  recordedAt: Instant;
  recordedBy: Id;
  revision: Revision;
}

export interface AssertionState {
  assertion: Stored<Assertion>;
  status: "asserted" | "withdrawn";
  withdrawnAtRevision?: Revision;
}

export interface Selector {
  ids?: Id[];
  schemaNames?: string[];
  relatedTo?: Ref;
  relationRole?: string;
  assertionStatus: "asserted" | "withdrawn" | "any";
}

export type Change =
  | { kind: "record.put"; record: SemanticRecord }
  | { kind: "assertion.put"; assertion: Assertion }
  | { kind: "assertion.withdraw"; assertionId: Id; reason: string };

export interface Commit {
  transitionId: Id;
  contextId: Id;
  previousRevision: Revision;
  revision: Revision;
  eventIds: Id[];
}

export interface Limits {
  concurrentExecutions: number;
  cpuMillis: number;
  memoryBytes: number;
  outputBytes: number;
  modelTokens: number;
  apiSpendMicrounits: number;
  currency: string;
  deadline?: Instant;
}

export interface Context {
  id: Id;
  systemId: Id;
  label: string;
  revision: Revision;
  state: "open" | "closed";
  policy: Ref;
  limits: Limits;
  imports: Ref[];
}

export interface Incident {
  purpose: string;
  completionCriteria: string[];
  status: "open" | "resting" | "completed" | "cancelled";
  continuation: Ref[];
}

/** Binding values are supplied by the trusted evaluator, not arbitrary caller claims. */
export type Operand =
  | { kind: "literal"; value: Json }
  | { kind: "binding"; name: string };

export type Condition =
  | { kind: "all"; terms: Condition[] }
  | { kind: "any"; terms: Condition[] }
  | { kind: "not"; term: Condition }
  | { kind: "equal"; left: Operand; right: Operand }
  | { kind: "lessOrEqual"; left: Operand; right: Operand }
  | { kind: "exists"; selector: Selector }
  | { kind: "related"; from: Operand; to: Operand; schemaNames: string[]; maxHops: number };

export interface Policy {
  id: Id;
  authorityIssuers?: Id[];
  parent?: Ref;
  rules: {
    id: Id;
    effect: "permit" | "deny";
    actions: string[];
    when: Condition;
  }[];
  limits: Limits;
  evidence: Evidence;
}

export interface Grant {
  id: Id;
  principalId: Id;
  parentGrant?: Ref;
  actions: string[];
  incidentIds: Id[] | "all";
  resourceRefs: Ref[];
  delegable: boolean;
  expiresAt?: Instant;
  limits: Limits;
}

export interface Authorization {
  decision: "permit" | "deny" | "indeterminate";
  policy: Ref;
  evaluatedRevision: Revision;
  supportingRefs: Ref[];
  explanation: string;
}

export interface ReactionRule {
  id: Id;
  triggerEventTypes: string[];
  condition: Condition;
  operation: string;
  literalInput: Json;
  inputBindings: { [jsonPointer: string]: string };
  limits: Limits;
}

export interface Proposal {
  id: Id;
  incidentId: Id;
  basisRevision: Revision;
  rule?: Ref;
  policy: Ref;
  changes: Change[];
  executions: ExecutionIntent[];
  evidence: Evidence;
}

export interface Transition {
  proposal: Proposal;
  state: "proposed" | "committed" | "rejected";
  commit?: Commit;
  rejection?: Fault;
}

export interface Capability {
  id: Id;
  providerId: Id;
  name: string;
  version: string;
  inputSchema: SchemaRef;
  outputSchema: SchemaRef;
  features: string[];
  platform: { os: string; architecture: string };
  isolation: "none" | "process" | "container" | "vm";
  reconciliation: "lookup" | "idempotent" | "manual";
  evidence: Evidence;
  expiresAt: Instant;
}

export interface CapabilityRequirement {
  name: string;
  versions: string[];
  inputSchema: SchemaRef;
  outputSchema: SchemaRef;
  features: string[];
  acceptableIsolation: Capability["isolation"][];
}

export interface CapabilityMatch {
  capability: Stored<Capability>;
  unmet: string[];
  eligibility: "eligible" | "ineligible" | "unknown";
}

export interface ExecutionIntent {
  id: Id;
  incidentId: Id;
  capability: Ref;
  grant: Ref;
  input: Json;
  limits: Limits;
}

export interface Lease {
  id: Id;
  holderId: Id;
  fencingToken: number;
  expiresAt: Instant;
}

export type ExecutionState =
  | "queued" | "leased" | "running" | "succeeded" | "failed"
  | "cancel_requested" | "cancelled" | "unknown";

export type Outcome =
  | { kind: "succeeded"; output: Json; evidence: Evidence }
  | { kind: "failed"; code: string; detail: string; evidence: Evidence }
  | { kind: "cancelled"; evidence: Evidence }
  | { kind: "unknown"; detail: string; evidence: Evidence };

export type Reconciliation =
  | { kind: "observed"; outcome: Outcome }
  | { kind: "retry"; basis: "not_started" | "idempotent"; evidence: Evidence };

export interface Execution {
  intent: ExecutionIntent;
  state: ExecutionState;
  attempt: number;
  lease?: Lease;
  outcome?: Outcome;
}

export type Wake =
  | { kind: "event"; eventTypes: string[]; selector: Selector; mode: "edge" | "each" }
  | { kind: "at"; instant: Instant }
  | { kind: "after"; eventId: Id; durationMillis: number }
  | { kind: "capacity"; resource: string; atLeast: number };

export interface Schedule {
  id: Id;
  incidentId: Id;
  rule: Ref;
  wake: Wake;
  recurrence: "once" | "rearmAfterCompletion";
  coalesce: boolean;
}

export interface Event {
  id: Id;
  contextId: Id;
  sequence: number;
  revision: Revision;
  type: string;
  subjectRefs: Ref[];
  causeIds: Id[];
  recordedAt: Instant;
  occurredAt?: Instant;
  payload: Json;
}

export interface Message {
  id: Id;
  incidentId: Id;
  recipientId: Id;
  kind: "notice" | "request" | "response";
  inReplyTo?: Id;
  summary: string;
  detailRefs: Ref[];
  expiresAt?: Instant;
}

export interface View {
  id: Id;
  selector: Selector;
  fields: string[];
  groupBy?: "record" | "schema";
}

export interface ProjectedRecord {
  ref: Ref;
  fields: { [jsonPointer: string]: Json };
}

export interface Projection {
  view: Ref;
  version: Digest;
  records: ProjectedRecord[];
  support: AssertionState[];
  complete: boolean;
  nextCursor?: Cursor;
}

export interface PromptRequest {
  incidentId: Id;
  template: Ref;
  sourceRefs: Ref[];
  outputSchema: SchemaRef;
  maximumInputBytes: number;
}

export interface PromptArtifact {
  template: Ref;
  sourceRefs: Ref[];
  content: string;
  outputSchema: SchemaRef;
  digest: Digest;
  omittedRefs: Ref[];
}

export interface ExchangeBundle {
  id: Id;
  sourceSystemId: Id;
  sourceContextId: Id;
  sourceRevision: Revision;
  records: Stored<SemanticRecord>[];
  assertions: AssertionState[];
  digest: Digest;
}

export interface Artifact {
  digest: Digest;
  mediaType: string;
  byteLength: number;
}

export type FaultCode =
  | "INVALID_ARGUMENT" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND"
  | "REVISION_CONFLICT" | "IDEMPOTENCY_CONFLICT" | "IDENTITY_CONFLICT"
  | "POLICY_INDETERMINATE" | "LIMIT_EXCEEDED" | "CAPABILITY_UNAVAILABLE"
  | "LEASE_STALE" | "CURSOR_EXPIRED" | "UNSUPPORTED_VERSION"
  | "OUTCOME_UNKNOWN" | "INTERNAL";

export interface Fault {
  code: FaultCode;
  message: string;
  retry: "same_request" | "refresh" | "reconcile" | "never";
  details: Json;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: Fault };

/** Public operations. Authentication is bound by transport outside these inputs. */
export interface Methods {
  "system.describe": {
    input: { protocolVersion: "0.1" };
    output: { systemId: Id; protocolVersion: "0.1"; methods: string[]; implementationVersion: string };
  };
  "context.create": {
    input: { idempotencyKey: string; id: Id; label: string; bootstrapProfile: string; limits: Limits };
    output: Context;
  };
  "context.get": { input: Read; output: Context };
  "control.get": {
    input: Read & { ref: Ref };
    output: Stored<Policy | Grant | ReactionRule | Capability | Schedule | View>;
  };
  "context.close": { input: Mutation & { reason: string }; output: Commit };
  "schema.publish": {
    input: Mutation & { schema: SchemaRef; document: Json };
    output: Stored<{ schema: SchemaRef; document: Json }>;
  };
  "schema.get": { input: Read & { schema: SchemaRef }; output: Json };
  "incident.create": { input: Mutation & { id: Id; incident: Incident }; output: Stored<Incident> };
  "incident.get": { input: Read & { incidentId: Id }; output: Stored<Incident> };
  "incident.update": {
    input: Mutation & { incidentId: Id; incident: Incident; evidence: Evidence };
    output: Stored<Incident>;
  };
  "graph.query": {
    input: Read & { selector: Selector; limit: number; cursor?: Cursor };
    output: Page<{ record: Stored<SemanticRecord>; support: AssertionState[] }>;
  };
  "graph.transact": { input: Mutation & { changes: Change[] }; output: Commit };
  "policy.publish": { input: Mutation & { policy: Policy }; output: Stored<Policy> };
  "policy.activate": { input: Mutation & { policy: Ref; evidence: Evidence }; output: Commit };
  "policy.evaluate": {
    input: Read & { action: string; incidentId: Id; resourceRefs: Ref[]; grant: Ref };
    output: Authorization;
  };
  "grant.issue": { input: Mutation & { grant: Grant }; output: Stored<Grant> };
  "grant.revoke": { input: Mutation & { grant: Ref; reason: string }; output: Commit };
  "rule.publish": { input: Mutation & { rule: ReactionRule }; output: Stored<ReactionRule> };
  "reaction.evaluate": {
    input: Read & { rule: Ref; eventIds: Id[]; incidentId: Id };
    output: { eligible: boolean; explanation: string; candidateInput?: Json };
  };
  "transition.propose": { input: Mutation & { proposal: Proposal }; output: Transition };
  "transition.commit": { input: Mutation & { proposalId: Id }; output: Commit };
  "transition.get": { input: Read & { proposalId: Id }; output: Transition };
  "capability.advertise": { input: Mutation & { capability: Capability }; output: Stored<Capability> };
  "capability.match": {
    input: Read & { requirement: CapabilityRequirement; grant: Ref; limit: number };
    output: CapabilityMatch[];
  };
  "execution.request": { input: Mutation & { execution: ExecutionIntent }; output: Execution };
  "execution.get": { input: Read & { executionId: Id }; output: Execution };
  "execution.claim": {
    input: Mutation & { executionId: Id; leaseMillis: number };
    output: Execution;
  };
  "execution.heartbeat": {
    input: Mutation & { executionId: Id; leaseId: Id; fencingToken: number; leaseMillis: number };
    output: Execution;
  };
  "execution.finish": {
    input: Mutation & { executionId: Id; leaseId: Id; fencingToken: number; outcome: Outcome };
    output: Execution;
  };
  "execution.reconcile": {
    input: Mutation & { executionId: Id; resolution: Reconciliation };
    output: Execution;
  };
  "execution.cancel": { input: Mutation & { executionId: Id; reason: string }; output: Execution };
  "schedule.put": { input: Mutation & { schedule: Schedule }; output: Commit };
  "schedule.cancel": { input: Mutation & { scheduleId: Id }; output: Commit };
  "events.read": {
    input: Read & { after?: Cursor; limit: number; waitMillis: number };
    output: Page<Event>;
  };
  "messages.send": { input: Mutation & { message: Message }; output: Commit };
  "messages.read": {
    input: Read & { limit: number; cursor?: Cursor; includeAcknowledged: boolean };
    output: Page<Stored<Message>>;
  };
  "messages.ack": { input: Mutation & { messageIds: Id[] }; output: Commit };
  "view.publish": { input: Mutation & { view: View }; output: Stored<View> };
  "view.read": { input: Read & { view: Ref; limit: number; cursor?: Cursor }; output: Projection };
  "prompt.compose": { input: Read & PromptRequest; output: PromptArtifact };
  "exchange.export": { input: Read & { refs: Ref[] }; output: ExchangeBundle };
  "exchange.import": {
    input: Mutation & { bundle: ExchangeBundle; peerId: Id };
    output: { commit: Commit; importedRefs: Ref[] };
  };
  "artifact.put": {
    input: Mutation & { mediaType: string; contentBase64: string; expectedDigest: Digest };
    output: Artifact;
  };
  "artifact.get": { input: Read & { digest: Digest }; output: Artifact & { contentBase64: string } };
}

export type Method = keyof Methods;
export type Input<M extends Method> = Methods[M]["input"];
export type Output<M extends Method> = Methods[M]["output"];

export type Request = {
  [M in Method]: { jsonrpc: "2.0"; id: string; method: M; params: Input<M> }
}[Method];

/** A connected client supplies transport authentication; caller identity is not a param. */
export interface MomentClient {
  call<M extends Method>(method: M, input: Input<M>): Promise<Result<Output<M>>>;
}

/** Trusted kernel-to-store boundary; never directly exposed over public transport. */
export interface StorePort {
  read(contextId: Id, revision?: Revision): Promise<Snapshot>;
  commit(batch: DurableBatch): Promise<Result<Commit>>;
}

export interface Snapshot {
  context: Context;
  records: Stored<SemanticRecord>[];
  assertions: AssertionState[];
  controlState: Json;
}

export interface DurableBatch {
  commitId?: Id;
  mutation: Mutation;
  principalId: Id;
  requestDigest: Digest;
  changes: Change[];
  controlChanges: { namespace: string; key: string; value: Json }[];
  events: Omit<Event, "revision" | "sequence" | "recordedAt">[];
  outbox: ExecutionIntent[];
  response: Json;
}

/** Adapter implementations enforce the admitted grant at the effect boundary. */
export interface HostPort {
  inspect(): Promise<{ platform: Capability["platform"]; measurements: Measurement[] }>;
  execute(input: { execution: Execution; grant: Stored<Grant>; policy: Ref }): Promise<Outcome>;
  reconcile(execution: Execution): Promise<Reconciliation>;
  cancel(execution: Execution): Promise<Outcome>;
}

export interface Measurement {
  resource: string;
  value: number;
  unit: string;
  observedAt: Instant;
  source: string;
}

/** Provider-neutral agent boundary; proposed output enters ordinary validation. */
export interface AgentPort {
  invoke(input: { prompt: PromptArtifact; execution: Execution; grant: Stored<Grant> }): Promise<Outcome>;
  cancel(execution: Execution): Promise<Outcome>;
}

export interface ClockPort {
  wallNow(): Instant;
  monotonicMillis(): number;
  bootId(): Id;
}
