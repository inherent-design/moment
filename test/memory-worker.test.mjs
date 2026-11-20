import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SessionMemory} from '../runtime/session-memory.mjs';
import {MemoryWorker} from '../runtime/memory-worker.mjs';

function gate(){let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};}
function fixture(t,provider,release=()=>{}){
  const root=mkdtempSync(join(tmpdir(),'mmw-')),memory=new SessionMemory(join(root,'memory.sqlite'),randomUUID()),worker=new MemoryWorker(memory,{provider}),session={runtimeId:'worker-fixture',sessionId:randomUUID()};
  t.after(async()=>{release();await worker.close();memory.close();rmSync(root,{recursive:true,force:true});});
  return {memory,worker,session,observe:text=>memory.observe({session,deliveryId:randomUUID(),message:{text,authorship:'unknown'}})};
}

test('queued and preparing work cannot report that no eligible input exists',async t=>{
  const began=gate(),held=gate(),f=fixture(t,{async ready(){began.release();await held.promise;return {id:'held-ready',model:'scripted'};},async invoke(){return {output:{kind:'unchanged',explanation:'Scripted fixture assessment.'}};}},held.release);
  f.worker.wake();await new Promise(setImmediate);await f.worker.running;
  assert.equal(f.worker.status().reason,'No eligible input is pending');
  f.observe('An eligible submitted input.');f.worker.wake();
  assert.notEqual(f.worker.status().reason,'No eligible input is pending');
  await began.promise;
  const packet=f.memory.read({session:f.session},f.worker.status());assert.equal(packet.pending.length,1);assert.notEqual(packet.worker.reason,'No eligible input is pending');
  held.release();await f.worker.running;
});

test('a previously queued wake does not automatically retry failed provider preparation',async t=>{
  const began=gate(),held=gate();let attempts=0;
  const f=fixture(t,{async ready(){attempts++;began.release();await held.promise;throw Error('Owned unavailable provider');},async invoke(){throw Error('Inference must not start');}},held.release);
  f.observe('First input.');f.worker.wake();await began.promise;f.observe('Second input.');f.worker.wake();held.release();
  await f.worker.running;await new Promise(setImmediate);await f.worker.running;
  assert.equal(attempts,1);assert.equal(f.worker.status().state,'unavailable');assert.equal(f.memory.read({session:f.session}).pending.length,2);
});

test('input arriving while idle cleanup is held is reported and dispatched after cleanup',async t=>{
  const idleBegan=gate(),held=gate();let idles=0;
  const f=fixture(t,{async ready(){return {id:'idle-cleanup-fixture',model:'scripted'};},async idle(){if(++idles===1){idleBegan.release();await held.promise;}},async invoke(){return {output:{kind:'unchanged',explanation:'Scripted fixture assessment.'}};}},held.release);
  f.worker.wake();await idleBegan.promise;f.observe('Input arriving during idle cleanup.');f.worker.wake();assert.notEqual(f.worker.status().reason,'No eligible input is pending');
  held.release();await f.worker.running;await new Promise(setImmediate);await f.worker.running;
  assert.equal(f.memory.read({session:f.session}).processedThrough,1);
});

test('reconciliation while old provider settlement is held retains the wake for later queued input',async t=>{
  const began=gate(),held=gate();let calls=0;
  const f=fixture(t,{async ready(){return {id:'held-settlement',model:'scripted'};},async invoke(dispatch){calls++;if(calls===1){began.release();await held.promise;throw Error('Owned cancelled fixture settling after reconciliation');}return {output:{kind:'replace',explanation:'Scripted fixture assessment.',entries:[{sourceId:dispatch.request.incomingSourceIds[0],weight:0.8}]}};}},held.release);
  f.observe('First input.');f.observe('Second input.');f.worker.wake();await began.promise;
  const cancelled=f.worker.cancel(f.session,1);assert.equal(cancelled.status,'unknown');
  const active=f.memory.active();f.worker.reconcile(active.id,{kind:'cancelled',evidence:'The owned scripted fixture confirms cancellation; its asynchronous settlement is deliberately held.'});
  held.release();await f.worker.running;await new Promise(setImmediate);await f.worker.running;
  const packet=f.memory.read({session:f.session});assert.equal(packet.processedThrough,2);assert.equal(calls,2);assert.equal(packet.gaps[0].status,'cancelled');assert.equal(packet.sources.find(source=>source.text==='Second input.').text,'Second input.');
});
