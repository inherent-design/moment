import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../runtime/store.mjs';
import { Kernel } from '../runtime/kernel.mjs';
import { digest } from '../runtime/json.mjs';

const limits = { concurrentExecutions: 1, cpuMillis: 10000, memoryBytes: 10000, outputBytes: 10000, modelTokens: 0, apiSpendMicrounits: 0, currency: 'USD' };
const incident = { purpose: 'Keep an attributable result', completionCriteria: ['One real observation'], status: 'open', continuation: [] };
function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'moment-kernel-'));
  const systemId = randomUUID(), ownerId = randomUUID(), contextId = randomUUID(), cursorKey = 'test-only-secret-key-at-least-32-bytes';
  const filename = join(directory, 'store.sqlite');
  let store = new Store(filename, systemId), kernel = new Kernel(store, { ownerId, cursorKey });
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const call = (method,input,principal = ownerId) => kernel.call(method,input,principal);
  const create = { id: contextId, label: 'Kernel context', bootstrapProfile: 'owner-local', idempotencyKey: 'bootstrap', limits };
  assert.equal(call('context.create',create).ok,true);
  const write = (method,input,key = randomUUID()) => call(method,{ contextId, expectedRevision: store.read(contextId).context.revision, idempotencyKey: key, ...input });
  return { call,write,contextId,ownerId,systemId,create, get store() { return store; }, reopen() { store.close(); store = new Store(filename,systemId); kernel = new Kernel(store,{ ownerId,cursorKey }); } };
}
function schema(f,document = { type: 'string' }) {
  const value = { name: `test.${randomUUID()}`,version:'1',digest:digest(document) };
  assert.equal(f.write('schema.publish',{ schema:value,document }).ok,true);
  return value;
}
const atom = schema => ({ kind:'atom',id:randomUUID(),schema,value:'observation' });

test('kernel authenticates admission and stores bootstrap policy atomically with context',t => {
  const f=setup(t);
  assert.equal(f.call('context.get',{ contextId:f.contextId },randomUUID()).error.code,'FORBIDDEN');
  assert.equal(f.call('system.describe',{ protocolVersion:'0.1' },null).error.code,'UNAUTHENTICATED');
  const context=f.call('context.get',{ contextId:f.contextId }).value;
  const policy=f.call('control.get',{ contextId:f.contextId,ref:context.policy }).value.value;
  assert.equal(policy.rules[0].effect,'permit');
  assert.ok(policy.rules[0].actions.includes('policy.activate'));
  assert.equal(f.call('system.describe',{ protocolVersion:'0.1' }).value.methods.includes('policy.activate'),false);
  assert.deepEqual(f.call('context.create',f.create).value,context);
  assert.equal(f.call('context.create',{ ...f.create,id:randomUUID() }).error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal(f.call('system.describe',{ protocolVersion:'0.1' }).value.methods.includes('execution.request'),false);
});

test('invalid input, unsupported profiles and unauthorized bootstrap leave no context',t => {
  const f=setup(t), id=randomUUID();
  assert.equal(f.call('context.create',{ ...f.create,id,bootstrapProfile:'invented',idempotencyKey:'other' }).error.code,'INVALID_ARGUMENT');
  assert.throws(()=>f.store.read(id),{ code:'NOT_FOUND' });
  assert.equal(f.call('context.create',{ ...f.create,id },randomUUID()).error.code,'FORBIDDEN');
  assert.equal(f.call('context.get',{ contextId:f.contextId,principalId:f.ownerId }).error.code,'INVALID_ARGUMENT');
});

test('schema admission checks digest, version identity and payload shape before committing',t => {
  const f=setup(t); const s=schema(f);
  const record=atom(s);const revision=f.store.read(f.contextId).context.revision;
  assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record:{ ...record,value:42 } }] }).error.code,'INVALID_ARGUMENT');
  assert.equal(f.store.read(f.contextId).context.revision,revision);
  assert.equal(f.write('schema.publish',{ schema:{ ...s,digest:digest({ type:'number' }) },document:{ type:'number' } }).error.code,'IDENTITY_CONFLICT');
  assert.equal(f.write('schema.publish',{ schema:{ ...s,name:'test.bad' },document:{ type:'boolean' } }).error.code,'INVALID_ARGUMENT');
  assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record }] }).ok,true);
  assert.deepEqual(f.call('schema.get',{ contextId:f.contextId,schema:s }).value,{ type:'string' });
});

