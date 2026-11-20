import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {digest} from '../runtime/json.mjs';
import { atom, grant, incident, limits, allowDelegated, delegated } from './helpers.mjs';
import { zeroUsage } from '../runtime/executions.mjs';

import { fixture,evidence,budget,outcome,usage } from './execution-fixture.mjs';

test('capabilities bind providers and match exact contract, features, isolation, freshness and grant',t=>{
  const f=fixture(t),requirement={ name:f.capability.name,versions:['1'],inputSchema:f.capability.inputSchema,outputSchema:f.capability.outputSchema,features:['bytes'],acceptableIsolation:['none'] };
  const input={ contextId:f.contextId,requirement,grant:f.authorized.ref,limit:10 };
  assert.equal(f.call('capability.match',input).value[0].eligibility,'eligible');
  const mismatched=f.call('capability.match',{ ...input,requirement:{ ...requirement,versions:['2'],features:['unavailable'],acceptableIsolation:['vm'] } }).value[0];
  assert.deepEqual(mismatched.unmet,['version','features','isolation']);
  assert.equal(f.write('capability.advertise',{ capability:{ ...f.capability,id:randomUUID(),providerId:randomUUID() } }).error.code,'FORBIDDEN');
  assert.equal(f.write('capability.advertise',{ capability:{ ...f.capability,id:randomUUID(),name:'graph.transact' } }).error.code,'INVALID_ARGUMENT');
});

test('capability discovery distinguishes current policy uncertainty from denial without admitting effects',t=>{
  for(const unresolved of [false,true]){
    const f=fixture(t),context=f.call('context.get',{contextId:f.contextId}).value,current=f.call('control.get',{contextId:f.contextId,ref:context.policy}).value.value;
    const when=unresolved?{kind:'related',from:{kind:'literal',value:null},to:{kind:'literal',value:randomUUID()},schemaNames:['unresolved'],maxHops:1}:{kind:'equal',left:{kind:'literal',value:true},right:{kind:'literal',value:true}};
    const policy={...current,id:randomUUID(),parent:context.policy,rules:[...current.rules,{id:'current-capability-refusal',effect:'deny',actions:[f.capability.name],when}]};
    const published=f.write('policy.publish',{policy});assert.equal(published.ok,true);assert.equal(f.write('policy.activate',{policy:published.value.ref,evidence}).ok,true);
    const requirement={name:f.capability.name,versions:['1'],inputSchema:f.capability.inputSchema,outputSchema:f.capability.outputSchema,features:['bytes'],acceptableIsolation:['none']};
    const revision=f.store.read(f.contextId).context.revision,result=f.call('capability.match',{contextId:f.contextId,requirement,grant:f.authorized.ref,limit:1});assert.equal(result.ok,true);
    assert.equal(result.value[0].eligibility,unresolved?'unknown':'ineligible');assert.deepEqual(result.value[0].unmet,[unresolved?'policy_unknown':'policy']);
    assert.equal(f.store.read(f.contextId).context.revision,revision);assert.deepEqual(f.store.outbox(f.contextId),[]);
    const refused=f.write('execution.request',{execution:f.intent()});assert.equal(refused.error.code,unresolved?'POLICY_INDETERMINATE':'FORBIDDEN');assert.deepEqual(f.store.outbox(f.contextId),[]);
  }
});

test('an advertisement expires exactly at its boundary while the grant remains usable',t=>{
  let now=1000;const clock={wall:()=>now,monotonic:()=>0,bootId:randomUUID()},f=fixture(t,{clock});
  const capability={...f.capability,id:randomUUID(),expiresAt:new Date(1100).toISOString()};assert.equal(f.write('capability.advertise',{capability}).ok,true);
  const authorized=grant(f,f.ownerId,{actions:['execution.request',capability.name],resourceRefs:[{systemId:f.systemId,contextId:f.contextId,id:capability.id}]}),requirement={name:capability.name,versions:['1'],inputSchema:capability.inputSchema,outputSchema:capability.outputSchema,features:['bytes'],acceptableIsolation:['none']};
  const read=()=>f.call('capability.match',{contextId:f.contextId,requirement,grant:authorized.ref,limit:10}).value.find(item=>item.capability.ref.id===capability.id);
  now=1099;assert.equal(read().eligibility,'eligible');now=1100;assert.deepEqual(read().unmet,['expired']);assert.equal(read().eligibility,'ineligible');
  assert.equal(f.write('capability.advertise',{capability:{...capability,id:randomUUID()}}).error.code,'CAPABILITY_UNAVAILABLE');
});

