import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { builtinSchemas } from '../runtime/builtins.mjs';
import { bindInput } from '../runtime/pointers.mjs';
import { limits, incident, setup, schema, atom, allowDelegated, grant, delegated } from './helpers.mjs';

const evidence={ sources:[],method:'fixture',artifactDigests:[] };
const truth={ kind:'equal',left:{ kind:'literal',value:true },right:{ kind:'literal',value:true } };
function proposal(f,changes,incidentId) {
  const context=f.call('context.get',{ contextId:f.contextId }).value;
  return { id:randomUUID(),incidentId,basisRevision:context.revision,policy:context.policy,changes,executions:[],evidence };
}

test('proposal has no graph effects before commit, then commits once with an identical durable receipt',t=>{
  const f=setup(t),incidentId=randomUUID();f.write('incident.create',{ id:incidentId,incident });
  const record=atom(schema(f)),draft=proposal(f,[{ kind:'record.put',record }],incidentId);
  assert.equal(f.write('transition.propose',{ proposal:draft }).ok,true);
  assert.equal(f.store.read(f.contextId).records.length,0);
  const input={ contextId:f.contextId,expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:'commit-draft',proposalId:draft.id };
  const committed=f.call('transition.commit',input);assert.equal(committed.ok,true);
  assert.equal(f.store.read(f.contextId).records.length,1);
  const stored=f.call('transition.get',{ contextId:f.contextId,proposalId:draft.id });
  assert.equal(stored.value.state,'committed');assert.deepEqual(stored.value.commit,committed.value);
  f.reopen();assert.deepEqual(f.call('transition.commit',input),committed);
  assert.equal(f.store.read(f.contextId).records.length,1);
  assert.equal(f.store.outbox(f.contextId).length,0);
});

test('an intervening context change requires a fresh proposal and cannot silently rebase a stale delta',t=>{
  const f=setup(t),incidentId=randomUUID();f.write('incident.create',{ id:incidentId,incident });
  const s=schema(f),record=atom(s),draft=proposal(f,[{ kind:'record.put',record }],incidentId);
  f.write('transition.propose',{ proposal:draft });
  const other=atom(s);f.write('graph.transact',{ changes:[{ kind:'record.put',record:other }] });
  assert.equal(f.write('transition.commit',{ proposalId:draft.id }).error.code,'REVISION_CONFLICT');
  assert.deepEqual(f.store.read(f.contextId).records.map(item=>item.ref.id),[other.id]);
  const fresh=proposal(f,draft.changes,incidentId);f.write('transition.propose',{ proposal:fresh });
  assert.equal(f.write('transition.commit',{ proposalId:fresh.id }).ok,true);
});

test('proposal validation catches conflicts before recording a success-shaped candidate',t=>{
  const f=setup(t),incidentId=randomUUID();f.write('incident.create',{ id:incidentId,incident });
  const record=atom(schema(f));f.write('graph.transact',{ changes:[{ kind:'record.put',record }] });
  const draft=proposal(f,[{ kind:'record.put',record:{ ...record,value:'conflict' } }],incidentId);
  const revision=f.store.read(f.contextId).context.revision;
  assert.equal(f.write('transition.propose',{ proposal:draft }).error.code,'IDENTITY_CONFLICT');
  assert.equal(f.store.read(f.contextId).context.revision,revision);
  assert.equal(f.call('transition.get',{ contextId:f.contextId,proposalId:draft.id }).error.code,'NOT_FOUND');
});

test('revocation after proposal refuses commit without admitting the proposed effects',t=>{
  const f=setup(t);allowDelegated(f);const actor=randomUUID(),incidentId=randomUUID();f.write('incident.create',{ id:incidentId,incident });
  const record=atom(schema(f));
  const bound=grant(f,actor,{ actions:['transition.propose','transition.commit','graph.transact'],incidentIds:[incidentId],resourceRefs:[{ systemId:f.systemId,contextId:f.contextId,id:record.id }] });
  const draft=proposal(f,[{ kind:'record.put',record }],incidentId);
  assert.equal(delegated(f,actor,bound,'transition.propose',{ proposal:draft },true).ok,true);
  assert.equal(f.write('grant.revoke',{ grant:bound.ref,reason:'Authority withdrawn before review' }).ok,true);
  const revision=f.store.read(f.contextId).context.revision;
  assert.equal(delegated(f,actor,bound,'transition.commit',{ proposalId:draft.id },true).error.code,'FORBIDDEN');
  assert.equal(f.store.read(f.contextId).context.revision,revision);
  assert.equal(f.store.read(f.contextId).records.length,0);
});

