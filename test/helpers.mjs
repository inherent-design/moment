import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../runtime/store.mjs';
import { Kernel } from '../runtime/kernel.mjs';
import { digest } from '../runtime/json.mjs';

export const limits = { concurrentExecutions: 1, cpuMillis: 10000, memoryBytes: 10000, outputBytes: 10000, modelTokens: 0, apiSpendMicrounits: 0, currency: 'USD' };
export const incident = { purpose: 'Keep an attributable result', completionCriteria: ['One real observation'], status: 'open', continuation: [] };
export function setup(t,options={}) {
  const directory = mkdtempSync(join(tmpdir(), 'moment-kernel-'));
  const systemId = randomUUID(), ownerId = randomUUID(), contextId = randomUUID(), cursorKey = 'test-only-secret-key-at-least-32-bytes';
  const filename = join(directory, 'store.sqlite');
  let store = new Store(filename, systemId), kernel = new Kernel(store, { ownerId, cursorKey,clock:options.clock });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const call = (method,input,principal = ownerId,boundGrant) => kernel.call(method,input,principal,boundGrant);
  const create = { id: contextId, label: 'Kernel context', bootstrapProfile: 'owner-local', idempotencyKey: 'bootstrap', limits:options.limits ?? limits };
  assert.equal(call('context.create',create).ok,true);
  const write = (method,input,key = randomUUID()) => call(method,{ contextId, expectedRevision: store.read(contextId).context.revision, idempotencyKey: key, ...input });
  return { directory,call,write,contextId,ownerId,systemId,create,get kernel() { return kernel; }, get store() { return store; }, reopen() { store.close(); store = new Store(filename,systemId); kernel = new Kernel(store,{ ownerId,cursorKey,clock:options.clock }); } };
}
export function schema(f,document = { type: 'string' }) {
  const value = { name: `test.${randomUUID()}`,version:'1',digest:digest(document) };
  assert.equal(f.write('schema.publish',{ schema:value,document }).ok,true);
  return value;
}
export const atom = schema => ({ kind:'atom',id:randomUUID(),schema,value:'observation' });

export function allowDelegated(f) {
  const context=f.call('context.get',{ contextId:f.contextId }).value;
  const initial=f.call('control.get',{ contextId:f.contextId,ref:context.policy }).value.value;
  const policy={ ...initial,id:randomUUID(),parent:context.policy,rules:[...initial.rules,{ id:'delegated-actions-still-require-grants',effect:'permit',actions:initial.rules[0].actions,when:{ kind:'equal',left:{ kind:'literal',value:true },right:{ kind:'literal',value:true } } }] };
  const stored=f.write('policy.publish',{ policy });assert.equal(stored.ok,true);
  assert.equal(f.write('policy.activate',{ policy:stored.value.ref,evidence:{ sources:[],method:'operator-admission',artifactDigests:[] } }).ok,true);
  return { policy,ref:stored.value.ref };
}
export function grant(f,principalId,overrides={}) {
  const value={ id:randomUUID(),principalId,actions:['context.get','graph.query','graph.transact','incident.get','control.get','grant.issue'],incidentIds:'all',resourceRefs:[],delegable:true,limits,...overrides };
  const result=f.write('grant.issue',{ grant:value });assert.equal(result.ok,true,JSON.stringify(result));return result.value;
}
export function delegated(f,actor,bound,method,input,mutation=false) {
  return f.call(method,{ contextId:f.contextId,...(mutation?{ expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:randomUUID() }:{}),...input },actor,bound.ref);
}