test('execution queues durably without dispatch; a fenced provider heartbeat precedes validated completion',t=>{
  const f=fixture(t),intent=f.intent();const request={ contextId:f.contextId,expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:'queue',execution:intent };
  const queued=f.call('execution.request',request);assert.equal(queued.ok,true);assert.equal(queued.value.state,'queued');assert.equal(f.store.outbox(f.contextId).length,1);
  f.reopen();assert.deepEqual(f.call('execution.request',request),queued);
  const leased=f.claim(intent.id),lease=f.leaseInput(leased);
  assert.equal(f.write('execution.finish',{ ...lease,outcome,usage }).error.code,'INVALID_ARGUMENT');
  const run=f.write('execution.heartbeat',{ ...lease,leaseMillis:1000 });assert.equal(run.value.state,'running');
  assert.equal(f.write('execution.finish',{ ...lease,outcome:{ ...outcome,output:42 },usage }).error.code,'INVALID_ARGUMENT');
  const input={ contextId:f.contextId,expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:'finish',...lease,outcome,usage };
  const finished=f.call('execution.finish',input);assert.equal(finished.value.state,'succeeded');assert.deepEqual(finished.value.usage,usage);
  f.reopen();assert.deepEqual(f.call('execution.finish',input),finished);assert.equal(f.store.outbox(f.contextId).length,1);
});

test('lease loss on restart preserves unknown, holds reservations and refuses stale finish or blind replay',t=>{
  const f=fixture(t),queued=f.request(),running=f.running(queued.intent.id),stale=f.leaseInput(running);
  f.reopen();const recovered=f.get(queued.intent.id);assert.equal(recovered.value.state,'unknown');
  assert.equal(f.write('execution.finish',{ ...stale,outcome,usage }).error.code,'LEASE_STALE');
  assert.equal(f.write('execution.claim',{ executionId:queued.intent.id,leaseMillis:1000 }).error.code,'LEASE_STALE');
  assert.equal(f.write('execution.request',{ execution:f.intent() }).error.code,'LIMIT_EXCEEDED');
  assert.equal(f.write('execution.reconcile',{ attempt:1,executionId:queued.intent.id,resolution:{ kind:'retry',basis:'not_started',evidence },usage:zeroUsage() }).error.code,'INVALID_ARGUMENT');
  const reconciled=f.write('execution.reconcile',{ attempt:1,executionId:queued.intent.id,resolution:{ kind:'observed',outcome:{ ...outcome,evidence:f.proof() } },usage });
  assert.equal(reconciled.value.state,'succeeded');assert.equal(f.write('execution.request',{ execution:f.intent() }).ok,true);
});

test('evidence-backed retry keeps identity, increases fencing and cannot reset usage across attempts',t=>{
  const f=fixture(t,{ reconciliation:'idempotent' }),q=f.request(),old=f.running(q.intent.id),stale=f.leaseInput(old);
  f.reopen();f.get(q.intent.id);
  const retried=f.write('execution.reconcile',{ attempt:1,executionId:q.intent.id,resolution:{ kind:'retry',basis:'idempotent',evidence:f.proof() },usage });
  assert.equal(retried.value.state,'queued');assert.equal(retried.value.intent.id,q.intent.id);
  const next=f.running(q.intent.id);assert.equal(next.attempt,2);assert.equal(next.lease.fencingToken,2);
  assert.equal(f.write('execution.finish',{ ...stale,outcome,usage }).error.code,'LEASE_STALE');
  assert.equal(f.write('execution.finish',{ ...f.leaseInput(next),outcome,usage:zeroUsage() }).error.code,'LIMIT_EXCEEDED');
  assert.equal(f.write('execution.finish',{ ...f.leaseInput(next),outcome,usage:{ ...usage,cpuMillis:2 } }).value.state,'succeeded');
});

