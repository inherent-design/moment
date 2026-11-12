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
  const call = (method,input,principal = ownerId,boundGrant) => kernel.call(method,input,principal,boundGrant);
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
  assert.equal(f.call('context.get',{ contextId:f.contextId },randomUUID()).error.code,'NOT_FOUND');
  assert.equal(f.call('system.describe',{ protocolVersion:'0.1' },null).error.code,'UNAUTHENTICATED');
  const context=f.call('context.get',{ contextId:f.contextId }).value;
  const policy=f.call('control.get',{ contextId:f.contextId,ref:context.policy }).value.value;
  assert.equal(policy.rules[0].effect,'permit');
  assert.ok(policy.rules[0].actions.includes('policy.activate'));
  assert.equal(f.call('system.describe',{ protocolVersion:'0.1' }).value.methods.includes('policy.activate'),true);
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

function allowDelegated(f) {
  const context=f.call('context.get',{ contextId:f.contextId }).value;
  const initial=f.call('control.get',{ contextId:f.contextId,ref:context.policy }).value.value;
  const policy={ ...initial,id:randomUUID(),parent:context.policy,rules:[...initial.rules,{ id:'delegated-actions-still-require-grants',effect:'permit',actions:initial.rules[0].actions,when:{ kind:'equal',left:{ kind:'literal',value:true },right:{ kind:'literal',value:true } } }] };
  const stored=f.write('policy.publish',{ policy });assert.equal(stored.ok,true);
  assert.equal(f.write('policy.activate',{ policy:stored.value.ref,evidence:{ sources:[],method:'operator-admission',artifactDigests:[] } }).ok,true);
  return { policy,ref:stored.value.ref };
}
function grant(f,principalId,overrides={}) {
  const value={ id:randomUUID(),principalId,actions:['context.get','graph.query','graph.transact','incident.get','control.get','grant.issue'],incidentIds:'all',resourceRefs:[],delegable:true,limits,...overrides };
  const result=f.write('grant.issue',{ grant:value });assert.equal(result.ok,true,JSON.stringify(result));return result.value;
}
function delegated(f,actor,bound,method,input,mutation=false) {
  return f.call(method,{ contextId:f.contextId,...(mutation?{ expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:randomUUID() }:{}),...input },actor,bound.ref);
}

test('restricted delegates can read and change selected records without reaching siblings',t=>{
  const f=setup(t);allowDelegated(f);const s=schema(f),allowed=atom(s),hidden=atom(s);
  f.write('graph.transact',{ changes:[allowed,hidden].map(record=>({ kind:'record.put',record })) });
  const actor=randomUUID(), bound=grant(f,actor,{ resourceRefs:[{ systemId:f.systemId,contextId:f.contextId,id:allowed.id }] });
  const query=delegated(f,actor,bound,'graph.query',{ selector:{ assertionStatus:'any' },limit:10 });
  assert.equal(query.ok,true);assert.deepEqual(query.value.items.map(item=>item.record.value.id),[allowed.id]);
  assert.equal(delegated(f,actor,bound,'graph.transact',{ changes:[{ kind:'record.put',record:hidden }] },true).error.code,'FORBIDDEN');
  const evidence={ id:randomUUID(),record:bound.value.resourceRefs[0],evidence:{ sources:[],method:'delegate-observed',artifactDigests:[] } };
  assert.equal(delegated(f,actor,bound,'graph.transact',{ changes:[{ kind:'assertion.put',assertion:evidence }] },true).ok,true);
  assert.equal(f.store.read(f.contextId).assertions[0].assertion.recordedBy,actor);
  const wrongActor=randomUUID();assert.equal(f.call('context.get',{ contextId:f.contextId },wrongActor,bound.ref).error.code,'FORBIDDEN');
});

