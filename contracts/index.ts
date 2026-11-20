import type {CaptureReadInput,CapturePacket} from './captures.js';
export type * from './captures.js';
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

/** Evidence belongs to the admitted revision, independently of its purpose. */
export interface StoredIncident extends Stored<Incident> {
  evidence?: Evidence;
}

export type IncidentCreation =
  | { incident: Incident & { status: "open" }; evidence?: Evidence }
  | { incident: Incident & { status: "resting" | "completed" | "cancelled" }; evidence: Evidence };

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
    id: string;
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
  cancellation?: { requestedBy: Id; requestedAt: Instant; reason: string };
  /** Provider-reported cumulative usage across attempts; unknown keeps its reservation. */
  usage: ExecutionUsage;
  limitViolations?: ("cpuMillis" | "memoryBytes" | "outputBytes" | "modelTokens" | "apiSpendMicrounits")[];
}

export interface ExecutionUsage {
  cpuMillis: number;
  memoryBytes: number;
  outputBytes: number;
  modelTokens: number;
  apiSpendMicrounits: number;
  /** Numeric fields are known lower bounds for these resources, not invented zero measurements. */
  unmeasured?: ("cpuMillis" | "memoryBytes" | "modelTokens" | "apiSpendMicrounits")[];
}

export interface ExecutionReport {
  attempt: number;
  outcome: Outcome;
  usage: ExecutionUsage;
}

