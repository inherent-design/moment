import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,incident,limits} from './helpers.mjs';
const equal=(left,right)=>({kind:'equal',left,right}),literal=value=>({kind:'literal',value}),binding=name=>({kind:'binding',name});
function fixture(t) {
 const f=setup(t),incidentId=randomUUID();assert.equal(f.write('incident.create',{id:incidentId,incident}).ok,true);
 const publish=condition=>{const result=f.write('rule.publish',{rule:{id:randomUUID(),triggerEventTypes:[],condition,operation:'incident.update',literalInput:{contextId:f.contextId,expectedRevision:0,idempotencyKey:'pending',incidentId,incident,evidence:{sources:[],method:'Candidate only',artifactDigests:[]}},inputBindings:{'/expectedRevision':'contextRevision','/idempotencyKey':'event.id'},limits}});assert.equal(result.ok,true,JSON.stringify(result));return result.value.ref;};
 const evaluate=(rule,eventIds,extra={})=>f.call('reaction.evaluate',{contextId:f.contextId,incidentId,rule,eventIds,...extra});
 const event=()=>f.write('graph.transact',{changes:[]}).value.eventIds[0];
 return {f,publish,evaluate,event};
}
test('reactions use stored event sequence order even when the caller supplies the reverse order',t=>{
 const {f,publish,evaluate,event}=fixture(t),rule=publish(equal(literal(true),literal(true))),first=event(),second=event(),before=f.store.read(f.contextId).context.revision;
 const result=evaluate(rule,[second,first]);assert.equal(result.ok,true);assert.equal(result.value.eligible,true);assert.equal(result.value.candidateInput.idempotencyKey,first);assert.equal(f.store.read(f.contextId).context.revision,before);
});
test('a later positive event resolves an earlier unknown observation without executing the destination',t=>{
 const {f,publish,evaluate,event}=fixture(t),first=event(),second=event(),rule=publish({kind:'any',terms:[equal(binding('event.id'),literal(second)),equal(binding('occurrence.id'),literal(true))]}),before=f.store.read(f.contextId).context.revision;
 const result=evaluate(rule,[second,first]);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.candidateInput.idempotencyKey,second);assert.equal(f.store.read(f.contextId).context.revision,before);
 const unknown=evaluate(rule,[first]);assert.equal(unknown.error.code,'POLICY_INDETERMINATE');assert.equal(f.store.read(f.contextId).context.revision,before);
});
test('a named event beyond the requested snapshot is unavailable even when currently visible',t=>{
 const {f,publish,evaluate,event}=fixture(t),rule=publish(equal(literal(true),literal(true))),first=event(),revision=f.store.read(f.contextId).context.revision,second=event();
 assert.equal(evaluate(rule,[first],{atRevision:revision}).ok,true);assert.equal(evaluate(rule,[second],{atRevision:revision}).error.code,'NOT_FOUND');
});
