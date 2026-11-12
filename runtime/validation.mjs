import Ajv from 'ajv/dist/2020.js';
import { canonical, fail } from './json.mjs';

const object = (required, optional = {}) => ({ type: 'object', properties: { ...required, ...optional }, required: Object.keys(required), additionalProperties: false });
const array = items => ({ type: 'array', items, maxItems: 1000 });
const text = { type: 'string', maxLength: 65536 };
const string = { type: 'string', minLength: 1, maxLength: 4096 };
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const id = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' };
const hash = { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' };
const instant = { type: 'string', pattern: '^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(?:\\.\\d{1,3})?Z$' };
const enumeration = (...values) => ({ enum: values });
const reference = name => ({ $ref: `#/$defs/${name}` });
const defs = {
  Ref: object({ systemId: id, contextId: id, id }),
  SchemaRef: object({ name: string, version: string, digest: hash }),
  Evidence: object({ sources: array(reference('Ref')), method: string, artifactDigests: array(hash) }),
  Limits: object({ concurrentExecutions: integer, cpuMillis: integer, memoryBytes: integer, outputBytes: integer, modelTokens: integer, apiSpendMicrounits: integer, currency: string }, { deadline: instant }),
  Incident: object({ purpose: text, completionCriteria: array(string), status: enumeration('open', 'resting', 'completed', 'cancelled'), continuation: array(reference('Ref')) }),
  Selector: object({ assertionStatus: enumeration('asserted', 'withdrawn', 'any') }, { ids: array(id), schemaNames: array(string), relatedTo: reference('Ref'), relationRole: string }),
  Operand: { anyOf: [object({ kind: { const: 'literal' }, value: true }), object({ kind: { const: 'binding' }, name: string })] },
};
defs.Condition = { anyOf: [
  ...['all', 'any'].map(kind => object({ kind: { const: kind }, terms: { ...array(reference('Condition')), minItems: 1 } })),
  object({ kind: { const: 'not' }, term: reference('Condition') }),
  ...['equal', 'lessOrEqual'].map(kind => object({ kind: { const: kind }, left: reference('Operand'), right: reference('Operand') })),
  object({ kind: { const: 'exists' }, selector: reference('Selector') }),
  object({ kind: { const: 'related' }, from: reference('Operand'), to: reference('Operand'), schemaNames: array(string), maxHops: { type: 'integer', minimum: 1, maximum: 8 } }),
] };
defs.Policy = object({ id, rules: array(object({ id: string, effect: enumeration('permit', 'deny'), actions: array(string), when: reference('Condition') })), limits: reference('Limits'), evidence: reference('Evidence') }, { parent: reference('Ref') });
defs.Grant = object({ id, principalId: id, actions: array(string), incidentIds: { anyOf: [{ const: 'all' }, array(id)] }, resourceRefs: array(reference('Ref')), delegable: { type: 'boolean' }, limits: reference('Limits') }, { parentGrant: reference('Ref'), expiresAt: instant });
defs.Record = { anyOf: [
  object({ kind: { const: 'atom' }, id, schema: reference('SchemaRef'), value: true }),
  object({ kind: { const: 'relation' }, id, schema: reference('SchemaRef'), roles: { type: 'object', additionalProperties: array(reference('Ref')), maxProperties: 32 } }),
] };
defs.Assertion = object({ id, record: reference('Ref'), evidence: reference('Evidence') }, { validDuring: reference('Ref') });
defs.Change = { anyOf: [
  object({ kind: { const: 'record.put' }, record: reference('Record') }),
  object({ kind: { const: 'assertion.put' }, assertion: reference('Assertion') }),
  object({ kind: { const: 'assertion.withdraw' }, assertionId: id, reason: string }),
] };
defs.View = object({ id, selector: reference('Selector'), fields: array(string) }, { groupBy: enumeration('record', 'schema') });
defs.Rule = object({ id, triggerEventTypes: array(string), condition: reference('Condition'), operation: string, literalInput: true, inputBindings: { type: 'object', additionalProperties: string }, limits: reference('Limits') });
const read = { contextId: id };
const readOptional = { atRevision: integer };
const mutation = { contextId: id, expectedRevision: integer, idempotencyKey: string };
const page = { type: 'integer', minimum: 1, maximum: 100 };
export const inputSchemas = {
  'system.describe': object({ protocolVersion: { const: '0.1' } }),
  'context.create': object({ idempotencyKey: string, id, label: string, bootstrapProfile: string, limits: reference('Limits') }),
  'context.get': object(read, readOptional),
  'context.close': object({ ...mutation, reason: string }),
  'control.get': object({ ...read, ref: reference('Ref') }, readOptional),
  'schema.publish': object({ ...mutation, schema: reference('SchemaRef'), document: true }),
  'schema.get': object({ ...read, schema: reference('SchemaRef') }, readOptional),
  'incident.create': object({ ...mutation, id, incident: reference('Incident') }),
  'incident.get': object({ ...read, incidentId: id }, readOptional),
  'incident.update': object({ ...mutation, incidentId: id, incident: reference('Incident'), evidence: reference('Evidence') }),
  'graph.transact': object({ ...mutation, changes: array(reference('Change')) }),
  'graph.query': object({ ...read, selector: reference('Selector'), limit: page }, { ...readOptional, cursor: string }),
  'policy.publish': object({ ...mutation, policy: reference('Policy') }),
  'policy.activate': object({ ...mutation, policy: reference('Ref'), evidence: reference('Evidence') }),
  'policy.evaluate': object({ ...read, action: string, incidentId: id, resourceRefs: array(reference('Ref')), grant: reference('Ref') }, readOptional),
  'grant.issue': object({ ...mutation, grant: reference('Grant') }),
  'grant.revoke': object({ ...mutation, grant: reference('Ref'), reason: string }),
  'view.publish': object({ ...mutation, view: reference('View') }),
  'view.read': object({ ...read, view: reference('Ref'), limit: page }, { ...readOptional, cursor: string }),
  'rule.publish': object({ ...mutation, rule: reference('Rule') }),
  'reaction.evaluate': object({ ...read, rule: reference('Ref'), eventIds: array(id), incidentId: id }, readOptional),
};
const ajv = new Ajv({ strict: true, allErrors: false, ownProperties: true });
const validators = new Map(Object.entries(inputSchemas).map(([method, schema]) => [method, ajv.compile({ ...schema, $defs: defs })]));
const bindings = new Set(['principalId', 'incidentId', 'action', 'resourceRefs', 'contextRevision', 'now', 'event.id', 'event.type', 'event.subjectRefs']);
export function validateCondition(condition) {
  let count = 0;
  function visit(node, depth) {
    if (++count > 256 || depth > 16) fail('LIMIT_EXCEEDED', 'Condition exceeds node or depth bound');
    for (const operand of [node.left, node.right, node.from, node.to]) if (operand?.kind === 'binding' && !bindings.has(operand.name)) fail('INVALID_ARGUMENT', 'Unknown condition binding');
    if (node.kind === 'lessOrEqual') for (const term of [node.left, node.right]) if (term.kind === 'literal' && (typeof term.value !== 'number' || !Number.isFinite(term.value))) fail('INVALID_ARGUMENT', 'Numeric comparison requires finite number literals');
    for (const term of node.terms ?? []) visit(term, depth + 1);
    if (node.term) visit(node.term, depth + 1);
  }
  visit(condition, 1);
}
export function validateInput(method, input) {
  if (!validators.has(method)) fail('INVALID_ARGUMENT', `Method is not implemented: ${method}`);
  const queue = [[input, 0]];
  while (queue.length) {
    const [value, depth] = queue.pop();
    if (depth > 64) fail('LIMIT_EXCEEDED', 'JSON input exceeds depth bound');
    if (value && typeof value === 'object') for (const item of Object.values(value)) queue.push([item, depth + 1]);
  }
  let encoded;
  try { encoded = canonical(input); } catch { fail('INVALID_ARGUMENT', 'Input must be finite canonical JSON'); }
  if (Buffer.byteLength(encoded) > 1048576) fail('LIMIT_EXCEEDED', 'Input exceeds frame bound');
  if (!validators.get(method)(input)) fail('INVALID_ARGUMENT', `Invalid ${method} input`);
  if (input.selector?.relationRole && !input.selector.relatedTo) fail('INVALID_ARGUMENT', 'A relation role requires a related reference');
  if (input.view?.selector?.relationRole && !input.view.selector.relatedTo) fail('INVALID_ARGUMENT', 'A relation role requires a related reference');
  for (const value of [input.limits?.deadline, input.policy?.limits?.deadline, input.grant?.limits?.deadline, input.grant?.expiresAt, input.rule?.limits?.deadline]) {
    if (value === undefined) continue;
    const normal = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction ?? '').padEnd(3, '0')}Z`);
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== normal) fail('INVALID_ARGUMENT', 'Invalid UTC calendar instant');
  }
  if (input.policy?.rules) for (const rule of input.policy.rules) validateCondition(rule.when);
  if (input.rule) validateCondition(input.rule.condition);
}

export function compileDocument(document) {
  let count = 0;
  const maps = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
  const singles = new Set(['additionalProperties', 'unevaluatedProperties', 'propertyNames', 'contains', 'items', 'not', 'if', 'then', 'else', 'unevaluatedItems', 'additionalItems', 'contentSchema']);
  const lists = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
  const visit = (value, depth) => {
    if (++count > 2048 || depth > 32) fail('LIMIT_EXCEEDED', 'Schema exceeds admission bounds');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (['$ref', '$dynamicRef'].includes(key) && (typeof item !== 'string' || !item.startsWith('#'))) fail('INVALID_ARGUMENT', 'Schema references must be local');
      if (key === '$id' || key === '$async') fail('INVALID_ARGUMENT', 'Schema IDs and asynchronous validation are unsupported');
      if (maps.has(key) && item && typeof item === 'object') for (const child of Object.values(item)) visit(child, depth + 1);
      else if (lists.has(key) && Array.isArray(item)) for (const child of item) visit(child, depth + 1);
      else if (singles.has(key)) visit(item, depth + 1);
    }
  };
  let encoded;
  try { encoded = canonical(document); } catch { fail('INVALID_ARGUMENT', 'Schema must be finite JSON'); }
  if (Buffer.byteLength(encoded) > 1048576) fail('LIMIT_EXCEEDED', 'Schema exceeds byte bound');
  visit(document, 0);
  try { return new Ajv({ strict: true, allErrors: false, ownProperties: true }).compile(document); }
  catch { fail('INVALID_ARGUMENT', 'Invalid or unsupported JSON Schema 2020-12 document'); }
}