test('installed relationship schemas cannot disguise a relation as an atom',t=>{
  const f=setup(t),s=schema(f),nodes=[atom(s),atom(s),atom(s)];
  f.write('graph.transact',{ changes:nodes.map(record=>({ kind:'record.put',record })) });
  const ref=id=>({ systemId:f.systemId,contextId:f.contextId,id });
  const disguised={ kind:'atom',id:randomUUID(),schema:builtinSchemas.find(item=>item.schema.name==='moment.within').schema,value:{ child:[ref(nodes[0].id)],parent:[ref(nodes[1].id)],perspective:[ref(nodes[2].id)] } };
  const revision=f.store.read(f.contextId).context.revision;
  assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record:disguised }] }).error.code,'INVALID_ARGUMENT');
  assert.equal(f.store.read(f.contextId).context.revision,revision);
});

test('asserted containment is acyclic per perspective while connectivity and alternate perspectives remain independent',t=>{
  const f=setup(t),s=schema(f),nodes=[atom(s),atom(s),atom(s),atom(s)];
  f.write('graph.transact',{ changes:nodes.map(record=>({ kind:'record.put',record })) });
  const ref=id=>({ systemId:f.systemId,contextId:f.contextId,id });
  const within=builtinSchemas.find(item=>item.schema.name==='moment.within').schema;
  const relation=(child,parent,perspective)=>({ kind:'relation',id:randomUUID(),schema:within,roles:{ child:[ref(child)],parent:[ref(parent)],perspective:[ref(perspective)] } });
  const asserted=record=>[{ kind:'assertion.put',assertion:{ id:randomUUID(),record:ref(record.id),evidence } },{ kind:'record.put',record }];
  const [a,b,p,q]=nodes.map(node=>node.id),first=relation(a,b,p);
  assert.equal(f.write('graph.transact',{ changes:asserted(first) }).ok,true);
  const reverse=relation(b,a,p),revision=f.store.read(f.contextId).context.revision;
  assert.equal(f.write('graph.transact',{ changes:asserted(reverse) }).error.code,'INVALID_ARGUMENT');
  assert.equal(f.store.read(f.contextId).context.revision,revision);
  assert.equal(f.write('graph.transact',{ changes:asserted(relation(b,a,q)) }).ok,true);
  const extra=atom(s);f.write('graph.transact',{ changes:[{ kind:'record.put',record:extra }] });
  assert.equal(f.write('graph.transact',{ changes:asserted(relation(a,extra.id,p)) }).error.code,'INVALID_ARGUMENT');
  // A conflicting hypothesis can remain an immutable unasserted record.
  assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record:reverse }] }).ok,true);
});

test('a structural replacement withdraws old support and installs the new placement atomically',t=>{
  const f=setup(t),s=schema(f),nodes=[atom(s),atom(s),atom(s),atom(s)];
  f.write('graph.transact',{ changes:nodes.map(record=>({ kind:'record.put',record })) });
  const ref=id=>({ systemId:f.systemId,contextId:f.contextId,id });
  const relation=parent=>({ kind:'relation',id:randomUUID(),schema:builtinSchemas.find(item=>item.schema.name==='moment.within').schema,roles:{ child:[ref(nodes[0].id)],parent:[ref(parent)],perspective:[ref(nodes[3].id)] } });
  const before=relation(nodes[1].id),after=relation(nodes[2].id),id=randomUUID();
  f.write('graph.transact',{ changes:[{ kind:'record.put',record:before },{ kind:'assertion.put',assertion:{ id,record:ref(before.id),evidence } }] });
  assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record:after },{ kind:'assertion.put',assertion:{ id:randomUUID(),record:ref(after.id),evidence } },{ kind:'assertion.withdraw',assertionId:id,reason:'new accepted placement' }] }).ok,true);
});