test('delegation cannot widen actions, resources, budgets or incident scope',t=>{
  const f=setup(t);allowDelegated(f);const actor=randomUUID(), incidentId=randomUUID(), resource={ systemId:f.systemId,contextId:f.contextId,id:randomUUID() };
  const parent=grant(f,actor,{ actions:['grant.issue','context.get'],incidentIds:[incidentId],resourceRefs:[resource],limits:{ ...limits,cpuMillis:10 } });
  const child={ ...parent.value,id:randomUUID(),principalId:randomUUID(),parentGrant:parent.ref };
  assert.equal(delegated(f,actor,parent,'grant.issue',{ grant:child },true).ok,true);
  for (const change of [{ actions:['grant.issue','policy.activate'] },{ incidentIds:'all' },{ resourceRefs:[{ ...resource,id:randomUUID() }] },{ limits:{ ...limits,cpuMillis:11 } },{ parentGrant:undefined }]) {
    const candidate={ ...child,id:randomUUID(),...change };if (candidate.parentGrant===undefined) delete candidate.parentGrant;
    assert.equal(delegated(f,actor,parent,'grant.issue',{ grant:candidate },true).error.code,'FORBIDDEN');
  }
});

test('revocation immediately blocks descendants and historical reads or receipt replay',t=>{
  const f=setup(t);allowDelegated(f);const a=randomUUID(),b=randomUUID();
  const record=atom(schema(f));
  const parent=grant(f,a,{ actions:['grant.issue','context.get','graph.transact'],resourceRefs:[{ systemId:f.systemId,contextId:f.contextId,id:record.id }] });
  const issued=delegated(f,a,parent,'grant.issue',{ grant:{ ...parent.value,id:randomUUID(),principalId:b,parentGrant:parent.ref } },true).value;
  assert.equal(delegated(f,b,issued,'context.get',{}).ok,true);
  const original={ contextId:f.contextId,expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:'delegated-write',changes:[{ kind:'record.put',record }] };
  assert.equal(f.call('graph.transact',original,b,issued.ref).ok,true);
  f.write('grant.revoke',{ grant:parent.ref,reason:'operator revoked' });
  assert.equal(f.call('graph.transact',original,b,issued.ref).error.code,'FORBIDDEN');
  assert.equal(delegated(f,a,parent,'context.get',{}).error.code,'FORBIDDEN');
  assert.equal(delegated(f,b,issued,'context.get',{ atRevision:1 }).error.code,'FORBIDDEN');
  f.reopen();assert.equal(delegated(f,b,issued,'context.get',{}).error.code,'FORBIDDEN');
});

test('delegated policy activation narrows existing permits and refuses self-authorized expansion',t=>{
  const f=setup(t),current=allowDelegated(f);const actor=randomUUID();
  const bound=grant(f,actor,{ actions:current.policy.rules[0].actions,resourceRefs:[{ systemId:f.systemId,contextId:f.contextId,id:f.contextId }] });
  const candidate={ ...current.policy,id:randomUUID(),parent:current.ref,rules:current.policy.rules.map(rule=>rule.id==='delegated-actions-still-require-grants'?{ ...rule,actions:rule.actions.filter(action=>action!=='graph.transact') }:rule) };
  const published=delegated(f,actor,bound,'policy.publish',{ policy:candidate },true);assert.equal(published.ok,true);
  const activated=delegated(f,actor,bound,'policy.activate',{ policy:published.value.ref,evidence:{ sources:[],method:'narrow-only',artifactDigests:[] } },true);assert.equal(activated.ok,true,JSON.stringify(activated));
  const broader={ ...candidate,id:randomUUID(),rules:[...candidate.rules,{ id:'invented',effect:'permit',actions:['graph.transact'],when:{ kind:'equal',left:{ kind:'literal',value:1 },right:{ kind:'literal',value:1 } } }] };
  const draft=delegated(f,actor,bound,'policy.publish',{ policy:broader },true);assert.equal(draft.ok,true);
  assert.equal(delegated(f,actor,bound,'policy.activate',{ policy:draft.value.ref,evidence:{ sources:[],method:'try-expand',artifactDigests:[] } },true).error.code,'FORBIDDEN');
  const newIssuer={ ...candidate,id:randomUUID(),authorityIssuers:[f.ownerId,actor] };
  const forgedIssuer=delegated(f,actor,bound,'policy.publish',{ policy:newIssuer },true);
  assert.equal(delegated(f,actor,bound,'policy.activate',{ policy:forgedIssuer.value.ref,evidence:{ sources:[],method:'self-appoint',artifactDigests:[] } },true).error.code,'FORBIDDEN');
  const incidentScoped=grant(f,randomUUID(),{ actions:['policy.activate'],incidentIds:[randomUUID()] });
  assert.equal(delegated(f,incidentScoped.value.principalId,incidentScoped,'policy.activate',{ policy:draft.value.ref,evidence:{ sources:[],method:'out-of-scope',artifactDigests:[] } },true).error.code,'FORBIDDEN');
});

