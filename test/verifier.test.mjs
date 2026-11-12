import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,mkdirSync,rmSync,readFileSync,statSync,writeFileSync,renameSync,linkSync,realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BytesVerifier } from '../runtime/providers/bytes-host.mjs';
import { descriptorDigest,recommendedLimits,verifierReservation,workerArguments } from '../runtime/providers/bytes-definition.mjs';
import { spawnSync } from 'node:child_process';
import { bytesDigest,digest } from '../runtime/json.mjs';
import { zeroUsage } from '../runtime/executions.mjs';

function fixture(t,bytes=Buffer.from('Actual verifier fixture bytes\n')) {
  const root=mkdtempSync(join(tmpdir(),'moment-byte-worker-'));mkdirSync(join(root,'runtime'),{ mode:0o700 });
  const providerId=randomUUID(),systemId=randomUUID(),contextId=randomUUID(),ref=id=>({ systemId,contextId,id });
  const host=new BytesVerifier(root,{ providerId });t.after(async()=>{ await host.close();rmSync(root,{ recursive:true,force:true }); });
  const grantId=randomUUID(),intent={ id:randomUUID(),incidentId:randomUUID(),capability:ref(randomUUID()),grant:ref(grantId),input:{ contentBase64:bytes.toString('base64'),expectedDigest:bytesDigest(bytes) },limits:recommendedLimits('USD') };
  const execution={ intent,state:'running',attempt:1,lease:{ id:randomUUID(),holderId:providerId,fencingToken:1,expiresAt:new Date(Date.now()+15000).toISOString() },usage:zeroUsage() };
  const value={ id:grantId,principalId:randomUUID(),actions:['execution.request','local.verify-bytes'],incidentIds:[intent.incidentId],resourceRefs:[intent.capability],delegable:false,limits:intent.limits };
  const grant={ value,ref:intent.grant,digest:digest(value),revision:1,recordedAt:new Date().toISOString(),recordedBy:providerId };
  return { root,host,execution,grant,policy:ref(randomUUID()),bytes };
}

test('fixed worker checks actual bytes with measured CPU/RSS and a private durable receipt',async t=>{
  const f=fixture(t),report=await f.host.execute(f);
  if (report.outcome.kind==='unknown') assert.fail(readFileSync(join(f.host.job(f.execution),'process.log'),'utf8'));
  assert.equal(report.outcome.kind,'succeeded',JSON.stringify(report));assert.equal(report.outcome.output.observedDigest,bytesDigest(f.bytes));assert.equal(report.outcome.output.matches,true);
  assert.ok(report.usage.cpuMillis>0);assert.ok(report.usage.memoryBytes>0);assert.equal(report.usage.modelTokens,0);assert.equal(report.usage.apiSpendMicrounits,0);
  const observed=f.host.lookup(f.execution);assert.equal(observed.kind,'receipt');assert.equal(observed.source.descriptorDigest,descriptorDigest);assert.equal(observed.source.measurement.nodeVersion,process.version);
  assert.equal(observed.source.guards.enforce,true);assert.equal(observed.source.guards.net,false);assert.equal(observed.source.guards.inputWrite,false);assert.equal(observed.source.guards.finalReceiptWrite,false);
  const path=join(observed.path,'receipt.json'),original=readFileSync(path);assert.equal(statSync(path).mode&0o077,0);
  const retried=await f.host.execute(f);assert.deepEqual(retried,report);assert.deepEqual(readFileSync(path),original);
  assert.equal(f.host.active.size,0);
});

test('a digest mismatch is a measured failed verification rather than invented success',async t=>{
  const f=fixture(t);f.execution.intent.input.expectedDigest='sha256:'+'0'.repeat(64);
  const report=await f.host.execute(f);assert.equal(report.outcome.kind,'failed',JSON.stringify(report));assert.equal(report.outcome.code,'DIGEST_MISMATCH');
  assert.equal(f.host.lookup(f.execution).source.result.observedDigest,bytesDigest(f.bytes));assert.ok(report.usage.cpuMillis>0);
});

test('verifier input, execution identity and reservation limits reject before process dispatch',async t=>{
  const f=fixture(t);const bad={ ...f.execution.intent,input:{ ...f.execution.intent.input,contentBase64:'a===' } };
  assert.throws(()=>verifierReservation(bad),{ code:'INVALID_ARGUMENT' });
  await assert.rejects(f.host.execute({ ...f,execution:{ ...f.execution,intent:{ ...f.execution.intent,limits:{ ...f.execution.intent.limits,memoryBytes:1 } } } }),{ code:'LIMIT_EXCEEDED' });
  await assert.rejects(f.host.execute({ ...f,execution:{ ...f.execution,lease:{ ...f.execution.lease,holderId:randomUUID() } } }),{ code:'FORBIDDEN' });
  assert.equal(f.host.active.size,0);assert.equal(f.host.lookup(f.execution).kind,'not_started');
});

