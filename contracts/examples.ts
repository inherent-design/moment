/** Compile-only usage examples; these do not execute the proposed runtime. */
import type {
  Atom, Change, Condition, ExecutionIntent, Input, Limits, MomentClient,
  Outcome, Policy, Ref, Request, Result, Schedule,
} from "./index.js";

const contextId = "22222222-2222-4222-8222-222222222222";
const incidentId = "33333333-3333-4333-8333-333333333333";
const ref: Ref = {
  systemId: "11111111-1111-4111-8111-111111111111",
  contextId,
  id: incidentId,
};
const evidence = { sources: [ref], method: "fixture-observation", artifactDigests: [] };
const limits: Limits = {
  concurrentExecutions: 1,
  cpuMillis: 1000,
  memoryBytes: 16777216,
  outputBytes: 4096,
  modelTokens: 0,
  apiSpendMicrounits: 0,
  currency: "USD",
};

export const observation: Atom = {
  kind: "atom",
  id: "44444444-4444-4444-8444-444444444444",
  schema: { name: "example.observation", version: "1", digest: `sha256:${"0".repeat(64)}` },
  value: { observed: "fixture is present", sourceRevision: "example-only" },
};

export const graphRequest = {
  jsonrpc: "2.0",
  id: "request-1",
  method: "graph.transact",
  params: {
    contextId,
    expectedRevision: 4,
    idempotencyKey: "record-observation-1",
    changes: [{ kind: "record.put", record: observation }],
  },
} satisfies Request;

export const scopedCondition: Condition = {
  kind: "equal",
  left: { kind: "binding", name: "incidentId" },
  right: { kind: "literal", value: incidentId },
};

export const candidatePolicy: Policy = {
  id: "55555555-5555-4555-8555-555555555555",
  rules: [{ id: "allow-fixture-observation", effect: "permit", actions: ["graph.transact"], when: scopedCondition }],
  limits,
  evidence,
};

export const execution: ExecutionIntent = {
  id: "66666666-6666-4666-8666-666666666666",
  incidentId,
  capability: { ...ref, id: "77777777-7777-4777-8777-777777777777" },
  grant: { ...ref, id: "88888888-8888-4888-8888-888888888888" },
  input: { fixture: "selected-input" },
  limits,
};

export const wakeOnEvidence: Schedule = {
  id: "99999999-9999-4999-8999-999999999999",
  incidentId,
  rule: { ...ref, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  wake: {
    kind: "event",
    eventTypes: ["graph.transact.committed"],
    selector: { schemaNames: ["example.observation"], assertionStatus: "asserted" },
    mode: "each",
  },
  recurrence: "rearmAfterCompletion",
  coalesce: true,
};

export const uncertain: Outcome = { kind: "unknown", detail: "Receipt unavailable after dispatch", evidence };

export const retryAfterObservation: Input<"execution.reconcile"> = {
  contextId,
  expectedRevision: 10,
  idempotencyKey: "reconcile-1",
  executionId: execution.id,
  resolution: { kind: "retry", basis: "not_started", evidence },
};

export async function readIncident(client: MomentClient): Promise<Result<string>> {
  const result = await client.call("incident.get", { contextId, incidentId });
  return result.ok ? { ok: true, value: result.value.value.purpose } : result;
}

// A mutation must carry a revision guard and retry identity.
// @ts-expect-error Missing mutation guards.
export const unguarded: Input<"graph.transact"> = { contextId, changes: [] };

// Protected control state is not a generic graph operation.
// @ts-expect-error Unknown graph change discriminant.
export const bypass: Change = { kind: "policy.activate", policy: ref };

// An uncertain effect cannot be represented as success without an output.
// @ts-expect-error Success requires an output and evidence.
export const inventedSuccess: Outcome = { kind: "succeeded" };

// Authentication comes from the transport, not caller-selected fields.
export const forgedCaller: Input<"incident.get"> = {
  contextId,
  incidentId,
  // @ts-expect-error Caller identity is not an input parameter.
  principalId: "another-principal",
};

// Arbitrary code is not a condition variant.
// @ts-expect-error Policy conditions do not execute JavaScript.
export const executablePolicy: Condition = { kind: "javascript", source: "return true" };

// A retry requires an explicit, supported reconciliation basis.
export const unsupportedRetry: Input<"execution.reconcile"> = {
  ...retryAfterObservation,
  // @ts-expect-error A timeout alone does not justify repeating an effect.
  resolution: { kind: "retry", basis: "timeout", evidence },
};

// Method and parameter shapes must remain paired.
// @ts-expect-error A graph transaction cannot use read-only parameters.
export const mismatched: Request = { jsonrpc: "2.0", id: "bad", method: "graph.transact", params: { contextId } };

// The implemented client exposes the same generic operation contract.
import { createClient } from '../runtime/client.mjs';
const connection = createClient('/compile-only-example');
export const described = connection.call('system.describe', { protocolVersion: '0.1' });
// @ts-expect-error The runtime client cannot accept a caller-selected identity.
export const clientForgery = connection.call('incident.get', { contextId, incidentId, principalId: 'forged' });

import type { ProjectedRecord } from './index.js';
declare const projected: ProjectedRecord;
// @ts-expect-error A projection exposes selected fields, not an implicitly complete record.
export const hiddenProjectionPayload = projected.value;