export interface ReconciliationReport {
  attempt: number;
  resolution: Reconciliation;
  usage: ExecutionUsage;
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

export interface ScheduleStatus {
  schedule: Stored<Schedule>;
  state: "active" | "completed" | "cancelled";
  pendingOccurrenceIds: Id[];
  activeExecutionIds: Id[];
  lastFault?: Fault;
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
  /** Proposed managed integration provenance; absent on the current renderer. */
  catalog?: CatalogIdentity;
}

/** Proposed managed integration boundaries. These declarations do not advertise implementation. */
export interface CatalogIdentity {
  formatVersion: 1;
  digest: Digest;
  implementationVersion: string;
  sourceDigest: Digest;
  contractDigest: Digest;
}

export type SurfaceOperation = Method | keyof ManagedMethods;
export type SurfaceInput<M extends SurfaceOperation> = M extends Method ? Input<M> : M extends keyof ManagedMethods ? ManagedMethods[M]["input"] : never;
export type SurfaceOutput<M extends SurfaceOperation> = M extends Method ? Output<M> : M extends keyof ManagedMethods ? ManagedMethods[M]["output"] : never;
export interface ManagedClient {
  call<M extends SurfaceOperation>(operation: M, input: SurfaceInput<M>): Promise<Result<SurfaceOutput<M>>>;
}
export interface DirectiveBinding {
  id: string;
  version: string;
  digest: Digest;
  source: { path: string; digest: Digest };
}
export interface OperationBinding {
  id: SurfaceOperation;
  version: string;
  availability: "implemented" | "declared";
  mode: "read" | "write" | "bootstrap" | "control";
  inputSchema: { ref: SchemaRef; document: Json };
  outputSchema: { ref: SchemaRef; document: Json };
  effects: ("read-store" | "write-store" | "queue-effect" | "request-cancel" | "service-control")[];
  retryIdentity: "none" | "context-revision-key" | "bootstrap-key" | "service-instance" | "session-delivery-key" | "session-revision-key";
  summary: string;
  preconditions: string[];
  directives: DirectiveBinding[];
  sources: { path: string; digest: Digest }[];
}
export type AdvertisedBinding = OperationBinding & { availability: "implemented"; mcpName: string };
export interface BindingPage {
  catalog: CatalogIdentity;
  exposedOperations: SurfaceOperation[];
  operations: OperationBinding[];
  nextCursor?: Cursor;
}
export interface AgentManifest {
  formatVersion: 1;
  kind: "manifest";
  catalog: CatalogIdentity;
  exposedOperations: SurfaceOperation[];
  nextCursor?: Cursor;
}
export type BindingSummary = Omit<OperationBinding, "inputSchema" | "outputSchema"> & {
  inputSchema: { ref: SchemaRef };
  outputSchema: { ref: SchemaRef };
};
export type AgentRecord = { formatVersion: 1; kind: "operation" } & (OperationBinding | BindingSummary);
export interface StatusReport {
  health: ServiceHealth;
  contexts: Context[];
  incidents: StoredIncident[];
  issues: Fault[];
}
export interface StopReport {
  accepted: boolean;
  instanceId?: Id;
  retired: boolean;
  health: ServiceHealth;
}
export type StatusEnvelope = Result<StatusReport>;
export type StopEnvelope = Result<StopReport>;
export interface WorkspaceSelection {
  projectId?: Id;
  location?: string;
  contextId?: Id;
  incidentId?: Id;
}
/** Routing references only. Every subsequent operation rechecks actual credential authority. */
export interface AttachmentTarget {
  systemId: Id;
  contextId: Id;
  incidentId?: Id;
  projectId?: Id;
}
export interface Attachment extends AttachmentTarget {
  principalId: Id;
  grant?: Ref;
  catalog: CatalogIdentity;
}
export type AttachmentResult =
  | { kind: "attached"; attachment: Attachment }
  | { kind: "needs_selection"; reason: "no_context" | "ambiguous_project" | "ambiguous_context" | "ambiguous_incident";
      candidates: { contextId: Id; incidentId?: Id; projectId?: Id; label: string }[]; more: boolean };
export interface ContextPacket {
  attachment: Attachment;
  context: Context;
  incident?: StoredIncident;
  records: { record: Stored<SemanticRecord>; support: AssertionState[] }[];
  messages: Stored<Message>[];
  omittedRefs: Ref[];
  instructions: { text: string; directives: DirectiveBinding[] };
  catalog: CatalogIdentity;
  captureDisposition?: {availability: "unregistered" | "registered" | "unavailable"; reason?: string; generation?: Revision; manifestDigest?: Digest; record?: Ref};
}
/** Adapter operations, distinct from kernel RPCs; transport identity is never an input. */
export interface ManagedMethods {
  "captures.read": {input:CaptureReadInput; output:CapturePacket};
  "bindings.discover": { input: { operationId?: SurfaceOperation; cursor?: Cursor; limit?: number }; output: BindingPage };
  "workspace.attach": { input: WorkspaceSelection; output: AttachmentResult };
  "workspace.read": { input: { target: AttachmentTarget; maximumBytes?: number; limit?: number; detailRefs?: Ref[]; includeMessages?: boolean }; output: ContextPacket };
}

/** Owner-local conversational memory, independent of semantic Context identity. */
/** One source vocabulary for implemented captures and the proposed normative layer. */
export type SourceLocator =
  | { kind: "file"; path: string }
  | { kind: "artifact"; projectId: Id; path: string; head?: string; worktree?: string }
  | { kind: "conversation"; adapter: Ref; threadId: string; turnId: string; itemId: string; role: "user" | "assistant" | "tool" }
  | { kind: "record"; ref: Ref; digest: Digest }
  | { kind: "web"; url: string; retrievedAt: Instant };
export type SourceSelection = { kind: "whole" } | { kind: "lines"; first: number; last: number }
  | { kind: "utf8-range"; offset: number; byteLength: number } | { kind: "json-pointer"; pointer: string };
export interface SourceCapture {
  locator: SourceLocator;
  selection: SourceSelection;
  contentDigest: Digest;
  mediaType: string;
  classification: "public" | "private" | "sensitive" | "unknown";
  content: { kind: "text"; text: string } | { kind: "artifact"; ref: Ref } | { kind: "stored-bytes"; digest: Digest; byteLength: number };
  observedAt: Instant;
  evidence: Evidence;
}
export interface GuidanceSourceDefinition {
  label: string;
  locator: { kind: "file"; path: string } | { kind: "record"; ref: Ref };
  selection: SourceSelection;
  locations: string[];
  classification: SourceCapture["classification"];
  evidence: Evidence;
}
export type GuidanceObservationState = "ready" | "missing" | "denied" | "too_large" | "unsupported" | "changed";
export interface GuidanceObservation {
  state: GuidanceObservationState;
  observedAt: Instant;
  detail: string;
  capture?: Ref;
}
export interface GuidanceSource {
  id: Id;
  definition: GuidanceSourceDefinition;
  definitionDigest: Digest;
  active: boolean;
  latest?: GuidanceObservation;
  lastCapture?: Ref;
}
export interface GuidanceCapture {
  source: Ref;
  definitionDigest: Digest;
  capture: SourceCapture;
  wholeDigest: Digest;
  wholeByteLength: number;
  transformation: "utf8" | "canonical-json" | "json-string";
  origin: Json;
}
export interface GuidanceTask { description: string; location: string; sourceRefs: Ref[] }
export interface GuidanceReviewInput {
  task: GuidanceTask;
  captures: { ref: Ref; digest: Digest }[];
  basis: { ref: Ref; digest: Digest; revision: Revision }[];
  policy: { ref: Ref; digest: Digest };
  profile: "moment-guidance/1";
}
export interface GuidanceQuote {
  proposed: string;
  status: "exact" | "editorial-initial" | "ambiguous" | "unanchored";
  matches: { offset: number; byteLength: number }[];
  original?: string;
}
export interface GuidanceCandidate {
  capture: Ref;
  interpretation: string;
  scope: string;
  reason: string;
  quotes: GuidanceQuote[];
}
export interface GuidanceAssessment {
  execution: Ref;
  inputDigest: Digest;
  profile: "moment-guidance/1";
  candidates: GuidanceCandidate[];
  exclusions: { capture: Ref; reason: string }[];
  uncertainties: string[];
  premises: string[];
  evidenceCoverage: string;
  rawDigest: Digest;
  usage: MemoryUsage;
}
export interface GuidancePacket {
  snapshotRevision: Revision;
  profile?: { capability: Ref; grants: Ref[]; limits: Limits; note: string };
  nextCursor?: Cursor;
  sources: Stored<GuidanceSource>[];
  captures: { stored: Stored<GuidanceCapture>; text?: string; freshness?: "current-observation" | "historical"; representation?: "whole" | "selected"; range?: { offset: number; byteLength: number } }[];
  execution?: Execution;
  assessment?: GuidanceAssessment;
  freshness?: "current-observation" | "stale" | "unverified";
  staleReasons: string[];
  omitted: { ref: Ref; reason: string; recovery: string }[];
  coverage: { matchedSources: number; returnedSources: number; note: string };
  worker: { state: "disabled" | "ready" | "running" | "unknown" | "unavailable"; reason: string };
}

export interface MemorySession { runtimeId: string; sessionId: string }
/** Enrollment revision is independent of cache revision and intake observations. */
export interface MemorySubscription {
  session: MemorySession;
  revision: number;
  enabled: boolean;
  changedAt?: Instant;
  changedBy?: Id;
  lastIntake?: { sequence: number; at: Instant; subscriptionRevision: number };
}
export interface MemoryConfigure {
  session: MemorySession;
  expectedRevision: number;
  idempotencyKey: string;
  enabled: boolean;
}
export interface MemoryConfigureResult {
  subscription: MemorySubscription;
  cancelledSequences: number[];
  inFlight?: { sequence: number; status: "running" | "unknown" };
  replayed: boolean;
}
export interface MemoryAutomationStatus {
  state: "off" | "awaiting-input" | "input-observed" | "unavailable";
  reason: string;
}
export interface MemorySelection {
  kind: "codex-rollout"; path: string; offset: number; byteLength: number; digest: Digest; contentIndex: number; headerVersion: string;
  nativeTimestamp?: string; ordinal?: number; clientAuthored?: boolean; provenanceType?: string; contentKind?: string;
}
export interface MemoryMessage {
  text: string;
  authorship: "human" | "assistant" | "harness" | "unknown";
  nativeItemId?: string;
  turnId?: string;
  selection?: MemorySelection;
}
export interface MemorySource extends MemoryMessage {
  id: string;
  session: MemorySession;
  digest: Digest;
  origin: "submission" | "referenced-exchange" | "selected-history";
  observedAt: Instant;
  contextIds?: string[];
}
export interface MemoryEntry { sourceId: string; weight: number; generality?: number; note?: string }
/** The checker's bounded outcome explanation is an assessment, not source evidence or authority. */
export type MemoryCheckResult = { kind: "unchanged"; explanation: string } | { kind: "replace"; entries: MemoryEntry[]; explanation: string };
export interface MemoryAssessment {
  dispatchId: string; sequence: number; explanation: string;
  incomingSourceIds?: string[];
  basisAvailability?: "retained" | "retired" | "legacy";
  workingSetId?: string;
}
export interface MemoryFocusState { workingSetId: string; revision: number }
export interface MemoryWorkingSetSummary { id: string; revision: number; purposeKey: string; label: string }
export interface MemoryWorkingSet extends MemoryWorkingSetSummary {
  basisSourceIds: string[];
  purpose?: string;
  returnPoint?: string;
}
export interface MemoryGuidanceBinding {
  source: Ref;
  capture: Ref;
  contentDigest: Digest;
  representation: "whole" | "selected";
  bodyRange?: { offset: number; byteLength: number };
  applicability: string;
  materialOmissions: string[];
}
/** Current read qualification. No source body is cached in a working-set binding. */
export interface MemoryBindingsRead {
  work?: { target: AttachmentTarget; contextState: Context["state"]; incidentStatus?: Incident["status"] };
  guidance: { index: number; binding: MemoryGuidanceBinding; freshness: "current-observation" | "historical" }[];
  omitted: { kind: "work" | "guidance"; index?: number; reason: "unavailable" | "integrity" | "component-unavailable" }[];
}
export interface MemoryFocus {
  session: MemorySession;
  expectedFocusRevision: number;
  idempotencyKey: string;
  action:
    | { kind: "select"; purposeKey: string; label?: string; purpose?: string; returnPoint?: string; basisSourceIds?: string[]; seedFrom?: string; work?: AttachmentTarget | null; guidance?: MemoryGuidanceBinding[] }
    | { kind: "release"; workingSetId: string; replacementId?: string };
}
export interface MemoryFocusResult {
  session: MemorySession; focus: MemoryFocusState; workingSet: MemoryWorkingSetSummary; cacheRevision: number;
  created: boolean; replayed: boolean; releasedWorkingSetId?: string;
}
export type MemoryAssessmentPart = "basis" | "profile" | "nativeProfile" | "preparation" | "request" | "renderedInput" | "nativeSchema" | "outcome" | "rawOutput";
export type MemoryAssessmentsRead = { session: MemorySession; maximumBytes?: number } & (
  | { assessmentId?: never; limit?: number; cursor?: Cursor; part?: never; bodyRange?: never }
  | { assessmentId: string; limit?: never; cursor?: never; part?: never; bodyRange?: never }
  | { assessmentId: string; limit?: never; cursor?: never; part: MemoryAssessmentPart; bodyRange?: { offset: number; byteLength: number } }
);
export interface MemoryAssessmentInput {
  session: MemorySession; capacity: number; cache: MemoryEntry[]; incomingSourceIds: string[]; sources: MemorySource[];
  workingSet?: Omit<MemoryWorkingSet, "revision" | "basisSourceIds">;
  focusSourceIds?: string[];
}
export interface MemoryAssessmentBasis {
  session: MemorySession; capacity: number; cache: MemoryEntry[]; incomingSourceIds: string[]; sourceIds: string[];
  cacheRevision: number; processedThrough: number; inputDigest: Digest; renderedInputDigest: Digest; promptDigest: Digest; outputSchemaDigest: Digest;
  workingSetId?: string; workingSetRevision?: number; focusRevision?: number; admittedFocusRevision?: number;
  workingSet?: Omit<MemoryWorkingSet, "revision" | "basisSourceIds">;
  focusSourceIds?: string[];
}
/** Immutable data. A reader never evaluates executable code recovered from a profile. */
export interface MemoryCheckerProfile {
  kind: "moment-memory"; version: 1; renderer: "moment-memory-input/1" | "moment-memory-input/2"; prompt: string; outputSchema: Json;
}
export interface MemoryNativeProfile {
  kind: "codex-memory"; version: number; renderer: "moment-memory-native/1" | "moment-memory-native/2";
  baseInstructions: string; developerInstructions: string; outputSchema: Json;
  nativeVersion: string; apiContractDigest: Digest;
  parameters: {
    model: string; allowProviderModelFallback: false; approvalPolicy: "never"; permissions: "moment-memory";
    ephemeral: false; environments: Json[]; dynamicTools: Json[]; effort: "low";
  };
}
export interface MemoryNativePreparation {
  profile: MemoryNativeProfile;
  request: { inputDigest: Digest; schemaDigest: Digest; cwd: string };
}
export interface MemoryAssessmentSummary {
  assessmentId: string; session: MemorySession; sequence: number;
  status: MemoryInputStatus | "not-started";
  incomingSourceIds: string[]; basisAvailability: "retained" | "retired" | "legacy";
  workingSetId?: string;
  provider: { id: string; model: string }; startedAt?: Instant; observedAt?: Instant; finishedAt?: Instant; basisDigest?: Digest;
  nativeOutput: { availability: "retained" | "legacy" | "retired" | "pending" | "not-supplied" | "oversize"; digest?: Digest; bytes?: number };
}
export interface MemoryAssessmentDetail extends MemoryAssessmentSummary {
  basis?: MemoryAssessmentBasis; profile?: MemoryCheckerProfile; nativeProfile?: MemoryNativeProfile;
  preparation?: MemoryNativePreparation["request"];
  request?: MemoryAssessmentInput; renderedInput?: string; nativeSchema?: Json;
  outcome?: { receipt: MemoryReceipt; output?: Json; outputUnavailable?: { reason: "oversize"; digest: Digest; bytes: number } };
  rawOutput?: string;
}
export interface MemoryAssessmentPacket {
  session: MemorySession;
  assessments: MemoryAssessmentSummary[];
  assessment?: MemoryAssessmentDetail;
  omittedParts: MemoryAssessmentPart[];
  nextCursor?: Cursor;
  part?: {
    name: MemoryAssessmentPart; representation: "whole" | "range"; encoding: "utf8"; format: "text" | "json";
    body: string; wholeDigest: Digest; selectedDigest: Digest; offset: number; byteLength: number; totalBytes: number;
  };
  unavailablePart?: { part: MemoryAssessmentPart; reason: "not-supplied" | "retired" | "legacy" };
}
export type MemoryInputStatus = "pending" | "running" | "unknown" | "succeeded" | "failed" | "cancelled" | "skipped";
export interface MemoryObservation {
  session: MemorySession;
  deliveryId: string;
  message: MemoryMessage;
  exchange?: MemoryMessage[];
  /** Trusted automatic intake rechecks the current enrollment at admission. */
  automatic?: { subscriptionRevision: number };
  workingSetId?: string;
}
export interface MemoryCapture { session: MemorySession; message: MemoryMessage; exchange?: MemoryMessage[] }
export type MemoryRebuild = { session: MemorySession; deliveryId: string; sourceIds: string[]; captures?: MemoryCapture[] } & (
  | { expectedRevision: number; workingSetId?: never; expectedWorkingSetRevision?: never }
  | { workingSetId: string; expectedWorkingSetRevision: number; expectedRevision?: never }
);
export interface MemoryAdmission {
  session: MemorySession;
  sequence: number;
  deliveryId: string;
  sourceIds: string[];
  contextIds: string[];
  status: MemoryInputStatus;
  replayed: boolean;
  workingSetId?: string;
  admittedFocusRevision?: number;
}
export interface MemoryWorkerStatus { state: "disabled" | "ready" | "running" | "unavailable" | "unknown"; reason: string; model?: string }
export interface MemoryRead {
  session: MemorySession;
  sourceIds?: string[];
  maximumBytes?: number;
  workingSetId?: string;
  includeWorkingSets?: boolean;
}
export interface MemoryPacket {
  session: MemorySession;
  subscription: MemorySubscription;
  automation: MemoryAutomationStatus;
  exists: boolean;
  historyCoverage: "selected-inputs";
  cacheRevision: number;
  processedThrough: number;
  observedThrough: number;
  entries: MemoryEntry[];
  pending: { sequence: number; status: "pending" | "running" | "unknown"; dispatchId?: string; workingSetId?: string }[];
  gaps: { sequence: number; status: "failed" | "cancelled"; error?: { code: string; message: string }; workingSetId?: string }[];
  gapCount: number;
  omittedGapCount: number;
  sources: MemorySource[];
  omittedSourceIds: string[];
  /** JSON pointers identify optional metadata omitted from this revision's projection. */
  omittedFields?: string[];
  omittedWorkingSetIds?: string[];
  lastAssessment?: MemoryAssessment;
  activeAssessment?: MemoryAssessment;
  selectedAssessment?: MemoryAssessment;
  focus?: MemoryFocusState;
  workingSet?: MemoryWorkingSet;
  workingSets?: (MemoryWorkingSetSummary & { active: boolean })[];
  bindings?: MemoryBindingsRead;
  /** Automatic presentation preference, separate from explicit read ceilings or model capacity. */
  presentation?: { maximumBytes: number };
  worker?: MemoryWorkerStatus;
}
/** Only observed metrics belong here. Missing model usage and monetary cost stay absent. */
export interface MemoryUsage { latencyMillis?: number; modelTokens?: number; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }
export interface MemoryReceipt {
  dispatchId: string;
  session: MemorySession;
  sequence: number;
  status: "succeeded" | "failed";
  cacheRevision: number;
  resultDigest: Digest;
  inputDigest: Digest;
  promptDigest: Digest;
  promptVersion: string;
  outputSchemaDigest: Digest;
  provider: { id: string; model: string };
  usage: MemoryUsage;
  finishedAt: Instant;
  /** Present for a successful current-format check; older receipts can omit it. */
  explanation?: string;
  error?: { code: string; message: string };
  /** Full assessment evidence was committed before provider cleanup. Older receipts omit this. */
  evidenceRetained?: boolean;
  nativeOutputDigest?: Digest;
  workingSetId?: string;
  workingSetRevision?: number;
}
export type MemoryResolution = { kind: "observed"; output: MemoryCheckResult; usage?: MemoryUsage; rawOutput?: string } | { kind: "not_started" | "cancelled"; evidence: string } | { kind: "failed"; code: string; message: string; evidence: string; usage?: MemoryUsage; rawOutput?: string };
export interface ManagedEnvelope<T> {
  operation: SurfaceOperation;
  catalog: CatalogIdentity;
  result: Result<T>;
}
export interface ServiceHealth {
  state: "ready" | "stopped" | "starting" | "unavailable" | "incompatible" | "uncertain";
  reason: string;
  home: string;
  instanceId?: Id;
  catalog?: CatalogIdentity;
}
export interface ServicePort {
  inspect(): Promise<ServiceHealth>;
  ensure(): Promise<Result<ServiceHealth>>;
  stop(expectedInstanceId: Id): Promise<Result<{ accepted: true; instanceId: Id }>>;
}
export interface IntegrationRequest {
  action: "connect" | "disconnect";
  codexHome: string;
  momentHome: string;
  apply: boolean;
}
export interface IntegrationOutcome {
  state: "planned" | "applied" | "unchanged" | "conflict" | "recovery_required";
  reason: string;
  target: string;
  beforeDigest?: Digest;
  afterDigest?: Digest;
  ownedEntryDigest?: Digest;
  launcher?: { command: string; args: string[]; env: { [name: string]: string } };
  ownedEntry?: { text: string; digest: Digest };
}
export interface IntegrationPort {
  reconcile(request: IntegrationRequest): Promise<Result<IntegrationOutcome>>;
}
export type IntegrationEnvelope = Result<IntegrationOutcome>;

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
    output: { systemId: Id; protocolVersion: "0.1"; methods: string[]; implementationVersion: string; catalog?: CatalogIdentity; instanceId?: Id; principalId?: Id; grants?: { [contextId: string]: Ref } };
  };
  "service.stop": { input: { expectedInstanceId: Id }; output: { accepted: true; instanceId: Id } };
  "memory.read": { input: MemoryRead; output: MemoryPacket };
  "memory.assessments.read": { input: MemoryAssessmentsRead; output: MemoryAssessmentPacket };
  "memory.focus": { input: MemoryFocus; output: MemoryFocusResult };
  "memory.configure": { input: MemoryConfigure; output: MemoryConfigureResult };
  "memory.observe": { input: MemoryObservation; output: MemoryAdmission };
  "memory.rebuild": { input: MemoryRebuild; output: MemoryAdmission };
  "memory.cancel": { input: { session: MemorySession; sequence: number }; output: { session: MemorySession; sequence: number; status: MemoryInputStatus } };
  "memory.reconcile": { input: { dispatchId: string; resolution: MemoryResolution }; output: MemoryReceipt | { dispatchId: string; status: "pending" | "cancelled" } };
  "guidance.register": { input: Mutation & { id: Id; definition: GuidanceSourceDefinition; active: boolean }; output: Stored<GuidanceSource> };
  "guidance.refresh": { input: Mutation & { sourceId: Id }; output: Stored<GuidanceSource> };
  "guidance.review": { input: Mutation & { id: Id; incidentId: Id; task: GuidanceTask; sourceIds?: Id[]; capability: Ref; grant: Ref; limits: Limits }; output: Execution };
  "guidance.read": { input: { contextId: Id; location?: string; sourceIds?: Id[]; captureIds?: Id[]; executionId?: Id; maximumBytes?: number; limit?: number; cursor?: Cursor; representation?: "whole" | "selected"; bodyRange?: { offset: number; byteLength: number } }; output: GuidancePacket };
  "context.create": {
    input: { idempotencyKey: string; id: Id; label: string; bootstrapProfile: string; limits: Limits };
    output: Context;
  };
  "context.get": { input: Read; output: Context };
  /** Local operator only. Does not alter active policy, grants, usage or reservations. */
  "context.limits": { input: Mutation & { limits: Limits; evidence: Evidence }; output: Commit };
  "control.get": {
    input: Read & { ref: Ref };
    output: Stored<Policy | Grant | ReactionRule | Capability | Schedule | View | GuidanceSource | GuidanceCapture>;
  };
  "context.close": { input: Mutation & { reason: string }; output: Commit };
  "schema.publish": {
    input: Mutation & { schema: SchemaRef; document: Json };
    output: Stored<{ schema: SchemaRef; document: Json }>;
  };
  "schema.get": { input: Read & { schema: SchemaRef }; output: Json };
  "incident.create": { input: Mutation & { id: Id } & IncidentCreation; output: StoredIncident };
  "incident.get": { input: Read & { incidentId: Id }; output: StoredIncident };
  "incident.list": { input: Read & { statuses?: Incident["status"][]; limit: number; cursor?: Cursor }; output: Page<StoredIncident> };
  "incident.update": {
    input: Mutation & { incidentId: Id; incident: Incident; evidence: Evidence };
    output: StoredIncident;
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
    input: Read & { requirement: CapabilityRequirement; grant: Ref; limit: number; incidentId?: Id };
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
    input: Mutation & { executionId: Id; leaseId: Id; fencingToken: number; outcome: Outcome; usage: ExecutionUsage };
    output: Execution;
  };
  "execution.reconcile": {
    input: Mutation & { executionId: Id; attempt: number; resolution: Reconciliation; usage: ExecutionUsage };
    output: Execution;
  };
  "execution.cancel": { input: Mutation & { executionId: Id; reason: string }; output: Execution };
  "schedule.put": { input: Mutation & { schedule: Schedule }; output: Commit };
  "schedule.cancel": { input: Mutation & { scheduleId: Id }; output: Commit };
  "schedule.get": { input: Read & { scheduleId: Id }; output: ScheduleStatus };
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
  events: (Omit<Event, "revision" | "sequence" | "recordedAt"> & { visibilityRefs?: Ref[]; visibilityAlternatives?: Ref[][] })[];
  outbox: ExecutionIntent[];
  response: Json;
}

/** Adapter implementations enforce the admitted grant at the effect boundary. */
export interface HostPort {
  inspect(): Promise<{ platform: Capability["platform"]; measurements: Measurement[] }>;
  execute(input: { execution: Execution; grant: Stored<Grant>; policy: Ref }): Promise<ExecutionReport>;
  reconcile(execution: Execution): Promise<ReconciliationReport>;
  cancel(execution: Execution): Promise<ExecutionReport>;
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
  invoke(input: { prompt: PromptArtifact; execution: Execution; grant: Stored<Grant> }): Promise<ExecutionReport>;
  cancel(execution: Execution): Promise<ExecutionReport>;
}

export interface ClockPort {
  wallNow(): Instant;
  monotonicMillis(): number;
  bootId(): Id;
}
