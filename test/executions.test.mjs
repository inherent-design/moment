import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

test('monotonic lease expiry remains effective when wall time moves backwards',t=>{
  let wall=Date.now(),elapsed=0;const clock={ wall:()=>wall,monotonic:()=>elapsed,bootId:randomUUID() };
  const f=fixture(t,{ clock }),q=f.request();f.running(q.intent.id);wall-=60000;elapsed+=15001;
  assert.equal(f.get(q.intent.id).value.state,'unknown');
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