test('cancellation races preserve observed success, undispatched cancellation and context recovery paths',t=>{
  const f=fixture(t),q=f.request();
  assert.equal(f.write('execution.cancel',{ executionId:q.intent.id,reason:'No work needed' }).value.state,'cancelled');
  assert.equal(f.write('execution.claim',{ executionId:q.intent.id,leaseMillis:1000 }).error.code,'LEASE_STALE');
  const next=f.request(),run=f.running(next.intent.id);
  assert.equal(f.write('execution.cancel',{ executionId:next.intent.id,reason:'Stop requested' }).value.state,'cancel_requested');
  assert.equal(f.write('context.close',{ reason:'No new work' }).ok,true);
  const result=f.write('execution.finish',{ ...f.leaseInput(run),outcome,usage });assert.equal(result.value.state,'succeeded');
  assert.equal(f.write('execution.cancel',{ executionId:next.intent.id,reason:'Already completed' }).value.state,'succeeded');
  assert.equal(f.write('execution.request',{ execution:f.intent() }).error.code,'FORBIDDEN');
});

test('revoking requester authority cancels queued work and permits another provider to report an observed race',t=>{
  const f=fixture(t),q=f.request(),run=f.running(q.intent.id);
  assert.equal(f.write('grant.revoke',{ grant:f.authorized.ref,reason:'Withdraw requester authority' }).ok,true);
  assert.equal(f.get(q.intent.id).value.state,'cancel_requested');
  assert.equal(f.write('execution.finish',{ ...f.leaseInput(run),outcome,usage }).value.state,'succeeded');
});

test('shared cumulative envelopes charge completed work and descendants rather than resetting per grant',t=>{
  const f=fixture(t,{ limits:{ ...limits,cpuMillis:201 } }),first=f.request(),run=f.running(first.intent.id);
  assert.equal(f.write('execution.finish',{ ...f.leaseInput(run),outcome,usage:{ ...usage,cpuMillis:2 } }).ok,true);
  assert.equal(f.write('execution.request',{ execution:f.intent() }).error.code,'LIMIT_EXCEEDED');
  const replacement=grant(f,f.ownerId,{ actions:['execution.request',f.capability.name],resourceRefs:[f.capRef],limits:{ ...limits,cpuMillis:201 } });
  assert.equal(f.write('execution.request',{ execution:{ ...f.intent(),grant:replacement.ref } }).error.code,'LIMIT_EXCEEDED');
});

test('persisted reservations preserve the last safe-integer unit and refuse the next one atomically',t=>{
  const maximum=Number.MAX_SAFE_INTEGER,f=fixture(t,{limits:{...limits,cpuMillis:maximum}}),first={...f.intent(),limits:{...budget,cpuMillis:maximum-1}};
  assert.equal(f.write('execution.request',{execution:first}).ok,true);
  const running=f.running(first.id);
  assert.equal(f.write('execution.finish',{...f.leaseInput(running),outcome,usage:{...usage,cpuMillis:maximum-1}}).ok,true);
  f.reopen();const revision=f.store.read(f.contextId).context.revision,outbox=f.store.outbox(f.contextId).length;
  const tooMuch={...f.intent(),limits:{...budget,cpuMillis:2}};
  assert.equal(f.write('execution.request',{execution:tooMuch}).error.code,'LIMIT_EXCEEDED');
  assert.equal(f.store.read(f.contextId).context.revision,revision);assert.equal(f.store.outbox(f.contextId).length,outbox);
  const exact={...f.intent(),limits:{...budget,cpuMillis:1}};
  assert.equal(f.write('execution.request',{execution:exact}).ok,true);
  f.reopen();assert.equal(f.kernel.executions.totals(f.store.read(f.contextId)).cpuMillis,maximum);
  const evidence=f.proof(),before=f.store.read(f.contextId).context.revision;
  assert.equal(f.write('context.limits',{limits:{...limits,cpuMillis:maximum-1},evidence}).error.code,'LIMIT_EXCEEDED');
  assert.equal(f.store.read(f.contextId).context.revision,before);
  assert.equal(f.write('execution.cancel',{executionId:exact.id,reason:'undispatched reservation released'}).ok,true);
  assert.equal(f.kernel.executions.totals(f.store.read(f.contextId)).cpuMillis,maximum-1);
});

