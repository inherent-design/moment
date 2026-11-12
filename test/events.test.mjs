import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup,schema,atom,allowDelegated,grant,delegated } from './helpers.mjs';

const read=(f,extra={})=>f.call('events.read',{ contextId:f.contextId,limit:100,waitMillis:0,...extra });

test('event cursors resume after restart and new writes, with exact scoped historical pagination',t=>{
  const f=setup(t),s=schema(f),initial=read(f).value;assert.ok(initial.nextCursor);
  const record=atom(s),written=f.write('graph.transact',{ changes:[{ kind:'record.put',record }] }).value;
  f.reopen();const next=read(f,{ after:initial.nextCursor }).value;assert.deepEqual(next.items.map(item=>item.id),written.eventIds);
  assert.equal(next.items[0].subjectRefs[0].id,record.id);assert.equal(next.items[0].visibilityRefs,undefined);
  assert.equal(read(f,{ after:next.nextCursor }).value.items.length,0);
  const page=read(f,{ limit:1 }).value,following=read(f,{ limit:1,after:page.nextCursor }).value;assert.notEqual(page.items[0].id,following.items[0].id);
  assert.equal(f.call('graph.query',{ contextId:f.contextId,selector:{ assertionStatus:'any' },limit:1,cursor:page.nextCursor }).error.code,'INVALID_ARGUMENT');
  const old=read(f,{ atRevision:1 }).value;assert.equal(old.items.length,1);
  assert.equal(read(f,{ after:old.nextCursor }).error.code,'INVALID_ARGUMENT');
  assert.equal(read(f,{ atRevision:1,waitMillis:1 }).error.code,'INVALID_ARGUMENT');
});

test('mixed transactions deliver only authorized notices and never expose private provenance',t=>{
  const f=setup(t);allowDelegated(f);const s=schema(f),visible=atom(s),hidden=atom(s),actor=randomUUID();
  const ref=id=>({ systemId:f.systemId,contextId:f.contextId,id });
  const bound=grant(f,actor,{ actions:['events.read'],resourceRefs:[ref(visible.id)] });
  f.write('graph.transact',{ changes:[{ kind:'record.put',record:visible },{ kind:'record.put',record:hidden },{ kind:'assertion.put',assertion:{ id:randomUUID(),record:ref(visible.id),evidence:{ sources:[ref(hidden.id)],artifactDigests:[],method:'Private support in a mixed transaction' } } }] });
  const first=delegated(f,actor,bound,'events.read',{ limit:100,waitMillis:0 }).value;
  assert.equal(first.items.length,1);assert.deepEqual(first.items[0].subjectRefs,[ref(visible.id)]);assert.equal(JSON.stringify(first).includes(hidden.id),false);assert.equal(JSON.stringify(first).includes('visibilityRefs'),false);assert.equal(JSON.stringify(first).includes('visibilityAlternatives'),false);
  f.write('graph.transact',{ changes:[{ kind:'assertion.put',assertion:{ id:randomUUID(),record:ref(visible.id),evidence:{ sources:[ref(hidden.id)],artifactDigests:[],method:'Private support' } } }] });
  assert.equal(delegated(f,actor,bound,'events.read',{ after:first.nextCursor,limit:100,waitMillis:0 }).value.items.length,0);
  const other=grant(f,actor,{ actions:['events.read'],resourceRefs:[ref(visible.id)] });
  assert.equal(delegated(f,actor,other,'events.read',{ after:first.nextCursor,limit:100,waitMillis:0 }).error.code,'INVALID_ARGUMENT');
  f.write('grant.revoke',{ grant:bound.ref,reason:'Visibility withdrawn' });
  assert.equal(delegated(f,actor,bound,'events.read',{ after:first.nextCursor,limit:100,waitMillis:0 }).error.code,'FORBIDDEN');
});

test('a long poll subscribes before checking, wakes on a durable event and releases listeners',async t=>{
  const f=setup(t),s=schema(f),after=read(f).value.nextCursor;
  const wait=f.kernel.events.wait({ contextId:f.contextId,after,limit:100,waitMillis:1000 },f.ownerId);
  assert.equal(f.store.notifications.listenerCount('commit'),1);
  const written=f.write('graph.transact',{ changes:[{ kind:'record.put',record:atom(s) }] }).value;
  const result=await wait;assert.equal(result.ok,true);assert.deepEqual(result.value.items.map(item=>item.id),written.eventIds);
  assert.equal(f.store.notifications.listenerCount('commit'),0);
});

test('long polls recheck revocation and stop on cancellation without retaining listeners',async t=>{
  const f=setup(t);allowDelegated(f);const actor=randomUUID(),bound=grant(f,actor,{ actions:['events.read'],resourceRefs:[] });
  const first=delegated(f,actor,bound,'events.read',{ limit:100,waitMillis:0 }).value;
  const waiting=f.kernel.events.wait({ contextId:f.contextId,after:first.nextCursor,limit:100,waitMillis:1000 },actor,bound.ref);
  f.write('grant.revoke',{ grant:bound.ref,reason:'Recheck current authority' });assert.equal((await waiting).error.code,'FORBIDDEN');
  const controller=new AbortController(),after=read(f).value.nextCursor;
  const cancelled=f.kernel.events.wait({ contextId:f.contextId,after,limit:100,waitMillis:1000 },f.ownerId,undefined,controller.signal);controller.abort();
  await assert.rejects(cancelled,{ code:'OUTCOME_UNKNOWN' });assert.equal(f.store.notifications.listenerCount('commit'),0);
});
