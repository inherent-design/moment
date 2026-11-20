import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {DomainError} from '../runtime/json.mjs';
import { setup,schema,atom,limits,incident,allowDelegated,grant,delegated } from './helpers.mjs';
import { fixture as executionFixture,outcome,usage } from './execution-fixture.mjs';
const evidence={ sources:[],artifactDigests:[],method:'Wake fixture' };
const truth={ kind:'equal',left:{ kind:'literal',value:true },right:{ kind:'literal',value:true } };
function fixture(t,options={}) {
  const f=setup(t,options),incidentId=randomUUID();assert.equal(f.write('incident.create',{ id:incidentId,incident }).ok,true);
  const s=schema(f,options.document ?? { type:'string' });
  const rule=(overrides={})=>{
    const value={ id:randomUUID(),triggerEventTypes:[],condition:truth,operation:'incident.update',literalInput:{ contextId:f.contextId,expectedRevision:0,idempotencyKey:'placeholder',incidentId,incident:{ ...incident,status:'open' },evidence },inputBindings:{},limits,...overrides };
    const result=f.write('rule.publish',{ rule:value });assert.equal(result.ok,true,JSON.stringify(result));return result.value;
  };
  const schedule=(r,overrides={})=>({ id:randomUUID(),incidentId,rule:r.ref,wake:{ kind:'event',eventTypes:['graph.transact.committed'],selector:{ schemaNames:[s.name],assertionStatus:'any' },mode:'each' },recurrence:'once',coalesce:false,...overrides });
  const put=(r,overrides={})=>{ const value=schedule(r,overrides),result=f.write('schedule.put',{ schedule:value });assert.equal(result.ok,true,JSON.stringify(result));return value; };
  const status=id=>f.call('schedule.get',{ contextId:f.contextId,scheduleId:id });
  const trigger=(record=atom(s))=>{ const result=f.write('graph.transact',{ changes:[{ kind:'record.put',record }] });assert.equal(result.ok,true);return { record,commit:result.value }; };
  const advance=()=>f.kernel.scheduler.advance(f.contextId);
  return { ...f,get kernel() { return f.kernel; },get store() { return f.store; },s,incidentId,rule,schedule,put,status,trigger,advance };
}

test('rest and restart preserve one wake; occurrence and operation commit together without idle writes',t=>{
  const f=fixture(t);f.write('incident.update',{ incidentId:f.incidentId,incident:{ ...incident,status:'resting' },evidence });
  const scheduled=f.put(f.rule());f.advance();const restingRevision=f.store.read(f.contextId).context.revision;
  assert.equal(f.advance(),false);assert.equal(f.store.read(f.contextId).context.revision,restingRevision);
  f.trigger();f.kernel.scheduler.scan(f.contextId);const occurrence=f.status(scheduled.id).value.pendingOccurrenceIds[0];assert.ok(occurrence);
  f.reopen();assert.equal(f.status(scheduled.id).value.pendingOccurrenceIds[0],occurrence);f.advance();assert.equal(f.status(scheduled.id).value.state,'completed');
  assert.equal(f.call('incident.get',{ contextId:f.contextId,incidentId:f.incidentId }).value.value.status,'open');
  const events=f.store.events(f.contextId,0,1000);
  assert.equal(events.filter(event=>event.type==='runtime.schedule.triggered').length,1);
  assert.equal(events.filter(event=>event.type==='incident.update.committed' && event.causeIds.length).length,1);
  const revisionOfWake=events.find(event=>event.type==='incident.update.committed' && event.causeIds.length).revision;
  const committed=f.store.read(f.contextId,revisionOfWake),previous=f.store.read(f.contextId,revisionOfWake-1);
  assert.equal(committed.controlState.scheduleStates[scheduled.id].state,'completed');assert.equal(committed.controlState.incidents[f.incidentId].value.status,'open');
  assert.equal(previous.controlState.scheduleStates[scheduled.id].state,'active');assert.equal(previous.controlState.incidents[f.incidentId].value.status,'resting');
  f.reopen();const revision=f.store.read(f.contextId).context.revision;assert.equal(f.advance(),false);assert.equal(f.store.read(f.contextId).context.revision,revision);
});