test('independently reported overruns retain exact persisted observations and saturate aggregate accounting',t=>{
  const maximum=Number.MAX_SAFE_INTEGER,f=fixture(t,{limits:{...limits,concurrentExecutions:2,cpuMillis:maximum}}),a=f.request(),b=f.request();
  const left=f.running(a.intent.id),right=f.running(b.intent.id);
  for(const running of [left,right])assert.equal(f.write('execution.finish',{...f.leaseInput(running),outcome,usage:{...usage,cpuMillis:maximum}}).ok,true);
  f.reopen();const snapshot=f.store.read(f.contextId),total=f.kernel.executions.totals(snapshot);
  assert.equal(total.cpuMillis,Infinity);assert.equal(total.concurrentExecutions,0);assert.equal(total.memoryBytes,0);
  for(const id of [a.intent.id,b.intent.id])assert.equal(snapshot.controlState.executions[id].value.usage.cpuMillis,maximum);
  const revision=snapshot.context.revision;
  assert.equal(f.write('execution.request',{execution:f.intent()}).error.code,'LIMIT_EXCEEDED');
  assert.equal(f.store.read(f.contextId).context.revision,revision);
});

test('monotonic lease expiry remains effective when wall time moves backwards',t=>{
  let wall=Date.now(),elapsed=0;const clock={ wall:()=>wall,monotonic:()=>elapsed,bootId:randomUUID() };
  const f=fixture(t,{ clock }),q=f.request();f.running(q.intent.id);wall-=60000;elapsed+=15001;
  assert.equal(f.get(q.intent.id).value.state,'unknown');
});

test('fractional monotonic deadlines preserve their frame when wall time later moves backwards',t=>{
  let wall=Date.parse('2026-11-20T12:00:00.000Z'),elapsed=0.1;
  const f=fixture(t,{clock:{wall:()=>wall,monotonic:()=>elapsed,bootId:randomUUID()}}),q=f.request(),running=f.running(q.intent.id);
  const expected=elapsed+(Date.parse(running.lease.expiresAt)-wall),meta=f.store.read(f.contextId).controlState.executionLeases[q.intent.id];
  assert.equal(meta.monotonicDeadline,expected,'Epoch-scale addition must not round away part of the monotonic origin');
  wall-=60000;elapsed=expected;
  assert.equal(f.get(q.intent.id).value.state,'unknown','Equality is expiration in either valid clock frame');
});

test('unknown work still wakes for its intent deadline and then rests after recording cancellation',t=>{
  let wall=Date.parse('2026-11-20T12:00:00.000Z'),elapsed=0;
  const clock={wall:()=>wall,monotonic:()=>elapsed,bootId:randomUUID()},f=fixture(t,{clock});
  const execution={...f.intent(),limits:{...budget,deadline:new Date(wall+1000).toISOString()}};
  assert.equal(f.write('execution.request',{execution}).ok,true);f.running(execution.id);
  clock.bootId=randomUUID();assert.equal(f.get(execution.id).value.state,'unknown');
  assert.equal(f.kernel.executions.nextDelay(),1000,'Uncertain effects retain their unobserved deadline');
  wall+=1000;elapsed+=1000;f.kernel.executions.maintain(f.contextId);
  const unknown=f.get(execution.id).value;assert.equal(unknown.state,'unknown');assert.equal(unknown.cancellation.reason,'Execution deadline observed');
  assert.equal(f.kernel.executions.nextDelay(),null,'A recorded cancellation must not create an immediate timer loop');
  const revision=f.store.read(f.contextId).context.revision;f.kernel.executions.maintain(f.contextId);assert.equal(f.store.read(f.contextId).context.revision,revision);
});