test('ordinary delegate assertions remain evidence until an admitted operator supports the authorization fact',t=>{
  const f=setup(t),base=allowDelegated(f);const actor=randomUUID(),incidentId=randomUUID();
  f.write('incident.create',{ id:incidentId,incident });
  const symbol=atom(schema(f));f.write('graph.transact',{ changes:[{ kind:'record.put',record:symbol }] });
  const symbolRef={ systemId:f.systemId,contextId:f.contextId,id:symbol.id };
  const bound=grant(f,actor,{ actions:['graph.transact','incident.get'],incidentIds:[incidentId],resourceRefs:[symbolRef] });
  const check={ kind:'exists',selector:{ ids:[symbol.id],assertionStatus:'asserted' } };
  const policy={ ...base.policy,id:randomUUID(),rules:[base.policy.rules[0],{ id:'write-evidence',effect:'permit',actions:['graph.transact'],when:{ kind:'equal',left:{ kind:'binding',name:'principalId' },right:{ kind:'literal',value:actor } } },{ id:'read-needs-accepted-support',effect:'permit',actions:['incident.get'],when:check }] };
  const draft=f.write('policy.publish',{ policy }).value;f.write('policy.activate',{ policy:draft.ref,evidence:{ sources:[],method:'operator',artifactDigests:[] } });
  const own={ id:randomUUID(),record:symbolRef,evidence:{ sources:[],method:'self-assertion',artifactDigests:[] } };
  assert.equal(delegated(f,actor,bound,'graph.transact',{ changes:[{ kind:'assertion.put',assertion:own }] },true).ok,true);
  assert.equal(delegated(f,actor,bound,'incident.get',{ incidentId }).error.code,'POLICY_INDETERMINATE');
  const accepted={ ...own,id:randomUUID(),evidence:{ ...own.evidence,method:'operator-observed' } };
  f.write('graph.transact',{ changes:[{ kind:'assertion.put',assertion:accepted }] });
  assert.equal(delegated(f,actor,bound,'incident.get',{ incidentId }).ok,true);
  f.write('graph.transact',{ changes:[{ kind:'assertion.withdraw',assertionId:accepted.id,reason:'support withdrawn' }] });
  assert.equal(delegated(f,actor,bound,'incident.get',{ incidentId }).error.code,'POLICY_INDETERMINATE');
  const recognized={ ...policy,id:randomUUID(),authorityIssuers:[f.ownerId,actor] };
  const admitted=f.write('policy.publish',{ policy:recognized }).value;
  f.write('policy.activate',{ policy:admitted.ref,evidence:{ sources:[],method:'operator-explicitly-admits-issuer',artifactDigests:[] } });
  assert.equal(delegated(f,actor,bound,'incident.get',{ incidentId }).ok,true);
});