test('a schedule excludes historical triggers and cancellation stops future admission',t=>{
  const f=fixture(t);f.trigger();const scheduled=f.put(f.rule());f.advance();assert.equal(f.status(scheduled.id).value.state,'active');
  assert.equal(f.write('schedule.cancel',{ scheduleId:scheduled.id }).ok,true);f.trigger();f.advance();
  assert.equal(f.status(scheduled.id).value.state,'cancelled');assert.equal(f.store.events(f.contextId,0,1000).some(event=>event.type==='runtime.schedule.triggered'),false);
});

test('coalescing retains source identities and causal feedback does not create an automatic loop',t=>{
  const f=fixture(t,{ document:true }),target={ ...atom(f.s),value:[] };
  const r=f.rule({ operation:'graph.transact',literalInput:{ contextId:f.contextId,expectedRevision:0,idempotencyKey:'placeholder',changes:[{ kind:'record.put',record:target }] },inputBindings:{ '/changes/0/record/id':'occurrence.id','/changes/0/record/value':'occurrence.eventIds' } });
  const scheduled=f.put(r,{ recurrence:'rearmAfterCompletion',coalesce:true });f.advance();
  const a=f.trigger(),b=f.trigger();f.advance();
  const results=f.store.read(f.contextId).records.filter(item=>Array.isArray(item.value.value));assert.equal(results.length,1);assert.deepEqual(results[0].value.value,[...a.commit.eventIds,...b.commit.eventIds]);
  assert.equal(f.status(scheduled.id).value.state,'active');assert.equal(f.status(scheduled.id).value.pendingOccurrenceIds.length,0);
  const revision=f.store.read(f.contextId).context.revision;assert.equal(f.advance(),false);assert.equal(f.store.read(f.contextId).context.revision,revision);
  f.trigger();f.advance();assert.equal(f.store.read(f.contextId).records.filter(item=>Array.isArray(item.value.value)).length,2);
});

test('edge triggers observe false-to-true changes, including intermediate retained snapshots',t=>{
  const f=fixture(t),r=f.rule(),scheduled=f.put(r,{ recurrence:'rearmAfterCompletion',wake:{ kind:'event',eventTypes:['graph.transact.committed'],selector:{ schemaNames:[f.s.name],assertionStatus:'asserted' },mode:'edge' } });f.advance();
  const supported=()=>{
    const record=atom(f.s),assertion={ id:randomUUID(),record:{ systemId:f.systemId,contextId:f.contextId,id:record.id },evidence };
    f.write('graph.transact',{ changes:[{ kind:'record.put',record },{ kind:'assertion.put',assertion }] });return assertion;
  };
  const a=supported(),b=supported();f.advance();
  assert.equal(f.store.events(f.contextId,0,1000).filter(event=>event.type==='runtime.schedule.triggered').length,1);
  f.write('graph.transact',{ changes:[a,b].map(item=>({ kind:'assertion.withdraw',assertionId:item.id,reason:'Reset edge' })) });supported();f.advance();
  assert.equal(f.store.events(f.contextId,0,1000).filter(event=>event.type==='runtime.schedule.triggered').length,2);assert.equal(f.status(scheduled.id).value.pendingOccurrenceIds.length,0);
});

test('revocation between occurrence persistence and admission prevents the destination from running',t=>{
  const f=fixture(t);allowDelegated(f);const r=f.rule(),actor=randomUUID(),record=atom(f.s);
  const bound=grant(f,actor,{ actions:['schedule.put','schedule.get','reaction.evaluate','events.read','incident.update'],incidentIds:[f.incidentId],resourceRefs:[r.ref,{ systemId:f.systemId,contextId:f.contextId,id:record.id }] });
  const scheduled=f.schedule(r);assert.equal(delegated(f,actor,bound,'schedule.put',{ schedule:scheduled },true).ok,true);
  f.trigger(record);f.kernel.scheduler.scan(f.contextId);assert.equal(f.status(scheduled.id).value.pendingOccurrenceIds.length,1);
  f.write('grant.revoke',{ grant:bound.ref,reason:'No longer authorized' });f.advance();
  const status=f.status(scheduled.id).value;assert.equal(status.pendingOccurrenceIds.length,1);assert.equal(status.lastFault.code,'FORBIDDEN');
  assert.equal(f.store.events(f.contextId,0,1000).some(event=>event.type==='incident.update.committed' && event.causeIds.length),false);
  const revision=f.store.read(f.contextId).context.revision;assert.equal(f.advance(),false);assert.equal(f.store.read(f.contextId).context.revision,revision);
});

