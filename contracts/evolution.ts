/** Proposed purpose/guidance package. Not installed Methods or ManagedMethods. */
import type {
  AttachmentTarget, CatalogIdentity, Change, Condition, ContextPacket, Digest, Evidence, Execution,
  ExecutionUsage, Id, Instant, Json, Limits, Mutation, Reconciliation, Ref, Result, SchemaRef, Stored,
} from './index.js';

/** A vector of exact inputs, never a global transaction or a filesystem lock. */
export interface Basis {
  records: { ref: Ref; digest: Digest; revision: number }[];
  sources: { capture: Ref; contentDigest: Digest }[];
}

export type { SourceLocator, SourceCapture } from './index.js';
import type { SourceCapture } from './index.js';

/** Scope is structural; a condition cannot grant authority or prove its own narrowing. */
export interface GuidanceScope {
  contextId: Id;
  projectIds: Id[];
  incidentIds: Id[];
  subjectRefs: Ref[];
}

export interface PurposeDefinition {
  title: string;
  objective: string;
  kind: 'finite' | 'maintained';
  scope: GuidanceScope;
  criterionBindings: { binding: Ref; obligation: 'required' | 'advisory' }[];
  sourceRefs: Ref[];
  continuationRefs: Ref[];
}

export interface ConsistencyTarget {
  title: string;
  desiredRelation: string;
  rationale: string;
  applicability: Condition;
  criterion: {
    statement: string;
    assessment: 'deterministic' | 'judgment' | 'mixed';
    procedureRefs: Ref[];
    acceptanceRefs: Ref[];
  };
  sourceRefs: Ref[];
}

export interface GuidanceBinding {
  target: Ref;
  scope: GuidanceScope;
  roles: { [role: string]: Ref[] };
  obligation: 'required' | 'advisory';
  applicability: Condition;
  interpretation: string;
  procedureRefs: Ref[];
  basis: Basis;
  sourceRefs: Ref[];
}

export interface GuidanceProcedure {
  title: string;
  capability: Ref;
  effectClass: 'read-only' | 'proposal' | 'workspace-write' | 'external';
  inputSchema: SchemaRef;
  outputSchema: SchemaRef;
  template: Ref;
  applicability: Condition;
  sourceRefs: Ref[];
}

export type AssessmentResult =
  | { kind: 'satisfied'; observations: Ref[] }
  | { kind: 'divergent'; findings: Ref[] }
  | { kind: 'unknown'; missingEvidence: string[] }
  | { kind: 'not-applicable'; reason: string }
  | { kind: 'excepted'; exception: Ref }
  | { kind: 'conflicted'; conflictingRefs: Ref[] };

export interface GuidanceAssessment {
  binding: Ref;
  criterionDigest: Digest;
  basis: Basis;
  result: AssessmentResult;
  evidence: Evidence;
  observedAt: Instant;
}

export interface GuidanceException {
  binding: Ref;
  scope: GuidanceScope;
  reason: string;
  ends: { kind: 'at'; instant: Instant } | { kind: 'condition'; condition: Condition }
    | { kind: 'superseded' };
  sourceRefs: Ref[];
}

export type AdoptionBasis =
  | { kind: 'explicit-direction'; sourceRefs: Ref[] }
  | { kind: 'delegated-default'; delegation: Ref; sourceRefs: Ref[] };

export interface GuidanceAdoption {
  subjectRefs: Ref[];
  scope: GuidanceScope;
  basis: AdoptionBasis;
  supersedes: Ref[];
  evidence: Evidence;
}

export interface TaskFacts {
  intent?: Ref;
  subjectRefs: Ref[];
  factRefs: Ref[];
  /** Retrieval hint, never a policy binding or authenticated classification. */
  description?: string;
}

export interface GuidanceFact {
  name: string;
  value: Json;
  basis: Basis;
  evidence: Evidence;
  observedAt: Instant;
}

export interface GuidanceRequest {
  target: AttachmentTarget;
  task: TaskFacts;
  /** Caller-selected response bytes within service bounds; not native context capacity. */
  maximumBytes: number;
  limit: number;
  cursor?: string;
}

export interface GuidanceDecision {
  binding: Ref;
  target: Ref;
  adoption: Ref;
  applicability: true | false | 'unknown';
  disposition: 'selected' | 'excluded' | 'needs-evidence' | 'superseded' | 'conflicted';
  obligation: 'required' | 'advisory';
  explanation: string;
  supportingRefs: Ref[];
  assessment?: Ref;
  freshness: 'current' | 'stale' | 'unknown';
}

export interface GuidancePacket {
  formatVersion: 1;
  catalog: CatalogIdentity;
  target: AttachmentTarget;
  policyRefs: Ref[];
  evaluatedAt: Instant;
  basis: Basis;
  decisions: GuidanceDecision[];
  instructionRefs: Ref[];
  evidenceRefs: Ref[];
  conflicts: Ref[];
  missingEvidence: string[];
  /** Coverage of the named authorized selection; independent of readiness or purpose satisfaction. */
  complete: boolean;
  /** Known visible selected references omitted from this response, including required guidance. */
  omittedRefs: Ref[];
  nextCursor?: string;
  digest: Digest;
}