test('persisted high fencing tokens round-trip exactly and exhaustion refuses without effects',t=>{
  const f=fixture(t),maximum=Number.MAX_SAFE_INTEGER;
  // Seed valid high-counter states in this owned fixture; do not simulate
  // quadrillions of provider attempts or claim that they actually occurred.
  const seed=(id,attempt)=>{
    const snapshot=f.store.read(f.contextId),previous=snapshot.controlState.executions[id],value={...previous.value,attempt};
    const mutation={contextId:f.contextId,expectedRevision:snapshot.context.revision,idempotencyKey:randomUUID()};
    const result=f.store.commit({mutation,principalId:f.ownerId,requestDigest:digest({id,attempt}),changes:[],controlChanges:[{namespace:'executions',key:id,value:f.kernel.stored(f.contextId,value,snapshot.context.revision+1,f.ownerId,id)}],events:[],outbox:[],response:{kind:'commit-receipt'}},'$fixture.high-counter');
    assert.equal(result.ok,true);
  };
  const first=f.request();seed(first.intent.id,maximum-1);f.reopen();
  const leased=f.claim(first.intent.id),lease=f.leaseInput(leased);assert.equal(lease.fencingToken,maximum);
  assert.equal(f.write('execution.heartbeat',{...lease,leaseMillis:1000}).ok,true);
  const before=f.store.read(f.contextId).context.revision;
  assert.equal(f.write('execution.finish',{...lease,fencingToken:maximum%2**32,outcome,usage}).error.code,'LEASE_STALE');
  assert.equal(f.store.read(f.contextId).context.revision,before);
  assert.equal(f.write('execution.finish',{...lease,outcome,usage}).ok,true);
  const second=f.request();seed(second.intent.id,maximum);f.reopen();
  const revision=f.store.read(f.contextId).context.revision,outbox=f.store.outbox(f.contextId).length;
  assert.equal(f.write('execution.claim',{executionId:second.intent.id,leaseMillis:1000}).error.code,'LIMIT_EXCEEDED');
  assert.equal(f.store.read(f.contextId).context.revision,revision);assert.equal(f.store.outbox(f.contextId).length,outbox);
  assert.equal(f.get(second.intent.id).value.state,'queued');
});

test('descendant grants share consumed ancestor budget',t=>{
  const parentLimits={ ...limits,cpuMillis:201 },f=fixture(t,{ grantLimits:parentLimits });
  const child=()=>grant(f,f.ownerId,{ parentGrant:f.authorized.ref,actions:f.authorized.value.actions,resourceRefs:[f.capRef],limits:parentLimits });
  const a=child(),b=child(),intent={ ...f.intent(),grant:a.ref };
  assert.equal(f.write('execution.request',{ execution:intent }).ok,true);
  const run=f.running(intent.id);assert.equal(f.write('execution.finish',{ ...f.leaseInput(run),outcome,usage:{ ...usage,cpuMillis:2 } }).ok,true);
  assert.equal(f.write('execution.request',{ execution:{ ...f.intent(),grant:b.ref } }).error.code,'LIMIT_EXCEEDED');
});

test('proposed executions reserve nothing until semantic change and outbox admission commit atomically',t=>{
  const f=fixture(t),record=atom(f.capability.inputSchema),intent=f.intent(),ctx=f.call('context.get',{ contextId:f.contextId }).value;
  const proposal={ id:randomUUID(),incidentId:intent.incidentId,basisRevision:ctx.revision,policy:ctx.policy,changes:[{ kind:'record.put',record }],executions:[intent],evidence };
  assert.equal(f.write('transition.propose',{ proposal }).ok,true);assert.equal(f.store.outbox(f.contextId).length,0);assert.equal(f.store.read(f.contextId).records.length,0);
  assert.equal(f.write('transition.commit',{ proposalId:proposal.id }).ok,true);
  assert.equal(f.store.outbox(f.contextId).length,1);assert.equal(f.store.read(f.contextId).records.length,1);assert.equal(f.get(intent.id).value.state,'queued');
  const fresh=f.call('context.get',{ contextId:f.contextId }).value;
  assert.equal(f.write('transition.propose',{ proposal:{ ...proposal,id:randomUUID(),basisRevision:fresh.revision,executions:[f.intent()] } }).error.code,'LIMIT_EXCEEDED');
  assert.equal(f.store.outbox(f.contextId).length,1);
});

