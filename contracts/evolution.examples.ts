/** Compile-only consumer examples for the complete, unimplemented extension. */
import type { Condition, Ref } from './index.js';
import type {
  Basis, ConsistencyTarget, EvolutionClient, EvolutionMethods, ExtractionCandidate,
  GuidanceAssessment, GuidanceBinding, GuidanceScope, NativeGoalHandoff,
  PurposeDefinition,
} from './evolution.js';

const ref: Ref = { systemId: 'system', contextId: 'context', id: 'example' };
const applies: Condition = { kind: 'equal', left: { kind: 'binding', name: 'guidance.task.concern' }, right: { kind: 'literal', value: 'documentation' } };
const scope: GuidanceScope = { contextId: 'context', projectIds: ['project'], incidentIds: [], subjectRefs: [] };
const basis: Basis = { records: [{ ref, digest: 'sha256:example', revision: 3 }], sources: [{ capture: ref, contentDigest: 'sha256:source' }] };

export const documentationTarget: ConsistencyTarget = {
  title: 'Contract descriptions agree with their owning definition',
  desiredRelation: 'Definitions, implementation, examples and guides describe the same accepted behavior.',
  rationale: 'Changes stay discoverable and prevent divergent meanings.',
  applicability: applies,
  criterion: { statement: 'Affected representations agree and references locate the owning definition.', assessment: 'mixed', procedureRefs: [ref], acceptanceRefs: [ref] },
  sourceRefs: [ref],
};

export const projectBinding: GuidanceBinding = {
  target: ref, scope, roles: { definition: [ref], guide: [ref] }, obligation: 'required', applicability: applies,
  interpretation: 'The API reference owns behavior; this guide owns the operator procedure.',
  procedureRefs: [ref], basis, sourceRefs: [ref],
};

export const maintainedPurpose: PurposeDefinition = {
  title: 'Maintain meaningful project consistency', objective: 'Preserve applicable, accepted relationships as project work changes.',
  kind: 'maintained', scope, criterionBindings: [{ binding: ref, obligation: 'required' }],
  sourceRefs: [ref], continuationRefs: [ref],
};

export const extraction: ExtractionCandidate = {
  status: 'candidate', record: { kind: 'target', payload: documentationTarget }, sourceRefs: [ref],
  interpretation: 'explicit-direction', match: { kind: 'new' },
  evidence: { sources: [ref], artifactDigests: [], method: 'Exact selected user direction; adoption remains separate.' },
};

export const observation: GuidanceAssessment = {
  binding: ref, criterionDigest: 'sha256:criterion', basis,
  result: { kind: 'unknown', missingEvidence: ['The current guide has not been inspected.'] },
  evidence: { sources: [ref], artifactDigests: [], method: 'Bounded source inspection' },
  observedAt: '2026-11-13T00:00:00Z',
};

export async function resolveSelectedWork(client: EvolutionClient) {
  return client.call('guidance.resolve', {
    target: { systemId: 'system', contextId: 'context', projectId: 'project' },
    task: { intent: ref, subjectRefs: [ref], factRefs: [], description: 'Update an affected API guide.' },
    maximumBytes: 16384, limit: 20,
  });
}

export const goalHandoff: NativeGoalHandoff = {
  draft: ref, adapter: ref, threadId: 'native-thread', expectedObjectiveDigest: 'sha256:old-objective',
  expectedStatus: 'paused', desiredStatus: 'active', authorizationRefs: [ref],
};

// Mutation admission requires both context revision and exact retry identity.
// @ts-expect-error A source reference is not a complete adoption mutation.
export const unguardedAdoption: EvolutionMethods['guidance.adopt']['input'] = { id: 'adoption', basis };

// Findings are required to claim demonstrated divergence.
// @ts-expect-error Divergence requires attributable findings.
export const inventedDivergence: GuidanceAssessment['result'] = { kind: 'divergent' };

// Inference output cannot manufacture active acceptance through its status.
// @ts-expect-error Extraction returns candidates, not adopted instructions.
export const selfActivated: ExtractionCandidate['status'] = 'active';

// Native activation does not accept a goal draft as a substitute for prior-state guards.
// @ts-expect-error Handoffs require prior objective/status, adapter and authorization basis.
export const blindResume: NativeGoalHandoff = { draft: ref, threadId: 'thread', desiredStatus: 'active' };

// Caller labels cannot choose the transport principal.
export const callerClaim: EvolutionMethods['guidance.resolve']['input'] = {
  target: { systemId: 'system', contextId: 'context' }, task: { subjectRefs: [], factRefs: [] }, maximumBytes: 4096, limit: 5,
  // @ts-expect-error Actual identity comes from the authenticated transport.
  principalId: 'another-agent',
};

// Timeout is not evidence that a previous model turn or effect never ran.
export const unsafeRetry: EvolutionMethods['work.reconcile']['input'] = {
  contextId: 'context', expectedRevision: 4, idempotencyKey: 'exact-reconciliation', workId: 'work', attempt: 1,
  // @ts-expect-error Retry needs non-dispatch or qualified idempotence evidence.
  resolution: { kind: 'retry', basis: 'timeout', evidence: { sources: [], artifactDigests: [], method: 'Timed out' } },
  usage: { cpuMillis: 0, memoryBytes: 0, outputBytes: 0, modelTokens: 0, apiSpendMicrounits: 0 },
};