/** workspace.read vNext supplies this packet only when explicitly supported. */
export interface GuidedContextPacket extends ContextPacket {
  guidance: GuidancePacket;
}

export interface PurposeEvaluation {
  purpose: Ref;
  basis: Basis;
  state: 'incomplete' | 'satisfied' | 'resting' | 'unknown';
  criterionDecisions: GuidanceDecision[];
  pendingExecutionRefs: Ref[];
  missingEvidence: string[];
  evidence: Evidence;
}

/** Extraction output is a candidate, including an explicit candidate status. */
export interface ExtractionCandidate {
  status: 'candidate';
  record: { kind: 'target'; payload: ConsistencyTarget }
    | { kind: 'binding'; payload: GuidanceBinding }
    | { kind: 'exception'; payload: GuidanceException }
    | { kind: 'purpose'; payload: PurposeDefinition }
    | { kind: 'fact'; payload: GuidanceFact }
    | { kind: 'procedure'; payload: GuidanceProcedure };
  sourceRefs: Ref[];
  interpretation: 'explicit-direction' | 'inferred-preference' | 'engineering-proposal';
  match: { kind: 'new' } | { kind: 'possible-duplicate' | 'refinement' | 'conflict'; refs: Ref[] };
  evidence: Evidence;
}

export interface ExtractionOutput {
  basis: Basis;
  candidates: ExtractionCandidate[];
  unresolved: string[];
  consumedSourceRefs: Ref[];
}

export interface WorkerProfile {
  capability: Ref;
  inputSchema: SchemaRef;
  outputSchema: SchemaRef;
  toolProfile: Ref;
  maximumTurns: number;
  maximumWallMillis: number;
  modelPreference?: string;
  continuation: 'ephemeral' | 'durable';
  sourceRefs: Ref[];
}

/** One admitted work definition maps to one existing execution lifecycle. */
export interface WorkDefinition {
  id: Id;
  incidentId: Id;
  purpose: Ref;
  grant: Ref;
  procedure: Ref;
  profile: Ref;
  basis: Basis;
  input: Json;
  limits: Limits;
  /** Equality is checked inside the authorized scope; it is not an authority key. */
  deduplicationDigest: Digest;
}

export interface WorkReceipt {
  definition: Stored<WorkDefinition>;
  execution: Stored<Execution>;
  native?: { adapter: Ref; threadId: string; turnIds: string[] };
  resultRefs: Ref[];
}

export interface RepairProposal {
  purpose: Ref;
  assessmentRefs: Ref[];
  basis: Basis;
  coordinationRefs: Ref[];
  changes: { subject: Ref; expectedContentDigest: Digest; proposedContent: Ref }[];
  graphChanges: Change[];
  verificationProcedures: Ref[];
  evidence: Evidence;
}

export interface GoalDraft {
  purpose: Ref;
  intentCapture: Ref;
  objective: string;
  guidance: Ref;
  basis: Basis;
  carriedForward: Ref[];
  discharged: Ref[];
  superseded: Ref[];
  unresolved: Ref[];
}

/** An operator/native-host action; not a model tool or source-derived permission. */
export interface NativeGoalHandoff {
  draft: Ref;
  adapter: Ref;
  threadId: string;
  expectedObjectiveDigest: Digest;
  expectedStatus: 'none' | 'active' | 'paused' | 'complete' | 'blocked';
  desiredStatus: 'active' | 'paused';
  authorizationRefs: Ref[];
}

export interface NativeGoalReceipt {
  handoff: Ref;
  state: 'verified' | 'conflict' | 'unknown';
  actualObjectiveDigest?: Digest;
  actualStatus?: string;
  evidence: Evidence;
}

/** Proposed methods. Existence of these types grants no callable availability. */
export interface EvolutionMethods {
  'guidance.resolve': { input: GuidanceRequest; output: GuidancePacket };
  'guidance.adopt': {
    input: Mutation & { id: Id; adoption: GuidanceAdoption; basis: Basis };
    output: Stored<GuidanceAdoption>;
  };
  'purpose.evaluate': { input: { target: AttachmentTarget; purpose: Ref; factRefs: Ref[]; maximumBytes: number }; output: PurposeEvaluation };
  'work.request': { input: Mutation & { work: WorkDefinition }; output: WorkReceipt };
  'work.read': { input: { target: AttachmentTarget; workId: Id }; output: WorkReceipt };
  'work.cancel': { input: Mutation & { workId: Id; reason: string }; output: WorkReceipt };
  'work.reconcile': {
    input: Mutation & {
      workId: Id;
      attempt: number;
      resolution: Reconciliation;
      usage: ExecutionUsage;
    };
    output: WorkReceipt;
  };
}

export type EvolutionMethod = keyof EvolutionMethods;
export interface EvolutionClient {
  call<M extends EvolutionMethod>(method: M, input: EvolutionMethods[M]['input']): Promise<Result<EvolutionMethods[M]['output']>>;
}