test('withdrawing one independent support cannot remove a still-supported structural constraint',t=>{
  const f=setup(t),s=schema(f),nodes=[atom(s),atom(s),atom(s)];
  const ref=id=>({systemId:f.systemId,contextId:f.contextId,id});
  const relation=(a,b)=>({kind:'relation',id:randomUUID(),schema:builtinSchemas.find(x=>x.schema.name==='moment.within').schema,roles:{child:[ref(a)],parent:[ref(b)],perspective:[ref(nodes[2].id)]}});
  const first=relation(nodes[0].id,nodes[1].id),reverse=relation(nodes[1].id,nodes[0].id);
  const supports=[0,1].map(()=>({id:randomUUID(),record:ref(first.id),evidence}));
  assert.equal(f.write('graph.transact',{changes:[...nodes,first,reverse].map(record=>({kind:'record.put',record})).concat(supports.map(assertion=>({kind:'assertion.put',assertion})))}).ok,true);
  assert.equal(f.write('graph.transact',{changes:[{kind:'assertion.withdraw',assertionId:supports[0].id,reason:'first observation withdrawn'}]}).ok,true);
  const reverseSupport={id:randomUUID(),record:ref(reverse.id),evidence},revision=f.store.read(f.contextId).context.revision;
  assert.equal(f.write('graph.transact',{changes:[{kind:'assertion.put',assertion:reverseSupport}]}).error.code,'INVALID_ARGUMENT');
  assert.equal(f.store.read(f.contextId).context.revision,revision);
  assert.equal(f.write('graph.transact',{changes:[{kind:'assertion.withdraw',assertionId:supports[1].id,reason:'last observation withdrawn'},{kind:'assertion.put',assertion:reverseSupport}]}).ok,true);
  f.reopen();const snapshot=f.store.read(f.contextId);
  assert.equal(snapshot.assertions.filter(x=>x.status==='withdrawn').length,2);assert.equal(snapshot.assertions.filter(x=>x.status==='asserted').length,1);
});

test('a delegate cannot admit a cycle through an edge outside its visible graph',t=>{
  const f=setup(t);allowDelegated(f);const s=schema(f),nodes=[atom(s),atom(s),atom(s)];
  const ref=id=>({systemId:f.systemId,contextId:f.contextId,id});
  const relation=(a,b)=>({kind:'relation',id:randomUUID(),schema:builtinSchemas.find(x=>x.schema.name==='moment.within').schema,roles:{child:[ref(a)],parent:[ref(b)],perspective:[ref(nodes[2].id)]}});
  const hidden=relation(nodes[0].id,nodes[1].id),visible=relation(nodes[1].id,nodes[0].id);
  assert.equal(f.write('graph.transact',{changes:[...nodes,hidden,visible].map(record=>({kind:'record.put',record})).concat([{kind:'assertion.put',assertion:{id:randomUUID(),record:ref(hidden.id),evidence}}])}).ok,true);
  const actor=randomUUID(),bound=grant(f,actor,{resourceRefs:[...nodes,visible].map(record=>ref(record.id))});
  const view=delegated(f,actor,bound,'graph.query',{selector:{assertionStatus:'any'},limit:10});
  assert.equal(view.ok,true);assert.equal(view.value.items.some(x=>x.record.value.id===hidden.id),false);
  const revision=f.store.read(f.contextId).context.revision;
  const result=delegated(f,actor,bound,'graph.transact',{changes:[{kind:'assertion.put',assertion:{id:randomUUID(),record:ref(visible.id),evidence}}]},true);
  assert.equal(result.error.code,'INVALID_ARGUMENT');assert.match(result.error.message,/cycle/);
  assert.equal(f.store.read(f.contextId).context.revision,revision);
  f.reopen();assert.equal(f.store.read(f.contextId).assertions.length,1);
});

test('a view exposes selected fields and hides internal changes until its declared observable changes',t=>{
  const f=setup(t),s=schema(f,{ type:'object',properties:{ summary:{ type:'string' },private:{ type:'string' } },required:['summary','private'],additionalProperties:false });
  const record={ ...atom(s),value:{ summary:'Visible',private:'Hidden detail' } };f.write('graph.transact',{ changes:[{ kind:'record.put',record }] });
  const view={ id:randomUUID(),selector:{ ids:[record.id],assertionStatus:'any' },fields:['/value/value/summary'] };
  const published=f.write('view.publish',{ view });assert.equal(published.ok,true);
  const input={ contextId:f.contextId,view:published.value.ref,limit:10 };
  const first=f.call('view.read',input).value;
  assert.deepEqual(first.records[0].fields,{ '/value/value/summary':'Visible' });assert.deepEqual(first.support,[]);
  assert.equal(JSON.stringify(first).includes('Hidden detail'),false);
  f.write('graph.transact',{ changes:[{ kind:'record.put',record:{ ...atom(s),value:{ summary:'Internal',private:'Other hidden detail' } } }] });
  const second=f.call('view.read',input).value;assert.deepEqual(second.records,first.records);assert.equal(second.version,first.version);
  assert.equal(f.write('view.publish',{ view:{ ...view,id:randomUUID(),groupBy:'schema' } }).error.code,'INVALID_ARGUMENT');
});