test('due timers persist through restart and rearming an unchanged absolute anchor is refused',t=>{
  let now=Date.now();const clock={ wall:()=>now,monotonic:()=>0,bootId:randomUUID() },f=fixture(t,{ clock });
  const r=f.rule(),scheduled=f.put(r,{ wake:{ kind:'at',instant:new Date(now+1000).toISOString() } });f.advance();assert.equal(f.status(scheduled.id).value.state,'active');
  assert.equal(f.write('schedule.put',{ schedule:f.schedule(r,{ wake:scheduled.wake,recurrence:'rearmAfterCompletion' }) }).error.code,'INVALID_ARGUMENT');
  now+=1001;f.reopen();f.advance();assert.equal(f.status(scheduled.id).value.state,'completed');assert.equal(f.kernel.scheduler.nextDelay(),null);
});

test('an unresolved rule retains its occurrence and rests until new activity or cancellation',t=>{
  const f=fixture(t),r=f.rule({ condition:{ kind:'related',from:{ kind:'literal',value:null },to:{ kind:'literal',value:randomUUID() },schemaNames:['unresolved'],maxHops:1 } });
  const scheduled=f.put(r);f.trigger();f.advance();
  const state=f.status(scheduled.id).value;assert.equal(state.lastFault.code,'POLICY_INDETERMINATE');assert.equal(state.pendingOccurrenceIds.length,1);
  const revision=f.store.read(f.contextId).context.revision;assert.equal(f.advance(),false);assert.equal(f.store.read(f.contextId).context.revision,revision);
  assert.equal(f.write('schedule.cancel',{ scheduleId:scheduled.id }).ok,true);f.advance();assert.equal(f.status(scheduled.id).value.state,'cancelled');
});

test('relative anchors use retained receipt time and capacity wakes hold a stable edge while idle',t=>{
  let now=Date.now();const f=fixture(t,{ clock:{ wall:()=>now,monotonic:()=>0,bootId:randomUUID() } });
  const anchor=f.trigger().commit.eventIds[0],event=f.store.event(f.contextId,anchor);
  const timed=f.put(f.rule(),{ wake:{ kind:'after',eventId:anchor,durationMillis:1000 } });
  now=Date.parse(event.recordedAt)+999;f.advance();assert.equal(f.status(timed.id).value.state,'active');
  now++;f.advance();assert.equal(f.status(timed.id).value.state,'completed');
  const capacity=f.put(f.rule(),{ wake:{ kind:'capacity',resource:'concurrentExecutions',atLeast:1 },recurrence:'rearmAfterCompletion' });
  f.advance();assert.equal(f.status(capacity.id).value.state,'active');
  const revision=f.store.read(f.contextId).context.revision;assert.equal(f.advance(),false);assert.equal(f.store.read(f.contextId).context.revision,revision);
});

test('relative calendar overflow refuses schedule admission without a partial state or a raw date exception',t=>{
  const f=fixture(t),anchor=f.trigger().commit.eventIds[0],rule=f.rule(),invalid=f.schedule(rule,{wake:{kind:'after',eventId:anchor,durationMillis:Number.MAX_SAFE_INTEGER}});
  const revision=f.store.read(f.contextId).context.revision;
  const refused=f.write('schedule.put',{schedule:invalid});assert.equal(refused.error.code,'INVALID_ARGUMENT');assert.match(refused.error.message,/supported calendar/);
  assert.equal(f.store.read(f.contextId).context.revision,revision);assert.equal(f.store.read(f.contextId).controlState.schedules?.[invalid.id],undefined);
  const immediate=f.put(rule,{wake:{kind:'after',eventId:anchor,durationMillis:0}});f.advance();assert.equal(f.status(immediate.id).value.state,'completed');
});