test('wrong providers, revoked dispatch grants, widened budgets and invalid input cannot admit effects',t=>{
  const f=fixture(t);allowDelegated(f);const actor=randomUUID(),q=f.request();
  const bound=grant(f,actor,{ actions:['execution.claim'],resourceRefs:[{ systemId:f.systemId,contextId:f.contextId,id:q.intent.id },f.capRef] });
  assert.equal(delegated(f,actor,bound,'execution.claim',{ executionId:q.intent.id,leaseMillis:1000 },true).error.code,'FORBIDDEN');
  assert.equal(f.write('execution.cancel',{ executionId:q.intent.id,reason:'Free slot' }).ok,true);
  assert.equal(f.write('execution.request',{ execution:{ ...f.intent(),input:42 } }).error.code,'INVALID_ARGUMENT');
  assert.equal(f.write('execution.request',{ execution:{ ...f.intent(),limits:{ ...budget,cpuMillis:limits.cpuMillis+1 } } }).error.code,'FORBIDDEN');
  const next=f.request(),leased=f.claim(next.intent.id);
  f.write('grant.revoke',{ grant:f.authorized.ref,reason:'Revoked before dispatch' });
  const heartbeat=f.write('execution.heartbeat',{ ...f.leaseInput(leased),leaseMillis:1000 });
  assert.equal(heartbeat.value.state,'cancel_requested');
  assert.equal(f.write('execution.finish',{ ...f.leaseInput(leased),outcome:{ kind:'cancelled',evidence },usage:zeroUsage() }).value.state,'cancelled');
});

test('a distinct requester loses access after revocation while the provider retains its outcome path',t=>{
  const f=fixture(t);allowDelegated(f);const actor=randomUUID(),intent=f.intent();
  const bound=grant(f,actor,{ actions:['execution.request','execution.get',f.capability.name],incidentIds:[intent.incidentId],resourceRefs:[f.capRef] });
  intent.grant=bound.ref;
  assert.equal(delegated(f,actor,bound,'execution.request',{ execution:intent },true).value.state,'queued');
  assert.equal(delegated(f,actor,bound,'execution.get',{ executionId:intent.id }).value.state,'queued');
  const run=f.running(intent.id);f.write('grant.revoke',{ grant:bound.ref,reason:'Requester no longer admitted' });
  assert.equal(delegated(f,actor,bound,'execution.get',{ executionId:intent.id }).error.code,'FORBIDDEN');
  assert.equal(f.get(intent.id).value.state,'cancel_requested');
  assert.equal(f.write('execution.finish',{ ...f.leaseInput(run),outcome,usage }).value.state,'succeeded');
});

test('ending an incident cancels undispatched work without fabricating execution',t=>{
  const f=fixture(t),q=f.request();
  assert.equal(f.write('incident.update',{ incidentId:q.intent.incidentId,incident:{ ...incident,status:'cancelled' },evidence }).ok,true);
  assert.equal(f.get(q.intent.id).value.state,'cancelled');
  assert.equal(f.write('execution.request',{ execution:f.intent() }).error.code,'FORBIDDEN');
});

test('grant expiry bounds the lease and undispatched expired work releases its reservation',t=>{
  let wall=Date.now(),elapsed=0;const clock={ wall:()=>wall,monotonic:()=>elapsed,bootId:randomUUID() };
  const f=fixture(t,{ clock });
  const expiring=()=>grant(f,f.ownerId,{ actions:f.authorized.value.actions,resourceRefs:[f.capRef],expiresAt:new Date(wall+50).toISOString() });
  const first={ ...f.intent(),grant:expiring().ref };assert.equal(f.write('execution.request',{ execution:first }).ok,true);
  wall+=60;elapsed+=60;
  assert.equal(f.get(first.id).value.state,'cancelled');
  const second={ ...f.intent(),grant:expiring().ref };assert.equal(f.write('execution.request',{ execution:second }).ok,true);
  const run=f.running(second.id);assert.equal(Date.parse(run.lease.expiresAt),wall+50);
  wall+=60;elapsed+=60;assert.equal(f.get(second.id).value.state,'unknown');
});