test('reaction evaluation binds trusted event and context values without executing the destination',t=>{
  const f=setup(t),incidentId=randomUUID();f.write('incident.create',{ id:incidentId,incident });
  const observed=f.write('graph.transact',{ changes:[] }).value;
  const rule={ id:randomUUID(),triggerEventTypes:['graph.transact.committed'],condition:truth,operation:'incident.update',literalInput:{ contextId:f.contextId,expectedRevision:0,idempotencyKey:'placeholder',incidentId,incident:{ ...incident,status:'resting' },evidence },inputBindings:{ '/expectedRevision':'contextRevision','/idempotencyKey':'event.id' },limits };
  const stored=f.write('rule.publish',{ rule });assert.equal(stored.ok,true);
  const result=f.call('reaction.evaluate',{ contextId:f.contextId,rule:stored.value.ref,eventIds:observed.eventIds,incidentId });
  assert.equal(result.ok,true);assert.equal(result.value.eligible,true);
  assert.equal(result.value.candidateInput.idempotencyKey,observed.eventIds[0]);
  assert.equal(f.call('incident.get',{ contextId:f.contextId,incidentId }).value.value.status,'open');
  assert.equal(f.call('incident.update',result.value.candidateInput).ok,true);
  assert.equal(f.call('incident.get',{ contextId:f.contextId,incidentId }).value.value.status,'resting');
});

test('binding rejects overlapping, missing and inherited locations without prototype mutation',()=>{
  assert.throws(()=>bindInput({ a:{ b:1 } },{ '/a':'x','/a/b':'y' },{ x:{ b:2 },y:3 }),{ code:'INVALID_ARGUMENT' });
  assert.throws(()=>bindInput({}, { '/constructor':'x' },{ x:'bad' }),{ code:'INVALID_ARGUMENT' });
  assert.throws(()=>bindInput({ a:1 }, { '/a':'missing' },{}),{ code:'INVALID_ARGUMENT' });
  assert.deepEqual(bindInput({ 'a/b':1 },{ '/a~1b':'x' },{ x:2 }),{ 'a/b':2 });
});

test('a delegate sees only the granted projected records and cannot recover raw data through a view cursor',t=>{
  const f=setup(t);allowDelegated(f);const s=schema(f,{ type:'object',additionalProperties:true });
  const records=[{ ...atom(s),value:{ summary:'Shared',private:'Not projected' } },{ ...atom(s),value:{ summary:'Unrelated',private:'Never visible' } }];
  f.write('graph.transact',{ changes:records.map(record=>({ kind:'record.put',record })) });
  const view={ id:randomUUID(),selector:{ assertionStatus:'any' },fields:['/value/value/summary'] };
  const stored=f.write('view.publish',{ view }).value,actor=randomUUID();
  const bound=grant(f,actor,{ actions:['view.read'],resourceRefs:[stored.ref,{ systemId:f.systemId,contextId:f.contextId,id:records[0].id }] });
  const result=delegated(f,actor,bound,'view.read',{ view:stored.ref,limit:1 });
  assert.equal(result.ok,true);assert.equal(result.value.records.length,1);assert.equal(result.value.complete,true);
  assert.equal(result.value.nextCursor,undefined);assert.equal(JSON.stringify(result).includes('Never visible'),false);assert.equal(JSON.stringify(result).includes('Not projected'),false);
  assert.equal(result.value.revision,undefined);
  assert.equal(delegated(f,actor,bound,'graph.query',{ selector:{ assertionStatus:'any' },limit:1 }).error.code,'FORBIDDEN');
});

test('projection versions remain stable through hidden steps and change only when selected content changes',t=>{
  const f=setup(t),s=schema(f),first=atom(s),ref=id=>({ systemId:f.systemId,contextId:f.contextId,id });
  const assertion={ id:randomUUID(),record:ref(first.id),evidence };
  f.write('graph.transact',{ changes:[{ kind:'record.put',record:first },{ kind:'assertion.put',assertion }] });
  const view=f.write('view.publish',{ view:{ id:randomUUID(),selector:{ schemaNames:[s.name],assertionStatus:'asserted' },fields:['/value/value'] } }).value;
  const read=()=>f.call('view.read',{ contextId:f.contextId,view:view.ref,limit:10 }).value;
  const before=read();f.write('graph.transact',{ changes:[{ kind:'record.put',record:atom(s) }] });assert.deepEqual(read(),before);
  const next={ ...atom(s),value:'New selected result' };
  f.write('graph.transact',{ changes:[{ kind:'record.put',record:next },{ kind:'assertion.withdraw',assertionId:assertion.id,reason:'replacement' },{ kind:'assertion.put',assertion:{ ...assertion,id:randomUUID(),record:ref(next.id) } }] });
  const after=read();assert.notEqual(after.version,before.version);assert.equal(after.records[0].fields['/value/value'],'New selected result');
});