test('compound scheduled execution checks its total rule envelope before atomically committing outbox effects',t=>{
  for(const cpuMillis of [300,400]){
    const f=executionFixture(t,{limits:{...limits,concurrentExecutions:2}}),proposalId=randomUUID(),scheduleId=randomUUID(),intent=f.intent();
    const rule={id:randomUUID(),triggerEventTypes:[],condition:truth,operation:'transition.commit',literalInput:{contextId:f.contextId,expectedRevision:0,idempotencyKey:'placeholder',proposalId},inputBindings:{},limits:{...limits,concurrentExecutions:2,cpuMillis}};
    const published=f.write('rule.publish',{rule});assert.equal(published.ok,true);
    const schedule={id:scheduleId,incidentId:intent.incidentId,rule:published.value.ref,wake:{kind:'event',eventTypes:['graph.transact.committed'],selector:{schemaNames:[f.capability.inputSchema.name],assertionStatus:'any'},mode:'each'},recurrence:'once',coalesce:false};
    assert.equal(f.write('schedule.put',{schedule}).ok,true);
    assert.equal(f.write('graph.transact',{changes:[{kind:'record.put',record:atom(f.capability.inputSchema)}]}).ok,true);
    f.kernel.scheduler.scan(f.contextId);
    assert.equal(f.call('schedule.get',{contextId:f.contextId,scheduleId}).value.pendingOccurrenceIds.length,1);
    const context=f.call('context.get',{contextId:f.contextId}).value;
    const proposal={id:proposalId,incidentId:intent.incidentId,basisRevision:context.revision,policy:context.policy,changes:[],executions:[intent,f.intent()],evidence};
    assert.equal(f.write('transition.propose',{proposal}).ok,true);assert.equal(f.store.outbox(f.contextId).length,0);
    assert.equal(f.kernel.scheduler.runOne(f.contextId),true);
    const status=f.call('schedule.get',{contextId:f.contextId,scheduleId}).value,retained=f.call('transition.get',{contextId:f.contextId,proposalId}).value;
    if(cpuMillis===300){assert.equal(status.lastFault.code,'FORBIDDEN');assert.equal(status.pendingOccurrenceIds.length,1);assert.equal(retained.state,'proposed');assert.equal(f.store.outbox(f.contextId).length,0);assert.equal(Object.keys(f.store.read(f.contextId).controlState.executions??{}).length,0);}
    else {assert.equal(status.state,'completed');assert.equal(status.pendingOccurrenceIds.length,0);assert.equal(retained.state,'committed');assert.equal(f.store.outbox(f.contextId).length,2);assert.equal(Object.keys(f.store.read(f.contextId).controlState.executions).length,2);}
  }
});

test('a definitive false condition completes once without calling its destination',t=>{
  const f=fixture(t),r=f.rule({ condition:{ kind:'equal',left:{ kind:'literal',value:true },right:{ kind:'literal',value:false } } });
  const scheduled=f.put(r);f.trigger();f.advance();assert.equal(f.status(scheduled.id).value.state,'completed');
  assert.equal(f.store.events(f.contextId,0,1000).some(event=>event.type==='incident.update.committed' && event.causeIds.length),false);
});

test('rearming waits for admitted execution completion and coalesces triggers received while active',t=>{
  const f=executionFixture(t),intent=f.intent();
  const rule=f.write('rule.publish',{ rule:{ id:randomUUID(),triggerEventTypes:['graph.transact.committed'],condition:truth,operation:'execution.request',literalInput:{ contextId:f.contextId,expectedRevision:0,idempotencyKey:'placeholder',execution:intent },inputBindings:{ '/execution/id':'occurrence.id' },limits } }).value;
  const scheduleId=randomUUID();assert.equal(f.write('schedule.put',{ schedule:{ id:scheduleId,incidentId:intent.incidentId,rule:rule.ref,wake:{ kind:'event',eventTypes:['graph.transact.committed'],selector:{ schemaNames:[f.capability.inputSchema.name],assertionStatus:'any' },mode:'each' },recurrence:'rearmAfterCompletion',coalesce:true } }).ok,true);
  const trigger=()=>f.write('graph.transact',{ changes:[{ kind:'record.put',record:atom(f.capability.inputSchema) }] });
  const advance=()=>f.kernel.scheduler.advance(f.contextId),status=()=>f.call('schedule.get',{ contextId:f.contextId,scheduleId }).value;
  trigger();advance();const first=status().activeExecutionIds[0];assert.ok(first);assert.equal(f.store.outbox(f.contextId).length,1);
  trigger();trigger();advance();assert.equal(status().pendingOccurrenceIds.length,1);assert.equal(f.store.outbox(f.contextId).length,1);
  const run=f.running(first);assert.equal(f.write('execution.finish',{ ...f.leaseInput(run),outcome,usage }).ok,true);advance();
  assert.equal(status().activeExecutionIds.length,1);assert.notEqual(status().activeExecutionIds[0],first);assert.equal(status().pendingOccurrenceIds.length,0);assert.equal(f.store.outbox(f.contextId).length,2);
});

