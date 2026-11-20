import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {incident,setup,schema,atom,allowDelegated,grant,delegated} from './helpers.mjs';

function historicalSource(f) {
  const record=atom(schema(f));record.value='Prior source reports this work ended in2025; admission is a new present observation.';
  assert.equal(f.write('graph.transact',{changes:[{kind:'record.put',record}]}).ok,true);
  const ref={systemId:f.systemId,contextId:f.contextId,id:record.id};
  return {ref,evidence:{sources:[ref],method:'Retain a dated historical report; do not replay its execution',artifactDigests:[]}};
}

test('historical incidents admit their actual initial state once, retaining evidence across restart and exact retry',t=>{
  const f=setup(t),{evidence}=historicalSource(f),requests=[];
  for(const status of ['open','resting','completed','cancelled']) {
    const id=randomUUID(),request={contextId:f.contextId,expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:randomUUID(),id,incident:{...incident,status},evidence};
    const admitted=f.call('incident.create',request);assert.equal(admitted.ok,true,JSON.stringify(admitted));
    assert.equal(admitted.value.value.status,status);assert.deepEqual(admitted.value.evidence,evidence);
    assert.equal(f.call('incident.get',{contextId:f.contextId,incidentId:id,atRevision:admitted.value.revision}).value.value.status,status);
    const events=f.call('events.read',{contextId:f.contextId,limit:100,waitMillis:0}).value.items.filter(x=>x.subjectRefs.some(ref=>ref.id===id));
    assert.deepEqual(events.map(x=>x.type),['incident.create.committed']);
    assert.equal(f.store.outbox(f.contextId).length,0);
    requests.push({request,admitted});
  }
  f.reopen();
  for(const {request,admitted} of requests) {
    assert.deepEqual(f.call('incident.create',request),admitted);
    assert.deepEqual(f.call('incident.get',{contextId:f.contextId,incidentId:request.id}),admitted);
  }
  const active=f.call('incident.list',{contextId:f.contextId,statuses:['open','resting'],limit:100}).value.items;
  assert.equal(active.length,2);assert.ok(active.every(x=>['open','resting'].includes(x.value.status)));
});