test('ReBAC follows only currently supported operator relationships with visible endpoints',t=>{
  const f=setup(t),base=allowDelegated(f),actor=randomUUID(),incidentId=randomUUID();
  f.write('incident.create',{ id:incidentId,incident });
  const person={ ...atom(schema(f)),id:actor };
  const edgeSchema=schema(f,{ type:'object',additionalProperties:true });
  const ref=id=>({ systemId:f.systemId,contextId:f.contextId,id });
  const edge={ kind:'relation',id:randomUUID(),schema:edgeSchema,roles:{ subject:[ref(actor)],object:[ref(incidentId)] } };
  const support={ id:randomUUID(),record:ref(edge.id),evidence:{ sources:[],method:'operator-membership',artifactDigests:[] } };
  assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record:person },{ kind:'record.put',record:edge },{ kind:'assertion.put',assertion:support }] }).ok,true);
  const bound=grant(f,actor,{ actions:['incident.get'],incidentIds:[incidentId],resourceRefs:[ref(actor),ref(incidentId),ref(edge.id)] });
  const policy={ ...base.policy,id:randomUUID(),rules:[base.policy.rules[0],{ id:'membership-path',effect:'permit',actions:['incident.get'],when:{ kind:'related',from:{ kind:'binding',name:'principalId' },to:{ kind:'binding',name:'incidentId' },schemaNames:[edgeSchema.name],maxHops:1 } }] };
  const draft=f.write('policy.publish',{ policy }).value;f.write('policy.activate',{ policy:draft.ref,evidence:{ sources:[],method:'operator-configured',artifactDigests:[] } });
  assert.equal(delegated(f,actor,bound,'incident.get',{ incidentId }).ok,true);
  f.write('graph.transact',{ changes:[{ kind:'assertion.withdraw',assertionId:support.id,reason:'membership ended' }] });
  assert.equal(delegated(f,actor,bound,'incident.get',{ incidentId }).error.code,'POLICY_INDETERMINATE');
});

test('provenance hidden by a grant cannot leak through assertion selection or pagination',t=>{
  const f=setup(t);allowDelegated(f);const s=schema(f),claim=atom(s),source=atom(s),ref=id=>({ systemId:f.systemId,contextId:f.contextId,id });
  f.write('graph.transact',{ changes:[claim,source].map(record=>({ kind:'record.put',record })).concat([{ kind:'assertion.put',assertion:{ id:randomUUID(),record:ref(claim.id),evidence:{ sources:[ref(source.id)],method:'private-source',artifactDigests:[] } } }]) });
  const actor=randomUUID(),bound=grant(f,actor,{ actions:['graph.query'],resourceRefs:[ref(claim.id)] });
  const visible=delegated(f,actor,bound,'graph.query',{ selector:{ assertionStatus:'any' },limit:1 });
  assert.equal(visible.value.items.length,1);assert.deepEqual(visible.value.items[0].support,[]);assert.equal(visible.value.nextCursor,undefined);
  assert.equal(delegated(f,actor,bound,'graph.query',{ selector:{ assertionStatus:'asserted' },limit:1 }).value.items.length,0);
});

test('policy evaluation describes the bound principal and requested resource envelope without granting a token',t=>{
  const f=setup(t);allowDelegated(f);const actor=randomUUID(),incidentId=randomUUID(),ref={ systemId:f.systemId,contextId:f.contextId,id:randomUUID() };
  const bound=grant(f,actor,{ actions:['policy.evaluate','graph.transact'],incidentIds:[incidentId],resourceRefs:[ref] });
  const input={ action:'graph.transact',incidentId,resourceRefs:[ref],grant:bound.ref };
  assert.equal(delegated(f,actor,bound,'policy.evaluate',input).value.decision,'permit');
  const denied=delegated(f,actor,bound,'policy.evaluate',{ ...input,resourceRefs:[{ ...ref,id:randomUUID() }] });
  assert.equal(denied.ok,true);assert.equal(denied.value.decision,'deny');
  assert.equal(delegated(f,actor,bound,'policy.evaluate',{ ...input,grant:{ ...bound.ref,id:randomUUID() } }).error.code,'FORBIDDEN');
});