test('coalescing overflow retains its rescan cursor and reports a bounded fault without dropping sources',t=>{
  const f=fixture(t,{ document:true }),target={ ...atom(f.s),value:[] };
  const r=f.rule({ operation:'graph.transact',literalInput:{ contextId:f.contextId,expectedRevision:0,idempotencyKey:'placeholder',changes:[{ kind:'record.put',record:target }] },inputBindings:{ '/changes/0/record/id':'occurrence.id','/changes/0/record/value':'occurrence.eventIds' } });
  f.put(r,{ recurrence:'rearmAfterCompletion',coalesce:true });f.advance();const sources=[];
  for (let index=0;index<33;index++) sources.push(...f.trigger().commit.eventIds);
  f.advance();const results=f.store.read(f.contextId).records.filter(item=>Array.isArray(item.value.value));
  assert.equal(results.length,2);assert.deepEqual(results.flatMap(item=>item.value.value),sources);
  const events=f.store.events(f.contextId,0,1000);assert.ok(events.some(event=>event.type==='runtime.schedule.waiting' && event.payload?.fault.code==='LIMIT_EXCEEDED'));
  const revision=f.store.read(f.contextId).context.revision;assert.equal(f.advance(),false);assert.equal(f.store.read(f.contextId).context.revision,revision);
});

test('a full source queue rests behind active work and resumes its retained cursor after completion',t=>{
  const f=executionFixture(t),intent=f.intent(),scheduleId=randomUUID();
  const rule=f.write('rule.publish',{rule:{id:randomUUID(),triggerEventTypes:[],condition:truth,operation:'execution.request',literalInput:{contextId:f.contextId,expectedRevision:0,idempotencyKey:'placeholder',execution:intent},inputBindings:{'/execution/id':'occurrence.id'},limits}}).value;
  const schedule={id:scheduleId,incidentId:intent.incidentId,rule:rule.ref,wake:{kind:'event',eventTypes:['graph.transact.committed'],selector:{schemaNames:[f.capability.inputSchema.name],assertionStatus:'any'},mode:'each'},recurrence:'rearmAfterCompletion',coalesce:false};
  assert.equal(f.write('schedule.put',{schedule}).ok,true);
  const trigger=()=>{const result=f.write('graph.transact',{changes:[{kind:'record.put',record:atom(f.capability.inputSchema)}]});assert.equal(result.ok,true);return result.value.eventIds[0];};
  trigger();f.kernel.scheduler.advance(f.contextId);const first=f.call('schedule.get',{contextId:f.contextId,scheduleId}).value.activeExecutionIds[0];assert.ok(first);
  const sources=Array.from({length:129},trigger);f.kernel.scheduler.scan(f.contextId);
  const queued=f.store.read(f.contextId).controlState.scheduleStates[scheduleId];assert.equal(queued.pending.length,128);assert.equal(queued.lastFault.code,'LIMIT_EXCEEDED');
  assert.equal(f.kernel.scheduler.ready(f.contextId),false,'An unchanged full queue cannot progress while its previous execution remains active');
  const run=f.running(first);assert.equal(f.write('execution.finish',{...f.leaseInput(run),outcome,usage}).ok,true);
  assert.equal(f.kernel.scheduler.ready(f.contextId),true,'New activity must release the observation backpressure before the active execution list is refreshed');f.kernel.scheduler.advance(f.contextId);
  const resumed=f.store.read(f.contextId).controlState.scheduleStates[scheduleId];assert.ok(resumed.pending.some(item=>item.eventIds.includes(sources.at(-1))),'The omitted source event must be recovered from the retained cursor');assert.equal(f.store.outbox(f.contextId).length,2);
});

