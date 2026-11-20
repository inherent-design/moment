import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonical} from '../runtime/json.mjs';
import * as core from '../runtime/semantic-core.mjs';
import {setup,schema,atom,allowDelegated,grant,delegated} from './helpers.mjs';
const ref=id=>({systemId:'system',contextId:'context',id});
const observed=(id,groups,causes=[],contextId='context')=>({id,contextId,visibilityAlternatives:groups.map(group=>group.map(ref)),causeIds:causes});

test('visibility demands preserve independent alternatives and stop before unrelated reference reads',()=>{
 const calls=[],event=observed('root',[['a','b'],['c','d'],['unrelated']]);
 assert.equal(core.eventVisible(false,event,'context',()=>undefined,r=>{calls.push(r.id);return ['a','d'].includes(r.id);}),false);assert.deepEqual(calls,['a','b','c','unrelated']);
 calls.length=0;assert.equal(core.eventVisible(false,event,'context',()=>undefined,r=>{calls.push(r.id);return ['a','b'].includes(r.id);}),true);assert.deepEqual(calls,['a','b']);
});
test('reference observations remain fresh across nodes instead of reusing an earlier permission',()=>{
 const root=observed('root',[['same']],['child']),child=observed('child',[['same']]);let reads=0;
 assert.equal(core.eventVisible(false,root,'context',id=>id==='child'?child:undefined,()=>++reads===1),false);assert.equal(reads,2);
});
test('the visibility budget counts repeated pops and observes each immutable event only when demanded',()=>{
 const child=observed('child',[['visible']]);
 for(const [size,expected] of [[63,true],[64,false]]){let fetches=0;
  const root=observed('root',[['visible']],Array(size).fill('child'));
  assert.equal(core.eventVisible(false,root,'context',id=>{fetches++;assert.equal(id,'child');return child;},()=>true),expected);assert.equal(fetches,1);
 }
 assert.equal(core.eventVisible(false,observed('root',[['visible']],['missing']),'context',()=>undefined,()=>true),false);
 assert.equal(core.eventVisible(false,observed('root',[['visible']],['foreign']),'context',()=>observed('foreign',[['visible']],[],'elsewhere'),()=>true),false);
});
test('actual delegated event reads preserve the exact64-pop boundary across reopening',t=>{
 const f=setup(t);allowDelegated(f);const record=atom(schema(f));assert.equal(f.write('graph.transact',{changes:[{kind:'record.put',record}]}).ok,true);
 const actor=randomUUID(),resource=f.kernel.ref(f.contextId,record.id),bound=grant(f,actor,{actions:['events.read'],resourceRefs:[resource]}),snapshot=f.store.read(f.contextId),ids=Array.from({length:65},()=>randomUUID());
 let sequence=f.store.sequence(f.contextId);
 f.store.db.exec('BEGIN IMMEDIATE');
 for(let i=0;i<ids.length;i++){
  const event={id:ids[i],contextId:f.contextId,type:'fixture.visibility',subjectRefs:[resource],visibilityAlternatives:[[resource]],causeIds:ids[i+1]?[ids[i+1]]:[],payload:null,sequence:++sequence,revision:snapshot.context.revision,recordedAt:'2026-01-01T00:00:00Z'};
  f.store.db.prepare('INSERT INTO events VALUES (?,?,?,?)').run(f.contextId,sequence,event.id,canonical(event));
 }
 f.store.db.exec('COMMIT');f.reopen();
 const result=delegated(f,actor,bound,'events.read',{limit:100,waitMillis:0});assert.equal(result.ok,true,JSON.stringify(result));const visible=new Set(result.value.items.map(event=>event.id));assert.equal(visible.has(ids[0]),false);assert.equal(visible.has(ids[1]),true);assert.equal(visible.has(ids[64]),true);assert.equal(JSON.stringify(result).includes('visibilityAlternatives'),false);
});
test('recipient discovery asks for grants only when needed and bounds matching candidates without rejecting unrelated grants',()=>{
 const ownerOnly={controlState:{get grants(){throw Error('Unrequested grant read');}}};assert.deepEqual(core.recipientCandidates(ownerOnly,'owner','owner'),[undefined]);
 const snapshot={controlState:{grants:Object.fromEntries(Array.from({length:4100},(_,i)=>['g'+i,{value:{principalId:'other'},ref:ref('g'+i)}]))}};
 assert.deepEqual(core.recipientCandidates(snapshot,'actor','owner'),[]);
 for(let i=0;i<4096;i++)snapshot.controlState.grants['g'+i].value.principalId='actor';assert.equal(core.recipientCandidates(snapshot,'actor','owner').length,4096);
 snapshot.controlState.grants.g4096.value.principalId='actor';assert.throws(()=>core.recipientCandidates(snapshot,'actor','owner'),{code:'LIMIT_EXCEEDED'});
});

test('legacy visibility references preserve explicit empty requirements instead of falling back to public subjects',()=>{
 const event={id:'legacy',contextId:'context',subjectRefs:[ref('public')],causeIds:[]};
 assert.equal(core.eventVisible(false,event,'context',()=>undefined,()=>true),true);
 assert.equal(core.eventVisible(false,{...event,visibilityRefs:[ref('private')]},'context',()=>undefined,r=>r.id==='public'),false);
 assert.equal(core.eventVisible(false,{...event,visibilityRefs:[]},'context',()=>undefined,()=>true),false);
});

test('the native detail bridge admits all32000 role references and preserves a denial in the last role',()=>{
 const roles=Object.fromEntries(Array.from({length:32},(_,i)=>['role'+i,Array.from({length:1000},(_,j)=>ref(i+':'+j))])),stored={value:{kind:'relation',roles}};
 assert.equal(core.awarenessDetail(stored,false,false,false,{canRead:()=>true}),'DetailAllowed');
 assert.equal(core.awarenessDetail(stored,false,false,false,{canRead:r=>r.id!=='31:999'}),'DetailRelation');
});

test('wide template provenance admits the first supported instruction without exhausting the generated stack',()=>{
 const assertions=Array.from({length:10000},()=>({status:'asserted',assertion:{recordedBy:'owner',value:{record:ref('template'),evidence:{sources:[]}}}}));
 assert.equal(core.templateSupported(assertions,ref('template'),['owner'],{canRead:()=>true}),true);
 for(const item of assertions)item.assertion.value.record=ref('unrelated');
 assert.equal(core.templateSupported(assertions,ref('template'),['owner'],{canRead:()=>true}),false);
});
