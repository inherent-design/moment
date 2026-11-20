import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {SessionMemory} from '../runtime/session-memory.mjs';

function fixture(t,options={}) {
  const directory=mkdtempSync(join(tmpdir(),'moment-enroll-')),filename=join(directory,'memory.sqlite'),systemId=randomUUID(),actor=randomUUID();
  const memory=new SessionMemory(filename,systemId,options),session={runtimeId:'owned-test',sessionId:randomUUID()};
  t.after(()=>{try{memory.close();}catch{}rmSync(directory,{recursive:true,force:true});});
  const configure=(enabled,expectedRevision=memory.subscription(session).revision,key=randomUUID())=>memory.configure({session,enabled,expectedRevision,idempotencyKey:key},actor);
  const automatic=(text='Actual future input',subscriptionRevision=memory.subscription(session).revision)=>({session,deliveryId:randomUUID(),message:{text,authorship:'unknown'},automatic:{subscriptionRevision}});
  return {memory,filename,systemId,actor,session,configure,automatic};
}

test('enrollment is explicit, does not infer history or invoke a model, and survives reopen',t=>{
  const f=fixture(t),empty=f.memory.read({session:f.session});
  assert.deepEqual(empty.subscription,{session:f.session,revision:0,enabled:false});
  assert.equal(empty.automation.state,'off');assert.equal(empty.exists,false);
  const on=f.configure(true);assert.equal(on.subscription.enabled,true);assert.equal(on.subscription.revision,1);
  assert.equal(on.subscription.changedBy,f.actor);assert.equal(f.memory.hasPending(),false);
  const packet=f.memory.read({session:f.session});assert.equal(packet.observedThrough,0);assert.equal(packet.automation.state,'awaiting-input');
  const second=new SessionMemory(f.filename,f.systemId);
  try{assert.deepEqual(second.subscription(f.session),on.subscription);}finally{second.close();}
  assert.equal(f.memory.subscription({...f.session,sessionId:randomUUID()}).enabled,false);
});

test('automatic intake rechecks enrollment while exact delivery replay preserves the admitted outcome',t=>{
  const f=fixture(t);
  assert.throws(()=>f.memory.observe({...f.automatic(),automatic:{subscriptionRevision:1}}),{code:'FORBIDDEN'});
  assert.equal(f.memory.read({session:f.session}).exists,false);
  f.configure(true);
  const input=f.automatic(),admitted=f.memory.observe(input);
  assert.equal(admitted.sequence,1);
  let packet=f.memory.read({session:f.session});assert.equal(packet.automation.state,'input-observed');
  assert.equal(packet.subscription.revision,1);assert.equal(packet.cacheRevision,0);
  const off=f.configure(false);assert.deepEqual(off.cancelledSequences,[1]);
  assert.equal(off.subscription.revision,2);assert.equal(f.memory.hasPending(),false);
  assert.equal(f.memory.observe(input).replayed,true);
  assert.equal(f.memory.observe(input).status,'cancelled');
  assert.throws(()=>f.memory.observe(f.automatic()),{code:'FORBIDDEN'});
  f.configure(true);
  assert.throws(()=>f.memory.observe(f.automatic('Old hint',1)),{code:'REVISION_CONFLICT'});
  packet=f.memory.read({session:f.session});assert.equal(packet.observedThrough,1);assert.equal(packet.gaps[0].error.code,'MEMORY_DISABLED');
  assert.equal(packet.automation.state,'awaiting-input');
});

test('configuration retries cannot resurrect a later opt-out and observations do not consume configuration revisions',t=>{
  const f=fixture(t),key=randomUUID(),request={session:f.session,enabled:true,expectedRevision:0,idempotencyKey:key};
  const first=f.memory.configure(request,f.actor);
  f.memory.observe(f.automatic());
  assert.equal(f.memory.subscription(f.session).revision,1);
  f.configure(false,1);
  const replay=f.memory.configure(request,f.actor);
  assert.equal(replay.replayed,true);assert.deepEqual(replay.subscription,first.subscription);
  assert.equal(f.memory.subscription(f.session).enabled,false);
  assert.throws(()=>f.memory.configure({...request,enabled:false},f.actor),{code:'IDEMPOTENCY_CONFLICT'});
  assert.throws(()=>f.configure(true,1),{code:'REVISION_CONFLICT'});
  const noChange=f.configure(false,2);assert.equal(noChange.subscription.revision,2);
});

test('disable preserves manual work and unknown dispatch custody while cancelling only undispatched automatic work',t=>{
  const f=fixture(t);f.configure(true);
  const first=f.memory.observe(f.automatic('May already be dispatched'));
  const dispatch=f.memory.claim({id:'owned-fixture',model:'scripted'});
  assert.equal(dispatch.sequence,first.sequence);
  f.memory.unknown(dispatch.id,'Owned test has no attributable result yet');
  const queued=f.memory.observe(f.automatic('Not dispatched'));
  const manual=f.memory.observe({session:f.session,deliveryId:randomUUID(),message:{text:'Explicit owner-local reconstruction or intake remains separate',authorship:'unknown'}});
  const off=f.configure(false);
  assert.deepEqual(off.cancelledSequences,[queued.sequence]);
  assert.deepEqual(off.inFlight,{sequence:first.sequence,status:'unknown'});
  let packet=f.memory.read({session:f.session});assert.equal(packet.pending[0].status,'unknown');
  assert.ok(packet.pending.some(x=>x.sequence===manual.sequence));
  f.memory.reconcile(dispatch.id,{kind:'cancelled',evidence:'Owned provider request ended without a result'});
  const next=f.memory.claim({id:'owned-fixture',model:'scripted'});
  assert.equal(next.sequence,manual.sequence);
  packet=f.memory.read({session:f.session});assert.equal(packet.automation.state,'off');
});

test('configuration receipt limits refuse new mutations but retain exact replay and existing enrollment',t=>{
  const f=fixture(t,{maxConfigurationReceipts:1}),key=randomUUID();
  f.configure(true,0,key);
  assert.throws(()=>f.configure(false),{code:'LIMIT_EXCEEDED'});
  assert.equal(f.memory.subscription(f.session).enabled,true);
  assert.equal(f.configure(true,0,key).replayed,true);
});

test('two actual processes racing one subscription revision admit exactly one change',async t=>{
  const f=fixture(t);
  const source=`import {SessionMemory} from ${JSON.stringify(new URL('../runtime/session-memory.mjs',import.meta.url).href)};
    const m=new SessionMemory(process.argv[1],process.argv[2]);try{console.log(JSON.stringify({ok:true,value:m.configure(JSON.parse(process.argv[3]),process.argv[4])}));}
    catch(e){console.log(JSON.stringify({ok:false,code:e.code}));}finally{m.close();}`;
  const run=enabled=>new Promise((resolve,reject)=>{
    const input={session:f.session,enabled,expectedRevision:0,idempotencyKey:randomUUID()};
    const child=spawn(process.execPath,['--input-type=module','-e',source,f.filename,f.systemId,JSON.stringify(input),f.actor]);let out='',err='';
    child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(out)):reject(Error(err)));
  });
  const result=await Promise.all([run(true),run(false)]);
  assert.equal(result.filter(x=>x.ok).length,1);assert.equal(result.find(x=>!x.ok).code,'REVISION_CONFLICT');
  assert.equal(f.memory.subscription(f.session).revision,1);
});
