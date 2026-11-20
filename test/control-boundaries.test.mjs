import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,schema,atom,allowDelegated,grant,delegated,incident} from './helpers.mjs';

test('root JSON Pointer projects a visible stored record and permits schema grouping without adding support',t=>{
 const f=setup(t),record=atom(schema(f)),ref=id=>({systemId:f.systemId,contextId:f.contextId,id});
 assert.equal(f.write('graph.transact',{changes:[{kind:'record.put',record},{kind:'assertion.put',assertion:{id:randomUUID(),record:ref(record.id),evidence:{sources:[],method:'Observed record',artifactDigests:[]}}}]}).ok,true);
 const published=f.write('view.publish',{view:{id:randomUUID(),selector:{ids:[record.id],assertionStatus:'asserted'},fields:[''],groupBy:'schema'}});
 assert.equal(published.ok,true,JSON.stringify(published));
 const result=f.call('view.read',{contextId:f.contextId,view:published.value.ref,limit:10});assert.equal(result.ok,true);
 assert.equal(result.value.records[0].fields[''].value.id,record.id);assert.equal(result.value.records[0].fields[''].digest,f.store.read(f.contextId).records[0].digest);assert.deepEqual(result.value.support,[]);
});

test('projection admission preserves limits, escaped keys, schema visibility and inaccessible records',t=>{
 const f=setup(t);allowDelegated(f);const s=schema(f,{type:'object',additionalProperties:true}),records=[{...atom(s),value:{'a/b':'Selected'}},{...atom(s),value:{secret:'Unrelated'}}];
 assert.equal(f.write('graph.transact',{changes:records.map(record=>({kind:'record.put',record}))}).ok,true);
 const base={selector:{assertionStatus:'any'},fields:['/value/value/a~1b']};
 for(const fields of [['/support/value'],['/digest/extra'],['/other'],['bad'],['/value/~2']])assert.equal(f.write('view.publish',{view:{id:randomUUID(),...base,fields}}).error.code,'INVALID_ARGUMENT');
 assert.equal(f.write('view.publish',{view:{id:randomUUID(),...base,fields:Array(65).fill('bad')}}).error.code,'LIMIT_EXCEEDED');
 assert.equal(f.write('view.publish',{view:{id:randomUUID(),...base,groupBy:'schema'}}).error.code,'INVALID_ARGUMENT');
 const root=f.write('view.publish',{view:{id:randomUUID(),...base,fields:['']}}).value;
 const escaped=f.write('view.publish',{view:{id:randomUUID(),...base}}).value;
 const actor=randomUUID(),bound=grant(f,actor,{actions:['view.read'],resourceRefs:[root.ref,escaped.ref,{systemId:f.systemId,contextId:f.contextId,id:records[0].id}]});
 const visible=delegated(f,actor,bound,'view.read',{view:root.ref,limit:10});assert.equal(visible.ok,true);assert.equal(visible.value.records.length,1);assert.equal(JSON.stringify(visible).includes('Unrelated'),false);assert.deepEqual(visible.value.support,[]);
 assert.equal(delegated(f,actor,bound,'view.read',{view:escaped.ref,limit:10}).value.records[0].fields['/value/value/a~1b'],'Selected');
});

test('an empty or self-aliasing proposal refuses without a partial control record or event',t=>{
 const f=setup(t),incidentId=randomUUID();assert.equal(f.write('incident.create',{id:incidentId,incident}).ok,true);const record=atom(schema(f));
 for(const kind of ['empty','alias']) {
  const current=f.store.read(f.contextId),id=randomUUID(),proposal={id,incidentId,basisRevision:current.context.revision,policy:current.context.policy,changes:kind==='empty'?[]:[{kind:'record.put',record:{...record,id}}],executions:[],evidence:{sources:[],method:'Candidate shape',artifactDigests:[]}};
  const result=f.write('transition.propose',{proposal});assert.equal(result.error.code,kind==='empty'?'INVALID_ARGUMENT':'IDENTITY_CONFLICT');
  const after=f.store.read(f.contextId);assert.equal(after.context.revision,current.context.revision);assert.deepEqual(after.records,current.records);assert.deepEqual(after.controlState.transitions,current.controlState.transitions);assert.deepEqual(f.store.outbox(f.contextId),[]);
 }
});