test('API writes survive reopening with exact original response and guarded retry',t => {
  const f=setup(t), id=randomUUID();
  const request={ contextId:f.contextId,expectedRevision:1,idempotencyKey:'incident-1',id,incident };
  const first=f.call('incident.create',request);assert.equal(first.ok,true);
  assert.deepEqual(Object.keys(first.value.value).sort(),Object.keys(incident).sort());
  assert.equal(first.value.digest,digest(incident));
  f.reopen();
  assert.deepEqual(f.call('incident.create',request),first);
  assert.deepEqual(f.call('incident.get',{ contextId:f.contextId,incidentId:id }),first);
  assert.equal(f.call('incident.create',{ ...request,incident:{ ...incident,purpose:'changed' } }).error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal(f.call('incident.create',{ ...request,id:randomUUID(),idempotencyKey:'another' }).error.code,'REVISION_CONFLICT');
});

test('incidents need real reference evidence to complete and cannot silently reopen',t => {
  const f=setup(t), id=randomUUID();
  f.write('incident.create',{ id,incident });
  const complete={ incidentId:id,incident:{ ...incident,status:'completed' },evidence:{ sources:[],method:'verified',artifactDigests:[] } };
  assert.equal(f.write('incident.update',complete).error.code,'INVALID_ARGUMENT');
  const record=atom(schema(f));f.write('graph.transact',{ changes:[{ kind:'record.put',record }] });
  complete.evidence.sources=[{ systemId:f.systemId,contextId:f.contextId,id:record.id }];
  assert.equal(f.write('incident.update',complete).ok,true);
  assert.equal(f.write('incident.update',{ ...complete,incident }).error.code,'FORBIDDEN');
  assert.equal(f.call('incident.get',{ contextId:f.contextId,incidentId:id,atRevision:2 }).value.value.status,'open');
});

test('graph controls identity and schema namespace cannot be overwritten through generic records',t => {
  const f=setup(t);const id=randomUUID();f.write('incident.create',{ id,incident });
  const s=schema(f);const record={ ...atom(s),id };
  assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record }] }).error.code,'IDENTITY_CONFLICT');
  assert.equal(f.write('schema.publish',{ schema:{ ...s,name:'moment.within' },document:{ type:'string' } }).error.code,'FORBIDDEN');
  const relationSchema=schema(f,{ type:'object',additionalProperties:{ type:'array',items:{ type:'object' } } });
  assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record:{ kind:'relation',id:randomUUID(),schema:relationSchema,roles:{ subject:[{ systemId:randomUUID(),contextId:f.contextId,id }] } } }] }).error.code,'NOT_FOUND');
});

test('query cursors bind principal, selection and snapshot across later writes',t => {
  const f=setup(t), s=schema(f), records=[atom(s),atom(s),atom(s)];
  f.write('graph.transact',{ changes:records.map(record=>({ kind:'record.put',record })) });
  const input={ contextId:f.contextId,selector:{ assertionStatus:'any' },limit:1 };
  const first=f.call('graph.query',input).value; assert.equal(first.items.length,1);assert.ok(first.nextCursor);
  f.write('graph.transact',{ changes:[{ kind:'record.put',record:atom(s) }] });
  const second=f.call('graph.query',{ ...input,cursor:first.nextCursor }).value;
  assert.equal(second.snapshotRevision,first.snapshotRevision);assert.notEqual(second.items[0].record.value.id,first.items[0].record.value.id);
  assert.equal(f.call('graph.query',{ ...input,selector:{ assertionStatus:'asserted' },cursor:first.nextCursor }).error.code,'INVALID_ARGUMENT');
  assert.equal(f.call('graph.query',{ ...input,cursor:first.nextCursor.replace(/\.[^.]+$/,'.'+'é'.repeat(64)) }).error.code,'INVALID_ARGUMENT');
});

test('closure is revisioned, retryable and prevents new admitted work',t => {
  const f=setup(t), input={ contextId:f.contextId,expectedRevision:1,idempotencyKey:'close',reason:'user request' };
  const first=f.call('context.close',input);assert.equal(first.ok,true);
  assert.deepEqual(f.call('context.close',input),first);
  assert.equal(f.call('context.get',{ contextId:f.contextId }).value.state,'closed');
  assert.equal(f.call('context.get',{ contextId:f.contextId,atRevision:1 }).value.state,'open');
  assert.equal(f.write('incident.create',{ id:randomUUID(),incident }).error.code,'FORBIDDEN');
});