test('initial states preserve evidence, input, identity and revision admission guards',t=>{
  const f=setup(t),{evidence}=historicalSource(f),revision=f.store.read(f.contextId).context.revision;
  const base={contextId:f.contextId,expectedRevision:revision,idempotencyKey:randomUUID(),id:randomUUID(),incident:{...incident,status:'completed'}};
  for(const request of [base,{...base,evidence:{...evidence,sources:[]}},{...base,evidence:{...evidence,sources:[{...evidence.sources[0],id:randomUUID()}]}},{...base,evidence,recordedAt:'2025-01-01T00:00:00.000Z'},{...base,evidence,incident:{...incident,status:'invented'}}]) {
    assert.equal(f.call('incident.create',request).ok,false);
    assert.equal(f.store.read(f.contextId).context.revision,revision);
  }
  const admitted=f.call('incident.create',{...base,evidence});assert.equal(admitted.ok,true);
  assert.equal(f.call('incident.create',{...base,evidence,incident:{...incident,status:'cancelled'}}).error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal(f.call('incident.create',{...base,evidence,id:randomUUID(),idempotencyKey:randomUUID()}).error.code,'REVISION_CONFLICT');
  assert.equal(f.write('incident.create',{id:base.id,incident,evidence}).error.code,'IDENTITY_CONFLICT');
  assert.equal(f.write('incident.update',{incidentId:base.id,incident,evidence}).error.code,'FORBIDDEN');
});

test('creation-only authority cannot admit non-open state or replay a privileged creation receipt',t=>{
  const f=setup(t);allowDelegated(f);const {ref,evidence}=historicalSource(f),actor=randomUUID(),id=randomUUID();
  const createOnly=grant(f,actor,{actions:['incident.create'],incidentIds:[id],resourceRefs:[ref]});
  const request={contextId:f.contextId,expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:randomUUID(),id,incident:{...incident,status:'resting'},evidence};
  assert.equal(f.call('incident.create',request,actor,createOnly.ref).error.code,'FORBIDDEN');
  const both=grant(f,actor,{actions:['incident.create','incident.update'],incidentIds:[id],resourceRefs:[ref]});
  request.expectedRevision=f.store.read(f.contextId).context.revision;
  assert.equal(f.call('incident.create',request,actor,both.ref).ok,true);
  assert.equal(f.call('incident.create',request,actor,createOnly.ref).error.code,'FORBIDDEN');
});

test('collaborators with shared work and evidence access can read admitted incidents; hidden evidence stays private',t=>{
  const f=setup(t);allowDelegated(f);const {ref,evidence}=historicalSource(f),id=randomUUID();
  assert.equal(f.write('incident.create',{id,incident:{...incident,status:'completed'},evidence}).ok,true);
  const actor=randomUUID(),reader=grant(f,actor,{actions:['incident.get','incident.list'],incidentIds:[id],resourceRefs:[ref]});
  const result=delegated(f,actor,reader,'incident.get',{incidentId:id});assert.equal(result.ok,true);assert.deepEqual(result.value.evidence,evidence);
  assert.equal(delegated(f,actor,reader,'incident.list',{limit:10}).value.items.length,1);
  const hidden=grant(f,actor,{actions:['incident.get','incident.list'],incidentIds:[id],resourceRefs:[]});
  assert.equal(delegated(f,actor,hidden,'incident.get',{incidentId:id}).error.code,'NOT_FOUND');
  assert.equal(delegated(f,actor,hidden,'incident.list',{limit:10}).value.items.length,0);
});

test('incident updates retain their latest evidence and all supplied sources must resolve',t=>{
  const f=setup(t),id=randomUUID();assert.equal(f.write('incident.create',{id,incident}).ok,true);
  const {evidence}=historicalSource(f);
  const updated=f.write('incident.update',{incidentId:id,incident:{...incident,status:'resting'},evidence});assert.equal(updated.ok,true);
  assert.deepEqual(updated.value.evidence,evidence);
  const revision=f.store.read(f.contextId).context.revision;
  const bad={...evidence,sources:[{...evidence.sources[0],id:randomUUID()}]};
  assert.equal(f.write('incident.update',{incidentId:id,incident:{...incident,status:'cancelled'},evidence:bad}).error.code,'NOT_FOUND');
  assert.equal(f.store.read(f.contextId).context.revision,revision);
  f.reopen();assert.deepEqual(f.call('incident.get',{contextId:f.contextId,incidentId:id}).value.evidence,evidence);
});

test('initial-state creation evaluates both policies against the intended incident identity',t=>{
  const f=setup(t),{evidence}=historicalSource(f),id=randomUUID();
  const context=f.call('context.get',{contextId:f.contextId}).value,initial=f.call('control.get',{contextId:f.contextId,ref:context.policy}).value.value;
  const policy={...initial,id:randomUUID(),parent:context.policy,rules:[{...initial.rules[0],actions:initial.rules[0].actions.filter(x=>!['incident.create','incident.update'].includes(x))},{id:'new-work-id',effect:'permit',actions:['incident.create'],when:{kind:'equal',left:{kind:'binding',name:'incidentId'},right:{kind:'literal',value:id}}}]};
  const saved=f.write('policy.publish',{policy});assert.equal(saved.ok,true);
  assert.equal(f.write('policy.activate',{policy:saved.value.ref,evidence:{sources:[],artifactDigests:[],method:'Fixture scoped creation policy'}}).ok,true);
  assert.equal(f.write('incident.create',{id,incident:{...incident,status:'resting'},evidence}).error.code,'FORBIDDEN');
  assert.equal(f.write('incident.create',{id:randomUUID(),incident}).error.code,'FORBIDDEN');
  assert.equal(f.write('incident.create',{id,incident}).ok,true);
});