test('encrypted fixed-size cursors conceal revision metadata and reject tampering or cross-view reuse',async t=>{
  const { sealCursor,openCursor }=await import('../runtime/cursors.mjs');
  const key='temporary-test-key';const a=sealCursor({ revision:1 },key),b=sealCursor({ revision:1000000 },key);
  assert.equal(a.length,b.length);assert.notEqual(a,b);assert.deepEqual(openCursor(a,key),{ revision:1 });
  assert.throws(()=>openCursor(a,'different-key'),{ code:'INVALID_ARGUMENT' });
  const f=setup(t),s=schema(f);f.write('graph.transact',{ changes:[{ kind:'record.put',record:atom(s) },{ kind:'record.put',record:atom(s) }] });
  const view={ id:randomUUID(),selector:{ assertionStatus:'any' },fields:['/value/value'] };
  const one=f.write('view.publish',{ view }).value,two=f.write('view.publish',{ view:{ ...view,id:randomUUID() } }).value;
  const cursor=f.call('view.read',{ contextId:f.contextId,view:one.ref,limit:1 }).value.nextCursor;assert.ok(cursor);
  assert.equal(f.call('view.read',{ contextId:f.contextId,view:two.ref,limit:1,cursor }).error.code,'INVALID_ARGUMENT');
  assert.equal(f.call('graph.query',{ contextId:f.contextId,selector:view.selector,limit:1,cursor }).error.code,'INVALID_ARGUMENT');
});

test('a proposer can observe a different reviewer committing its proposal without crossing a same-principal delegation branch',t=>{
  const f=setup(t);allowDelegated(f);const actor=randomUUID(),incidentId=randomUUID();f.write('incident.create',{ id:incidentId,incident });
  const record=atom(schema(f)),resources=[{ systemId:f.systemId,contextId:f.contextId,id:record.id }];
  const a=grant(f,actor,{ actions:['transition.propose','transition.get','graph.transact'],incidentIds:[incidentId],resourceRefs:resources });
  const b=grant(f,actor,{ actions:a.value.actions,incidentIds:[incidentId],resourceRefs:resources });
  const draft=proposal(f,[{ kind:'record.put',record }],incidentId);
  const submitted=delegated(f,actor,a,'transition.propose',{ proposal:draft },true);assert.equal(submitted.ok,true);
  assert.equal(delegated(f,actor,b,'transition.get',{ proposalId:draft.id }).error.code,'NOT_FOUND');
  assert.equal(f.write('transition.commit',{ proposalId:draft.id }).ok,true);
  assert.equal(delegated(f,actor,a,'transition.get',{ proposalId:draft.id }).value.state,'committed');
});

test('time ordering is acyclic within a frame and does not impose structural nesting',t=>{
  const f=setup(t),s=schema(f),nodes=[atom(s),atom(s),atom(s)];f.write('graph.transact',{ changes:nodes.map(record=>({ kind:'record.put',record })) });
  const ref=id=>({ systemId:f.systemId,contextId:f.contextId,id }),order=builtinSchemas.find(item=>item.schema.name==='moment.precedes').schema;
  const edge=(a,b,frame)=>({ kind:'relation',id:randomUUID(),schema:order,roles:{ earlier:[ref(a)],later:[ref(b)],...(frame?{ frame:[ref(frame)] }:{}) } });
  const asserted=record=>[{ kind:'record.put',record },{ kind:'assertion.put',assertion:{ id:randomUUID(),record:ref(record.id),evidence } }];
  const [a,b,frame]=nodes.map(item=>item.id);
  assert.equal(f.write('graph.transact',{ changes:asserted(edge(a,b)) }).ok,true);
  assert.equal(f.write('graph.transact',{ changes:asserted(edge(b,a)) }).error.code,'INVALID_ARGUMENT');
  assert.equal(f.write('graph.transact',{ changes:asserted(edge(b,a,frame)) }).ok,true);
});