test('a stale dispatch fault cannot annotate a schedule cancelled by a newer admitted operation',t=>{
  const f=fixture(t),scheduled=f.put(f.rule());f.trigger();f.kernel.scheduler.scan(f.contextId);
  const scheduler=f.kernel.scheduler,admit=scheduler.admit.bind(scheduler),revision=f.store.read(f.contextId).context.revision;
  // Script an interrupted port, while cancellation itself uses the real API and
  // SQLite transaction. No primary process or external provider participates.
  scheduler.admit=()=>{scheduler.admit=admit;assert.equal(f.write('schedule.cancel',{scheduleId:scheduled.id}).ok,true);throw new DomainError('FORBIDDEN','Scripted refusal after a newer cancellation');};
  assert.equal(scheduler.runOne(f.contextId),true);
  const current=f.store.read(f.contextId),state=current.controlState.scheduleStates[scheduled.id];assert.equal(state.state,'cancelled');assert.equal(state.lastFault,undefined);assert.equal(current.context.revision,revision+1,'Only the newer cancellation should commit');
});

test('an intervening revision makes a delayed refusal stale even when its occurrence remains pending',t=>{
  const f=fixture(t),scheduled=f.put(f.rule());f.trigger();f.kernel.scheduler.scan(f.contextId);
  const scheduler=f.kernel.scheduler,admit=scheduler.admit.bind(scheduler),revision=f.store.read(f.contextId).context.revision;
  scheduler.admit=()=>{scheduler.admit=admit;f.trigger();throw new DomainError('FORBIDDEN','Scripted stale refusal');};
  assert.equal(scheduler.runOne(f.contextId),true);const current=f.store.read(f.contextId),state=current.controlState.scheduleStates[scheduled.id];
  assert.equal(state.pending.length,1);assert.equal(state.lastFault,undefined);assert.equal(current.context.revision,revision+1);
  assert.equal(scheduler.runOne(f.contextId),true);assert.equal(f.status(scheduled.id).value.state,'completed');
});

test('fair dispatch rotates incidents and retains oldest occurrence order within each incident',t=>{
  const f=fixture(t),ids=[randomUUID(),f.incidentId,randomUUID()].sort();
  for(const id of ids)if(id!==f.incidentId)assert.equal(f.write('incident.create',{id,incident}).ok,true);
  const rules=ids.map(incidentId=>f.rule({literalInput:{contextId:f.contextId,expectedRevision:0,idempotencyKey:'placeholder',incidentId,incident:{...incident,status:'resting'},evidence}}));
  // Installation order differs from incident order; each incident has two
  // separately retained schedules. The first dispatch follows global age.
  const order=[2,0,0,1,2,1],schedules=order.map((index,position)=>f.put(rules[index],{id:'00000000-0000-4000-8000-'+String(position+1).padStart(12,'0'),incidentId:ids[index]}));
  f.trigger();f.kernel.scheduler.scan(f.contextId);const completed=[];
  for(let index=0;index<schedules.length;index++){
    const before=new Set(completed);assert.equal(f.kernel.scheduler.runOne(f.contextId),true);
    const next=schedules.find(s=>!before.has(s.id)&&f.status(s.id).value.state==='completed');assert.ok(next);completed.push(next.id);
  }
  assert.deepEqual(completed,[schedules[0],schedules[1],schedules[3],schedules[4],schedules[2],schedules[5]].map(s=>s.id));
  assert.equal(f.kernel.scheduler.runOne(f.contextId),false);
});

test('interacting rearmed schedules retain legitimate cross reactions and terminate their causal feedback',t=>{
  const f=fixture(t),target=atom(f.s);
  const rule=()=>f.rule({operation:'graph.transact',literalInput:{contextId:f.contextId,expectedRevision:0,idempotencyKey:'placeholder',changes:[{kind:'record.put',record:target}]},inputBindings:{'/changes/0/record/id':'occurrence.id'}});
  const schedules=[f.put(rule(),{recurrence:'rearmAfterCompletion'}),f.put(rule(),{recurrence:'rearmAfterCompletion'})];
  f.trigger();f.advance();
  const events=f.store.events(f.contextId,0,1000);assert.equal(events.filter(event=>event.type==='runtime.schedule.completed').length,4);
  for(const schedule of schedules){const state=f.status(schedule.id).value;assert.equal(state.state,'active');assert.deepEqual(state.pendingOccurrenceIds,[]);assert.equal(state.lastFault,undefined);}
  const revision=f.store.read(f.contextId).context.revision;assert.equal(f.advance(),false);assert.equal(f.store.read(f.contextId).context.revision,revision);
});