test('missing dispatch evidence supports not-started retry; a retained dispatch is never blindly replayed',async t=>{
  const f=fixture(t),unknown={ ...f.execution,state:'unknown' };delete unknown.lease;
  const absent=await f.host.reconcile(unknown);assert.equal(absent.resolution.kind,'retry');assert.equal(absent.resolution.basis,'not_started');
  const { writeFileSync }=await import('node:fs');const path=f.host.job(f.execution,true);writeFileSync(join(path,'dispatch.json'),'{}',{ mode:0o600 });
  const report=await f.host.execute(f);assert.equal(report.outcome.kind,'unknown');assert.equal(f.host.active.size,0);
  const unresolved=await f.host.reconcile(unknown);assert.equal(unresolved.resolution.kind,'observed');assert.equal(unresolved.resolution.outcome.kind,'unknown');
});

test('the actual launch guards reject outside filesystem, network, subprocess and worker access',t=>{
  const f=fixture(t),path=f.host.job(f.execution,true),outside=join(f.root,'outside.txt');writeFileSync(outside,'Keep these bytes',{ mode:0o600 });
  const probe=join(f.root,'probe.mjs');writeFileSync(probe,`
    import fs from 'node:fs';import net from 'node:net';import { spawnSync } from 'node:child_process';import { Worker } from 'node:worker_threads';
    const denied=operation=>{ try { operation();return false; } catch(error) { return error.code==='ERR_ACCESS_DENIED'; } };
    const outside=process.argv[2];
    const network=await new Promise(resolve=>{ const socket=net.createConnection({ host:'127.0.0.1',port:1 });socket.once('error',error=>{ socket.destroy();resolve(error.code==='ERR_ACCESS_DENIED'); });socket.once('connect',()=>{ socket.destroy();resolve(false); });socket.setTimeout(1000,()=>{ socket.destroy();resolve(false); }); });
    console.log(JSON.stringify({ read:denied(()=>fs.readFileSync(outside)),write:denied(()=>fs.writeFileSync(outside,'Changed')),network,child:denied(()=>spawnSync(process.execPath,['-e',''])),worker:denied(()=>new Worker('0',{ eval:true })) }));
  `,{ mode:0o600 });
  const args=workerArguments(path);args[args.length-1]=realpathSync(probe);
  const child=spawnSync(process.execPath,[...args,realpathSync(outside)],{ cwd:path,env:{ LANG:'C',TZ:'UTC' },encoding:'utf8',timeout:5000 });
  assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{ read:true,write:true,network:true,child:true,worker:true });assert.equal(readFileSync(outside,'utf8'),'Keep these bytes');
});

test('publication recovery completes an interrupted exclusive link without changing receipt bytes',async t=>{
  const f=fixture(t);await f.host.execute(f);const path=f.host.job(f.execution),final=join(path,'receipt.json'),ready=join(path,'receipt.ready'),original=readFileSync(final);
  renameSync(final,ready);linkSync(ready,final);assert.equal(statSync(final).nlink,2);
  const observed=f.host.lookup(f.execution);assert.equal(observed.kind,'receipt');assert.equal(statSync(final).nlink,1);assert.deepEqual(readFileSync(final),original);
});

test('corrupted receipts and escaping job paths fail closed without another process',async t=>{
  const f=fixture(t);await f.host.execute(f);const path=f.host.job(f.execution),file=join(path,'receipt.json'),raw=JSON.parse(readFileSync(file,'utf8'));
  raw.attempt++;writeFileSync(file,JSON.stringify(raw),{ mode:0o600 });assert.throws(()=>f.host.lookup(f.execution),{ code:'IDENTITY_CONFLICT' });
  assert.throws(()=>f.host.job({ ...f.execution,intent:{ ...f.execution.intent,id:'../escape' } }),{ code:'INVALID_ARGUMENT' });assert.equal(f.host.active.size,0);
});

test('the maximum admitted payload is verified while the next byte is refused before dispatch',async t=>{
  const f=fixture(t,Buffer.alloc(262144,7)),report=await f.host.execute(f);
  assert.equal(report.outcome.kind,'succeeded');assert.equal(report.outcome.output.byteLength,262144);assert.equal(report.outcome.output.observedDigest,bytesDigest(f.bytes));
  assert.throws(()=>verifierReservation({ ...f.execution.intent,input:{ contentBase64:Buffer.alloc(262145).toString('base64'),expectedDigest:f.execution.intent.input.expectedDigest } }),{ code:'INVALID_ARGUMENT' });
});