test('incident-scoped administration cannot close its containing context',t=>{
  const f=setup(t);allowDelegated(f);const actor=randomUUID(),incidentId=randomUUID();
  const bound=grant(f,actor,{ actions:['context.close','policy.evaluate'],incidentIds:[incidentId] });
  assert.equal(delegated(f,actor,bound,'context.close',{ reason:'out-of-scope' },true).error.code,'FORBIDDEN');
  assert.equal(f.call('context.get',{ contextId:f.contextId }).value.state,'open');
  assert.equal(delegated(f,actor,bound,'policy.evaluate',{ action:'context.close',incidentId,resourceRefs:[],grant:bound.ref }).value.decision,'deny');
});

test('same-principal credentials cannot revoke grants belonging to another delegation branch',t=>{
  const f=setup(t);allowDelegated(f);const actor=randomUUID();
  const a=grant(f,actor,{ actions:['grant.issue','grant.revoke','context.get'] });
  const b=grant(f,actor,{ actions:['grant.issue','grant.revoke','context.get'] });
  const leaf=delegated(f,actor,b,'grant.issue',{ grant:{ ...b.value,id:randomUUID(),parentGrant:b.ref,principalId:randomUUID() } },true).value;
  assert.equal(delegated(f,actor,a,'grant.revoke',{ grant:leaf.ref,reason:'wrong-branch' },true).error.code,'FORBIDDEN');
  assert.equal(delegated(f,actor,b,'grant.revoke',{ grant:leaf.ref,reason:'own-branch' },true).ok,true);
  assert.equal(delegated(f,actor,a,'grant.revoke',{ grant:a.ref,reason:'self-release' },true).ok,true);
  assert.equal(delegated(f,actor,a,'context.get',{}).error.code,'FORBIDDEN');
});

test('context, record, assertion and control identities cannot alias each other',t=>{
  const f=setup(t),s=schema(f),record=atom(s),ref={ systemId:f.systemId,contextId:f.contextId,id:record.id };
  assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record:{ ...record,id:f.contextId } }] }).error.code,'IDENTITY_CONFLICT');
  assert.equal(f.write('incident.create',{ id:f.contextId,incident }).error.code,'IDENTITY_CONFLICT');
  assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record },{ kind:'assertion.put',assertion:{ id:record.id,record:ref,evidence:{ sources:[],method:'alias-attempt',artifactDigests:[] } } }] }).error.code,'IDENTITY_CONFLICT');
  const assertion={ id:randomUUID(),record:ref,evidence:{ sources:[],method:'independent-support',artifactDigests:[] } };
  assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record },{ kind:'assertion.put',assertion }] }).ok,true);
  assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record:{ ...record,id:assertion.id } }] }).error.code,'IDENTITY_CONFLICT');
  assert.equal(f.write('incident.create',{ id:assertion.id,incident }).error.code,'IDENTITY_CONFLICT');
});

test('a query cursor cannot be reused through another grant for the same principal',t=>{
  const f=setup(t);allowDelegated(f);const actor=randomUUID(),s=schema(f),records=[atom(s),atom(s)];
  f.write('graph.transact',{ changes:records.map(record=>({ kind:'record.put',record })) });
  const a=grant(f,actor,{ actions:['graph.query'],resourceRefs:records.map(record=>({ systemId:f.systemId,contextId:f.contextId,id:record.id })) });
  const b=grant(f,actor,{ actions:['graph.query'],resourceRefs:a.value.resourceRefs });
  const input={ selector:{ assertionStatus:'any' },limit:1 };
  const cursor=delegated(f,actor,a,'graph.query',input).value.nextCursor;assert.ok(cursor);
  assert.equal(delegated(f,actor,b,'graph.query',{ ...input,cursor }).error.code,'INVALID_ARGUMENT');
});
