import Ajv from 'ajv/dist/2020.js';
import { canonical, fail } from './json.mjs';
import generated from './generated/bindings.json' with { type: 'json' };

export { inputSchemas } from './input-schemas.mjs';

const ajv = new Ajv({ strict: true, allErrors: false, ownProperties: true });
const validators = new Map(generated.operations.filter(o => o.availability==='implemented').map(o => [o.id, ajv.compile(o.inputSchema.document)]));
const bindings = new Set(['occurrence.id','occurrence.eventIds','schedule.id','contextId','event.ids','principalId', 'incidentId', 'action', 'resourceRefs', 'contextRevision', 'now', 'event.id', 'event.type', 'event.subjectRefs']);
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
  if (input.schedule?.wake?.selector?.relationRole && !input.schedule.wake.selector.relatedTo) fail('INVALID_ARGUMENT','A relation role requires a related reference');
  if (method==='events.read' && input.atRevision!==undefined && input.waitMillis!==0) fail('INVALID_ARGUMENT','Historical event reads cannot wait');
  for (const value of [input.message?.expiresAt,input.limits?.deadline, input.policy?.limits?.deadline, input.grant?.limits?.deadline, input.grant?.expiresAt, input.rule?.limits?.deadline,input.capability?.expiresAt,input.execution?.limits?.deadline,input.schedule?.wake?.instant,...(input.proposal?.executions ?? []).map(item=>item.limits.deadline)]) {
    if (value === undefined) continue;
    const normal = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction ?? '').padEnd(3, '0')}Z`);
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== normal) fail('INVALID_ARGUMENT', 'Invalid UTC calendar instant');
  }
  if (input.policy?.rules) for (const rule of input.policy.rules) validateCondition(rule.when);
  if (method==='rule.publish') validateCondition(input.rule.condition);
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
