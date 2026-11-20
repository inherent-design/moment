import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../runtime/semantic-core.mjs';

const ref={systemId:'system',contextId:'context',id:'schedule'};
const event=(id,causes=[],overrides={})=>({id,contextId:'context',type:'graph.transact.committed',subjectRefs:[],causeIds:causes,...overrides});

test('causal ancestry preserves full reference identity and refuses missing or foreign observations',()=>{
 const triggered=event('trigger',[],{type:'runtime.schedule.triggered',subjectRefs:[ref]});
 for(const subjects of [[ref],[{...ref,contextId:'foreign'}],[{...ref,systemId:'foreign'}]]){
  const root=event('root',['trigger']),lookup=id=>id==='trigger'?{...triggered,subjectRefs:subjects}:undefined;
  assert.equal(core.scheduleDepends(root,lookup,'context',ref),subjects[0]===ref);
 }
 const root=event('root',['missing']);assert.equal(core.scheduleDepends(root,()=>undefined,'context',ref),'unknown');
 assert.equal(core.scheduleDepends(root,()=>event('different'),'context',ref),'unknown');
 assert.equal(core.scheduleDepends(root,()=>event('missing',[],{contextId:'foreign'}),'context',ref),'unknown');
});

test('causal observations are bounded, revisit-safe and preserve the 128-step boundary',()=>{
 for(const length of [127,128,129]){
  const chain=Array.from({length},(_,index)=>event(String(index),index+1<length?[String(index+1)]:[])),seen=[];
  const actual=core.scheduleDepends(chain[0],id=>{seen.push(id);return chain[Number(id)];},'context',ref);
  assert.equal(actual,length<=128?false:'unknown');assert.equal(seen.length,Math.min(length-1,127));
 }
 const graph=[event('root',['a','a','b']),event('a',['b']),event('b',['root'])],calls=[];
 assert.equal(core.scheduleDepends(graph[0],id=>{calls.push(id);return graph.find(item=>item.id===id);},'context',ref),false);
 assert.deepEqual(calls,['b','a']);
 const guarded=event('root',Array(129).fill('leaf'));
 assert.equal(core.scheduleDepends(guarded,()=>event('leaf'),'context',ref),'unknown','Repeated pops consume the same bounded ancestry budget');
});

test('coalescing preserves source order and refuses overflow without consuming the caller state',()=>{
 const sources=Array.from({length:32},(_,index)=>String(index)),state={pending:[{eventIds:sources}]},before=structuredClone(state);
 assert.deepEqual(core.scheduleQueue(state,true,['31','new']),{kind:'SchQueueFull'});assert.deepEqual(state,before);
 assert.deepEqual(core.scheduleQueue(state,true,['31','0']),{kind:'SchMerge',sources});
 assert.deepEqual(core.scheduleSelection(['c','a','b'],['b','c']),['c','b']);
 assert.equal(core.scheduleOrder(Number.MAX_SAFE_INTEGER-1,0),Number.MAX_SAFE_INTEGER);
 assert.throws(()=>core.scheduleOrder(Number.MAX_SAFE_INTEGER,0),error=>error.code==='LIMIT_EXCEEDED');
 for(const value of ['toString','constructor','__proto__']){
  assert.throws(()=>core.scheduleNeedsEvents(value),error=>error.code==='INVALID_ARGUMENT');
  assert.throws(()=>core.scheduleCancellable(value),error=>error.code==='INVALID_ARGUMENT');
  assert.throws(()=>core.scheduleWakeAdmission({wake:{kind:'event'},recurrence:value}),error=>error.code==='INVALID_ARGUMENT');
 }
});

test('candidate selection preserves stable ties, current blocking and active-work exclusion',()=>{
 const entries=[['first',{value:{incidentId:'a'}}],['second',{value:{incidentId:'a'}}],['other',{value:{incidentId:'b'}}]];
 const state=order=>({state:'active',lastSeq:100,pending:[{id:'occ',eventIds:[],order}],activeExecutionIds:[],edge:false,timerFired:false,blockedActivity:-1});
 const states={first:state(7),second:state(7),other:{...state(5),blockedActivity:100}};
 assert.equal(core.scheduleChoose(entries,states,100)?.[0],'first');assert.equal(core.scheduleChoose(entries,states,100,'a')?.[0],'first');
 assert.equal(core.scheduleChoose(entries,states,101,'a')?.[0],'other');
 states.other.activeExecutionIds=['busy'];assert.equal(core.scheduleChoose(entries,states,101,'a')?.[0],'first');
});