test('a late reconciliation from an older attempt cannot overwrite a newer unknown attempt',t=>{
  const f=fixture(t,{ reconciliation:'idempotent' }),q=f.request();f.running(q.intent.id);f.reopen();f.get(q.intent.id);
  assert.equal(f.write('execution.reconcile',{ attempt:1,executionId:q.intent.id,resolution:{ kind:'retry',basis:'idempotent',evidence:f.proof() },usage }).value.state,'queued');
  f.running(q.intent.id);f.reopen();f.get(q.intent.id);
  const proof=f.proof();
  const revision=f.store.read(f.contextId).context.revision;
  assert.equal(f.write('execution.reconcile',{ attempt:1,executionId:q.intent.id,resolution:{ kind:'observed',outcome:{ ...outcome,evidence:proof } },usage }).error.code,'LEASE_STALE');
  assert.equal(f.store.read(f.contextId).context.revision,revision);assert.equal(f.get(q.intent.id).value.attempt,2);assert.equal(f.get(q.intent.id).value.state,'unknown');
});

test('capability matching respects incident scope and selects a compatible candidate before the result limit',t=>{
  const f=fixture(t),intent=f.intent();
  assert.equal(f.write('capability.advertise',{ capability:{ ...f.capability,id:randomUUID(),version:'2' } }).ok,true);
  const bound=grant(f,f.ownerId,{ actions:f.authorized.value.actions,incidentIds:[intent.incidentId],resourceRefs:[f.capRef] });
  const requirement={ name:f.capability.name,versions:['1'],inputSchema:f.capability.inputSchema,outputSchema:f.capability.outputSchema,features:['bytes'],acceptableIsolation:['none'] };
  const input={ contextId:f.contextId,requirement,grant:bound.ref,limit:1 };
  const omitted=f.call('capability.match',input).value[0];assert.equal(omitted.eligibility,'unknown');assert.ok(omitted.unmet.includes('incident_required'));
  assert.equal(f.call('capability.match',{ ...input,incidentId:intent.incidentId }).value[0].eligibility,'eligible');
  assert.equal(f.call('capability.match',{ ...input,incidentId:randomUUID() }).value[0].eligibility,'ineligible');
  assert.equal(f.write('capability.advertise',{ capability:{ ...f.capability,id:randomUUID(),expiresAt:'2026-02-31T00:00:00Z' } }).error.code,'INVALID_ARGUMENT');
});

test('execution internals leave an outer view stable until an admitted semantic result changes it',t=>{
  const f=fixture(t),ref=id=>({ systemId:f.systemId,contextId:f.contextId,id });
  const initial={ ...atom(f.capability.inputSchema),value:'pending' },assertion={ id:randomUUID(),record:ref(initial.id),evidence };
  assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record:initial },{ kind:'assertion.put',assertion }] }).ok,true);
  const view=f.write('view.publish',{ view:{ id:randomUUID(),selector:{ assertionStatus:'asserted' },fields:['/value/value'] } }).value;
  const read=()=>f.call('view.read',{ contextId:f.contextId,view:view.ref,limit:10 }).value;
  const before=read(),q=f.request();assert.deepEqual(read(),before);
  const run=f.running(q.intent.id);assert.deepEqual(read(),before);
  assert.equal(f.write('execution.finish',{ ...f.leaseInput(run),outcome,usage }).ok,true);assert.deepEqual(read(),before);
  const result={ ...atom(f.capability.outputSchema),value:outcome.output };
  assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record:result },{ kind:'assertion.withdraw',assertionId:assertion.id,reason:'Result consolidated' },{ kind:'assertion.put',assertion:{ id:randomUUID(),record:ref(result.id),evidence } }] }).ok,true);
  const after=read();assert.notEqual(after.version,before.version);assert.equal(after.records[0].fields['/value/value'],'verified');
});

