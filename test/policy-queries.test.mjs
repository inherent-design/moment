import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup,incident,limits,schema,atom} from './helpers.mjs';
import * as core from '../runtime/semantic-core.mjs';

for(const kind of ['missing','numeric'])test('a local relationship operand with '+kind+' identity remains unresolved',t=>{
 const f=setup(t),incidentId=randomUUID();assert.equal(f.write('incident.create',{id:incidentId,incident}).ok,true);
 const from={systemId:f.systemId,contextId:f.contextId,...(kind==='numeric'?{id:5}:{})};
 const rule={id:randomUUID(),triggerEventTypes:[],condition:{kind:'related',from:{kind:'literal',value:from},to:{kind:'literal',value:randomUUID()},schemaNames:['permission'],maxHops:1},operation:'graph.transact',literalInput:{contextId:f.contextId,expectedRevision:0,idempotencyKey:'unused',changes:[]},inputBindings:{},limits};
 const published=f.write('rule.publish',{rule});assert.equal(published.ok,true);const revision=f.store.read(f.contextId).context.revision;
 const evaluated=f.call('reaction.evaluate',{contextId:f.contextId,incidentId,rule:published.value.ref,eventIds:[]});
 assert.equal(evaluated.error?.code,'POLICY_INDETERMINATE','A value outside the reference sort cannot become a known negative or an argument error after rule admission');assert.equal(f.store.read(f.contextId).context.revision,revision);
});

test('a foreign existence-query endpoint remains unresolved rather than leaking a lookup failure',t=>{
 const f=setup(t),incidentId=randomUUID();assert.equal(f.write('incident.create',{id:incidentId,incident}).ok,true);
 const rule={id:randomUUID(),triggerEventTypes:[],condition:{kind:'exists',selector:{assertionStatus:'asserted',relatedTo:{systemId:f.systemId,contextId:randomUUID(),id:randomUUID()}}},operation:'graph.transact',literalInput:{contextId:f.contextId,expectedRevision:0,idempotencyKey:'unused',changes:[]},inputBindings:{},limits};
 const published=f.write('rule.publish',{rule});assert.equal(published.ok,true);
 assert.equal(f.call('reaction.evaluate',{contextId:f.contextId,incidentId,rule:published.value.ref,eventIds:[]}).error.code,'POLICY_INDETERMINATE');
});

test('a wide persisted relationship respects its node bound without exhausting unrelated observations',t=>{
 const f=setup(t),s=schema(f),relations=schema(f,{type:'object',additionalProperties:true}),nodes=Array.from({length:515},()=>atom(s)),ref=id=>({systemId:f.systemId,contextId:f.contextId,id});
 const edge={id:randomUUID(),kind:'relation',schema:relations,roles:{subject:[ref(nodes[0].id)],object:nodes.slice(1,514).map(item=>ref(item.id))}},assertion={id:randomUUID(),record:ref(edge.id),evidence:{sources:[],method:'owned wide-edge fixture',artifactDigests:[]}};
 const result=f.write('graph.transact',{changes:[...nodes.map(record=>({kind:'record.put',record})),{kind:'record.put',record:edge},{kind:'assertion.put',assertion}]});assert.equal(result.ok,true);
 const snapshot=f.store.read(f.contextId),access=f.kernel.admission(snapshot,f.ownerId),queries=f.kernel.policyQueries(snapshot,access,f.ownerId);
 assert.equal(queries.related(nodes[0].id,nodes[511].id,[relations.name],1),true);
 assert.equal(queries.related(nodes[0].id,nodes[514].id,[relations.name],1),'unknown');
 assert.equal(queries.exists({ids:[edge.id],assertionStatus:'asserted'}),true,'A node-limit observation retains the independent remaining query budget');
});

test('persisted provenance can exhaust the shared policy budget without manufacturing a known negative',t=>{
 const f=setup(t),s=schema(f),record=atom(s),ref=id=>({systemId:f.systemId,contextId:f.contextId,id});
 assert.equal(f.write('graph.transact',{changes:[{kind:'record.put',record}]}).ok,true);
 const assertions=Array.from({length:33},()=>({id:randomUUID(),record:ref(record.id),evidence:{sources:Array(1000).fill(ref(record.id)),method:'explicit repeated observations',artifactDigests:[]}}));
 for(let offset=0;offset<assertions.length;offset+=4)assert.equal(f.write('graph.transact',{changes:assertions.slice(offset,offset+4).map(assertion=>({kind:'assertion.put',assertion}))}).ok,true);
 const snapshot=f.store.read(f.contextId),queries=f.kernel.policyQueries(snapshot,f.kernel.admission(snapshot,f.ownerId),f.ownerId);
 assert.equal(queries.exists({ids:[record.id],assertionStatus:'asserted'}),'unknown');assert.equal(queries.related(record.id,record.id,[s.name],1),'unknown');
});

test('an unaffordable role suffix is not decoded and cannot erase an already observed positive path',()=>{
 const context={systemId:'system',id:'context'},ref=id=>({systemId:context.systemId,contextId:context.id,id}),access={operator:true,canRead:()=>true};
 const snapshot={context,records:[],assertions:[]},projection=core.policyQueryProjection(snapshot,[]),budget=core.policyQueryCharge(projection.budget,[32765]);let reads=0;
 const hidden=Array(1000).fill(ref('other'));Object.defineProperty(hidden,0,{get(){reads++;throw Error('Unaffordable target was decoded');}});
 const edge=(id,targets)=>({ref:ref(id),value:{id,kind:'relation',schema:{name:'edge'},roles:{subject:[ref('start')],object:targets}}});
 const records=[edge('first',[ref('end')]),edge('suffix',hidden)],supported=new Set(['first','suffix']),start=core.policyQueryEndpoint(context,'start',access),end=core.policyQueryEndpoint(context,'end',access);
 const found=core.policyQueryRelated(budget,records,supported,['edge'],start,end,1,access);assert.equal(found.value,true);assert.equal(found.budget.remaining,0);assert.equal(reads,0);
 const unresolved=core.policyQueryRelated(budget,[records[1]],new Set(['suffix']),['edge'],start,end,1,access);assert.equal(unresolved.value,'unknown');assert.equal(reads,0);
 const exhausted=core.policyQueryCharge(budget,[4]);assert.equal(core.policyQueryRelated(exhausted,[],new Set(),['edge'],start,end,1,access).value,'unknown');
});
