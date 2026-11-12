import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluatePolicy, UNKNOWN } from '../runtime/conditions.mjs';
const literal = value => ({ kind: 'literal', value });
const equal = (a,b) => ({ kind: 'equal', left: literal(a), right: literal(b) });
const missing = { kind: 'equal', left: { kind: 'binding', name: 'absent' }, right: literal(true) };
const env = { bindings: { principalId: 'actual', incidentId: 'selected' } };

test('three-valued logic preserves unknown information under negation and composition', () => {
  assert.equal(evaluate(missing, env), UNKNOWN);
  assert.equal(evaluate({ kind: 'not', term: missing }, env), UNKNOWN);
  assert.equal(evaluate({ kind: 'all', terms: [missing, equal(1,2)] }, env), false);
  assert.equal(evaluate({ kind: 'any', terms: [missing, equal(1,1)] }, env), true);
  assert.equal(evaluate(equal('1',1), env), false);
  assert.equal(evaluate(equal({ a: 1, b: 2 }, { b: 2, a: 1 }), env), true);
  assert.throws(() => evaluate({ kind: 'lessOrEqual', left: literal('1'), right: literal(2) }, env), { code: 'INVALID_ARGUMENT' });
});

test('policy denies and unresolved denies take precedence over a matching permit', () => {
  const permit = { id: 'p', effect: 'permit', actions: ['read'], when: equal(true,true) };
  const policy = rules => ({ rules });
  assert.equal(evaluatePolicy(policy([permit]), 'read', env), 'permit');
  assert.equal(evaluatePolicy(policy([permit]), 'write', env), 'deny');
  assert.equal(evaluatePolicy(policy([permit,{ ...permit, effect: 'deny' }]), 'read', env), 'deny');
  assert.equal(evaluatePolicy(policy([permit,{ ...permit, effect: 'deny', when: missing }]), 'read', env), 'indeterminate');
  assert.equal(evaluatePolicy(policy([{ ...permit, when: missing }]), 'read', env), 'indeterminate');
});

test('queries default to unknown and dispatch only to admitted query callbacks', () => {
  assert.equal(evaluate({ kind: 'exists', selector: {} }, env), UNKNOWN);
  assert.equal(evaluate({ kind: 'exists', selector: { ids: ['selected'] } }, { ...env, exists: selector => selector.ids.includes('selected') }), true);
  const related = { kind: 'related', from: literal('a'), to: literal('b'), schemaNames: ['permission'], maxHops: 2 };
  assert.equal(evaluate(related, env), UNKNOWN);
  assert.equal(evaluate(related, { ...env, related: (a,b,names,hops) => a === 'a' && b === 'b' && names[0] === 'permission' && hops === 2 }), true);
  assert.equal(evaluate({ kind: 'not', term: equal(true,false) }, { ...env, maxNodes: 1 }), UNKNOWN);
});

test('malformed query results cannot turn into permission under negation', () => {
  const node = { kind: 'not', term: { kind: 'exists', selector: {} } };
  for (const value of [undefined, null, 0, 'false']) assert.equal(evaluate(node, { ...env, exists: () => value }), UNKNOWN);
});
