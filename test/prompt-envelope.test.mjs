import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {promptSchema} from '../runtime/builtins.mjs';
import {setup,schema,atom,incident,limits,allowDelegated,grant,delegated} from './helpers.mjs';

test('composed prompt limits include a lowered context ceiling as well as current policy and grants',t=>{
 const f=setup(t),incidentId=randomUUID();assert.equal(f.write('incident.create',{id:incidentId,incident}).ok,true);
 const s=schema(f),source=atom(s),template={id:randomUUID(),kind:'atom',schema:promptSchema,value:{text:'Use {{source}}',sourceSlots:['source']}},ref=id=>({systemId:f.systemId,contextId:f.contextId,id});
 assert.equal(f.write('graph.transact',{changes:[{kind:'record.put',record:source},{kind:'record.put',record:template},{kind:'assertion.put',assertion:{id:randomUUID(),record:ref(template.id),evidence:{sources:[],method:'Accepted template',artifactDigests:[]}}}]}).ok,true);
 assert.equal(f.write('context.limits',{limits:{...limits,cpuMillis:123,outputBytes:456},evidence:{sources:[ref(source.id)],method:'Reduced actual context allowance',artifactDigests:[]}}).ok,true);
 const result=f.call('prompt.compose',{contextId:f.contextId,incidentId,template:ref(template.id),sourceRefs:[ref(source.id)],outputSchema:s,maximumInputBytes:16384});
 assert.equal(result.ok,true,JSON.stringify(result));const envelope=JSON.parse(result.value.content).context.limits;
 assert.equal(envelope.cpuMillis,123);assert.equal(envelope.outputBytes,456);assert.equal(envelope.currency,'USD');
});

test('prompt envelope keeps exact large context/grant minima and the earliest deadline without changing units',t=>{
 const initial={...limits,cpuMillis:Number.MAX_SAFE_INTEGER,outputBytes:2**48+1,deadline:'2080-01-01T00:00:00Z'},f=setup(t,{limits:initial});allowDelegated(f);
 const incidentId=randomUUID();assert.equal(f.write('incident.create',{id:incidentId,incident}).ok,true);
 const s=schema(f),source=atom(s),template={id:randomUUID(),kind:'atom',schema:promptSchema,value:{text:'Use {{source}}',sourceSlots:['source']}},ref=id=>({systemId:f.systemId,contextId:f.contextId,id});
 assert.equal(f.write('graph.transact',{changes:[{kind:'record.put',record:source},{kind:'record.put',record:template},{kind:'assertion.put',assertion:{id:randomUUID(),record:ref(template.id),evidence:{sources:[],method:'Accepted template',artifactDigests:[]}}}]}).ok,true);
 assert.equal(f.write('context.limits',{limits:{...initial,cpuMillis:2**32+1,deadline:'2070-01-01T00:00:00Z'},evidence:{sources:[ref(source.id)],method:'Actual context allowance',artifactDigests:[]}}).ok,true);
 const actor=randomUUID(),bound=grant(f,actor,{actions:['prompt.compose'],limits:{...initial,cpuMillis:2**32,deadline:'2060-01-01T00:00:00Z'},resourceRefs:[ref(template.id),ref(source.id),f.kernel.schema(f.store.read(f.contextId),s).ref]});
 const result=delegated(f,actor,bound,'prompt.compose',{incidentId,template:ref(template.id),sourceRefs:[ref(source.id)],outputSchema:s,maximumInputBytes:16384});
 assert.equal(result.ok,true,JSON.stringify(result));const envelope=JSON.parse(result.value.content).context.limits;
 assert.equal(envelope.cpuMillis,2**32);assert.equal(envelope.outputBytes,2**48+1);assert.equal(envelope.deadline,'2060-01-01T00:00:00Z');assert.equal(envelope.currency,'USD');
});

test('actual prompt omission follows reverse declaration order even when optional names are supplied in another order',t=>{
 const f=setup(t),incidentId=randomUUID();assert.equal(f.write('incident.create',{id:incidentId,incident}).ok,true);
 const s=schema(f),records=['first','middle','last'].map(label=>({...atom(s),value:label+'🐈'.repeat(1000)})),template={id:randomUUID(),kind:'atom',schema:promptSchema,value:{text:'{{first}} {{middle}} {{last}}',sourceSlots:['first','middle','last'],optionalSlots:['last','first']}},ref=id=>f.kernel.ref(f.contextId,id);
 assert.equal(f.write('graph.transact',{changes:[...records,template].map(record=>({kind:'record.put',record})).concat([{kind:'assertion.put',assertion:{id:randomUUID(),record:ref(template.id),evidence:{sources:[],method:'Accepted multi-source template',artifactDigests:[]}}}])}).ok,true);
 const input={contextId:f.contextId,incidentId,template:ref(template.id),sourceRefs:records.map(record=>ref(record.id)),outputSchema:s,maximumInputBytes:262144},full=f.call('prompt.compose',input);assert.equal(full.ok,true);
 const bounded=f.call('prompt.compose',{...input,maximumInputBytes:Buffer.byteLength(full.value.content)-1});assert.equal(bounded.ok,true,JSON.stringify(bounded));assert.deepEqual(bounded.value.omittedRefs,[ref(records[2].id)]);assert.equal(JSON.parse(bounded.value.content).quotedEvidence.rendered.endsWith('[omitted]'),true);
});
