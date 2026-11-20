import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {NativeLabor} from '../runtime/native-labor.mjs';
import {SessionMemory} from '../runtime/session-memory.mjs';
import {MemoryWorker} from '../runtime/memory-worker.mjs';
import {CodexMemoryProvider} from '../runtime/codex-memory.mjs';
const pause=()=>new Promise(setImmediate);
test('shared native preparation is FIFO, unknown dispatch remains durable, and wrong settlement cannot release another consumer',async t=>{
 const root=mkdtempSync(join(tmpdir(),'moment-labor-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 let slot=new NativeLabor(root),entered=[];await slot.acquire('memory');entered.push('memory');const waiting=slot.acquire('guidance').then(()=>entered.push('guidance'));await pause();assert.deepEqual(entered,['memory']);
 const d={id:randomUUID(),inputDigest:'sha256:'+'a'.repeat(64)};slot.retain('memory',d);assert.throws(()=>slot.release('guidance',d.id),/another dispatch/);slot.close();await assert.rejects(waiting,/closed/);
 slot=new NativeLabor(root);assert.deepEqual(slot.holder,{component:'memory',dispatchId:d.id,inputDigest:d.inputDigest});let advanced=false;const second=slot.acquire('guidance').then(()=>advanced=true);await pause();assert.equal(advanced,false);
 slot.release('memory',d.id);await second;assert.equal(advanced,true);slot.release('guidance');slot.close();
});
test('restart after memory commit but before native settlement recovers the shared slot from exact retained receipt',async t=>{
 const root=mkdtempSync(join(tmpdir(),'moment-labor-memory-'));mkdirSync(join(root,'runtime'));const memory=new SessionMemory(join(root,'runtime/memory.sqlite'),randomUUID());
 const binary=join(root,'codex.mjs');writeFileSync(binary,'#!'+process.execPath+'\n'+readFileSync(new URL('./codex-memory-fixture.mjs',import.meta.url)),{mode:0o700});const credentialFile=join(root,'access.json'),claims=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');writeFileSync(credentialFile,JSON.stringify({tokens:{access_token:'fixture.'+claims+'.signature',account_id:'normal'}}),{mode:0o600});
 const session={runtimeId:'owned',sessionId:randomUUID()},engine=new CodexMemoryProvider(root,{binary,credentialFile}),first=new NativeLabor(root),provider=first.provider('memory',engine);
 memory.observe({session,deliveryId:randomUUID(),message:{text:'Preserve this exact wording.',authorship:'human'}});
 const dispatch=memory.claim(await provider.ready()),report=await provider.invoke(dispatch,new AbortController().signal);memory.finish(dispatch.id,report.output,report.usage);
 assert.equal(memory.active(),undefined);assert.equal(first.holder.dispatchId,dispatch.id);await engine.close();first.close();
 const nextEngine=new CodexMemoryProvider(root,{binary,credentialFile}),next=new NativeLabor(root),worker=new MemoryWorker(memory,{provider:next.provider('memory',nextEngine),recover:true});
 t.after(async()=>{next.close();await worker.close();memory.close();rmSync(root,{recursive:true,force:true});});worker.wake();await pause();await worker.running;
 assert.equal(worker.status().state,'ready');assert.equal(next.holder,undefined);assert.equal(memory.read({session}).processedThrough,1);
});
