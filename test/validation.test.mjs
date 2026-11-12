import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateInput, compileDocument } from '../runtime/validation.mjs';

const id = randomUUID();
const mutation = { contextId: id, expectedRevision: 1, idempotencyKey: 'retry' };
const literal = value => ({ kind: 'literal', value });
const condition = { kind: 'equal', left: literal(true), right: literal(true) };
const limits = { concurrentExecutions: 1, cpuMillis: 1, memoryBytes: 1, outputBytes: 1, modelTokens: 0, apiSpendMicrounits: 0, currency: 'USD' };
const policy = { id, rules: [{ id: 'rule', effect: 'permit', actions: ['graph.query'], when: condition }], limits, evidence: { sources: [], method: 'fixture', artifactDigests: [] } };

test('actual API validation accepts correct input and rejects forged fields and missing guards', () => {
  validateInput('context.get', { contextId: id });
  validateInput('graph.transact', { ...mutation, changes: [] });
  for (const [method, value] of [
    ['context.get', { contextId: id, principalId: id }],
    ['context.get', { contextId: '../../etc/passwd' }],
    ['context.get', { contextId: id, atRevision: -1 }],
    ['graph.transact', { contextId: id, changes: [] }],
    ['graph.transact', { ...mutation, changes: [{ kind: 'policy.activate' }] }],
    ['graph.query', { contextId: id, selector: { assertionStatus: 'any' }, limit: 101 }],
  ]) assert.throws(() => validateInput(method, value), { code: 'INVALID_ARGUMENT' });
});

test('conditions reject unknown bindings and excessive depth before admission', () => {
  validateInput('policy.publish', { ...mutation, policy });
  const unknown = { ...policy, rules: [{ ...policy.rules[0], when: { ...condition, left: { kind: 'binding', name: 'caller_supplied_admin' } } }] };
  assert.throws(() => validateInput('policy.publish', { ...mutation, policy: unknown }), { code: 'INVALID_ARGUMENT' });
  let deep = condition;
  for (let i = 0; i < 17; i++) deep = { kind: 'not', term: deep };
  assert.throws(() => validateInput('policy.publish', { ...mutation, policy: { ...policy, rules: [{ ...policy.rules[0], when: deep }] } }), { code: 'LIMIT_EXCEEDED' });
});

test('JSON shape and scalar checks do not coerce or accept cyclic/nonfinite values', () => {
  assert.throws(() => validateInput('context.get', { contextId: id, atRevision: '1' }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => validateInput('context.get', { contextId: id, atRevision: Infinity }), { code: 'INVALID_ARGUMENT' });
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => validateInput('context.get', cycle), { code: 'LIMIT_EXCEEDED' });
});

test('schema compiler supports local references and refuses remote or asynchronous execution', () => {
  const check = compileDocument({ type: 'object', properties: { count: { $ref: '#/$defs/count' } }, required: ['count'], additionalProperties: false, $defs: { count: { type: 'integer', minimum: 0 } } });
  assert.equal(check({ count: 0 }), true);
  assert.equal(check({ count: -1 }), false);
  for (const document of [{ $ref: 'https://example.invalid/schema.json' }, { $dynamicRef: 'file:///tmp/schema' }, { $async: true, type: 'object' }, { $id: 'a', type: 'string' }]) assert.throws(() => compileDocument(document), { code: 'INVALID_ARGUMENT' });
});

test('calendar instants and relationship selectors satisfy semantic input constraints', () => {
  const create = { id, idempotencyKey: 'x', label: 'context', bootstrapProfile: 'local', limits: { ...limits, deadline: '2026-02-28T12:30:00Z' } };
  validateInput('context.create', create);
  assert.throws(() => validateInput('context.create', { ...create, limits: { ...create.limits, deadline: '2026-02-31T12:30:00Z' } }), { code: 'INVALID_ARGUMENT' });
  assert.throws(() => validateInput('graph.query', { contextId: id, selector: { assertionStatus: 'any', relationRole: 'subject' }, limit: 1 }), { code: 'INVALID_ARGUMENT' });
});

test('schema reference restrictions apply to schema keywords, not literal data or property names', () => {
  const check = compileDocument({ type: 'object', properties: { $ref: { type: 'string' } }, required: ['$ref'], const: { $ref: 'https://example.invalid/literal-data' } });
  assert.equal(check({ $ref: 'https://example.invalid/literal-data' }), true);
  assert.throws(() => compileDocument({ $defs: { bad: { $ref: 'https://example.invalid/schema' } } }), { code: 'INVALID_ARGUMENT' });
});

test('numeric policy comparisons reject nonnumeric literals instead of coercing them', () => {
  const invalid = { ...policy, rules: [{ ...policy.rules[0], when: { kind: 'lessOrEqual', left: literal('1'), right: literal(2) } }] };
  assert.throws(() => validateInput('policy.publish', { ...mutation, policy: invalid }), { code: 'INVALID_ARGUMENT' });
});