test('dispatch rechecks aggregate reservations against a newly narrowed policy',t=>{
  const f=fixture(t,{ limits:{ ...limits,concurrentExecutions:2 } }),first=f.request(),second=f.request();
  const ctx=f.call('context.get',{ contextId:f.contextId }).value,old=f.call('control.get',{ contextId:f.contextId,ref:ctx.policy }).value.value;
  const stored=f.write('policy.publish',{ policy:{ ...old,id:randomUUID(),parent:ctx.policy,limits:{ ...old.limits,cpuMillis:300 } } });assert.equal(stored.ok,true);
  assert.equal(f.write('policy.activate',{ policy:stored.value.ref,evidence }).ok,true);
  assert.equal(f.write('execution.claim',{ executionId:first.intent.id,leaseMillis:1000 }).error.code,'LIMIT_EXCEEDED');
  assert.equal(f.write('execution.cancel',{ executionId:first.intent.id,reason:'Release a reservation under the narrowed policy' }).ok,true);
  assert.equal(f.claim(second.intent.id).state,'leased');
});

test('cancelling unknown work preserves uncertainty and prevents later retry from reviving its intent',t=>{
  const f=fixture(t,{ reconciliation:'idempotent' }),q=f.request();f.running(q.intent.id);f.reopen();f.get(q.intent.id);
  const requested=f.write('execution.cancel',{ executionId:q.intent.id,reason:'Owner ended this work' });
  assert.equal(requested.value.state,'unknown');assert.equal(requested.value.cancellation.reason,'Owner ended this work');
  f.reopen();assert.equal(f.get(q.intent.id).value.cancellation.requestedBy,f.ownerId);
  const proof=f.proof();
  assert.equal(f.write('execution.reconcile',{ attempt:1,executionId:q.intent.id,resolution:{ kind:'retry',basis:'idempotent',evidence:proof },usage }).error.code,'FORBIDDEN');
  const observed=f.write('execution.reconcile',{ attempt:1,executionId:q.intent.id,resolution:{ kind:'observed',outcome:{ ...outcome,evidence:proof } },usage });
  assert.equal(observed.value.state,'succeeded');assert.equal(observed.value.cancellation.reason,'Owner ended this work');
});

test('execution-only proposals work under a restricted grant without graph mutation authority',t=>{
  const f=fixture(t);allowDelegated(f);const actor=randomUUID(),intent=f.intent();
  const bound=grant(f,actor,{ actions:['execution.request','transition.propose','transition.commit','transition.get',f.capability.name],incidentIds:[intent.incidentId],resourceRefs:[f.capRef] });
  intent.grant=bound.ref;const ctx=f.call('context.get',{ contextId:f.contextId }).value;
  const proposal={ id:randomUUID(),incidentId:intent.incidentId,basisRevision:ctx.revision,policy:ctx.policy,changes:[],executions:[intent],evidence };
  assert.equal(delegated(f,actor,bound,'transition.propose',{ proposal },true).ok,true);assert.equal(f.store.outbox(f.contextId).length,0);
  assert.equal(delegated(f,actor,bound,'transition.commit',{ proposalId:proposal.id },true).ok,true);
  assert.equal(f.get(intent.id).value.state,'queued');assert.equal(f.store.outbox(f.contextId).length,1);assert.equal(f.store.read(f.contextId).records.length,0);
});

test('observed overruns stay truthful, preserve their outcome and block new context dispatch',t=>{
  const f=fixture(t),q=f.request(),run=f.running(q.intent.id),observed={ ...usage,cpuMillis:limits.cpuMillis+1 };
  const finished=f.write('execution.finish',{ ...f.leaseInput(run),outcome,usage:observed });
  assert.equal(finished.ok,true);assert.equal(finished.value.state,'succeeded');assert.deepEqual(finished.value.limitViolations,['cpuMillis']);assert.equal(finished.value.usage.cpuMillis,observed.cpuMillis);
  f.reopen();assert.deepEqual(f.get(q.intent.id).value.usage,observed);assert.equal(f.write('execution.request',{ execution:f.intent() }).error.code,'LIMIT_EXCEEDED');
});
