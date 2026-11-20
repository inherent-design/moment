import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,unlinkSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setup,incident} from './helpers.mjs';
import {DomainError,bytesDigest,canonical,digest} from '../runtime/json.mjs';
import {publishCapture,captureRead,selectCaptureRuns,captureLock,capturePath,validateCaptureManifest} from '../runtime/captures.mjs';

function fixture(t){
  const f=setup(t),created=f.write('incident.create',{id:randomUUID(),incident}),target={systemId:f.systemId,contextId:f.contextId,incidentId:created.value.ref.id},dir=join(f.directory,'incidents',target.incidentId,'captures');mkdirSync(dir,{recursive:true,mode:0o700});
  const domain=async(m,input)=>{const r=f.call(m,input);if(!r.ok)throw Object.assign(new DomainError(r.error.code,r.error.message,r.error.retry),{details:r.error.details});return r.value;};
  const manifest={formatVersion:1,id:randomUUID(),target,generation:1,run:{id:randomUUID(),category:'release-artifact',state:'completed',current:false,order:1,pins:[],dependencies:[]},provenance:{dirtyInputDigests:[],tools:['owned fixture'],commands:['fixture'],environment:[],outcomes:['Observed fixture result'],limitations:[]},claims:[{id:'check',summary:'Historical check',outcome:'observed',sources:[],payloadIds:['binary'],limitations:[]}],payloads:[{id:'binary',path:'captures/fixture.bin',bytes:7,digest:bytesDigest('fixture'),kind:'binary',availability:{kind:'present'},pins:[],dependencies:[],requiredBy:['check']}],continuation:{summary:'Completed fixture',unresolved:[]},evidence:{sources:[],method:'Owned fixture evidence',artifactDigests:[]}};
  writeFileSync(join(dir,'fixture.bin'),'fixture');
  const record=manifest=>publishCapture(f.directory,{contextId:f.contextId,expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:randomUUID(),manifest},domain);
  return {...f,target,manifest,domain,dir,record};
}

test('capture publication admits immutable history and a discoverable current disposition; exact old replay never rewinds it',async t=>{
  const f=fixture(t),input={contextId:f.contextId,expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:randomUUID(),manifest:f.manifest},first=await publishCapture(f.directory,input,f.domain);
  const read=await captureRead(f.directory,{target:f.target},f.domain);assert.equal(read.generation,1);assert.equal(read.payloads[0].observation,'present-unverified');assert.deepEqual(read.manifest,f.manifest);
  const next=structuredClone(f.manifest);next.id=randomUUID();next.generation=2;next.previousDigest=first.digest;next.continuation.summary='Current successor';await f.record(next);
  const replay=await publishCapture(f.directory,input,f.domain);assert.equal(replay.replayed,true);assert.equal(replay.generation,1);assert.equal((await captureRead(f.directory,{target:f.target},f.domain)).generation,2);
  const q=await f.domain('graph.query',{contextId:f.contextId,selector:{ids:[first.record.id],assertionStatus:'asserted'},limit:1});assert.deepEqual(q.items[0].record.value.value,f.manifest);
});

test('lost record acknowledgment retains its exact request and reconciles without duplicating history',async t=>{
  const f=fixture(t),input={contextId:f.contextId,expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:randomUUID(),manifest:f.manifest};let lost=true;
  const domain=async(m,a)=>{const r=await f.domain(m,a);if(m==='graph.transact'&&lost){lost=false;throw new DomainError('OUTCOME_UNKNOWN','fixture lost acknowledgment','reconcile');}return r;};
  await assert.rejects(publishCapture(f.directory,input,domain),{code:'OUTCOME_UNKNOWN'});assert.equal((await captureRead(f.directory,{target:f.target},f.domain)).availability,'unregistered');
  const before=f.store.read(f.contextId).context.revision;await publishCapture(f.directory,input,f.domain);assert.equal(f.store.read(f.contextId).context.revision,before);assert.equal((await captureRead(f.directory,{target:f.target},f.domain)).generation,1);
});

test('completed publication replay settles its retired controller lock without rewinding later disposition',async t=>{
 const f=fixture(t),input={contextId:f.contextId,expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:randomUUID(),manifest:f.manifest},first=await publishCapture(f.directory,input,f.domain),module=new URL('../runtime/captures.mjs',import.meta.url).href;
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {captureLock} from ${JSON.stringify(module)};captureLock(${JSON.stringify(f.directory)},${JSON.stringify(f.target)},{operationDigest:${JSON.stringify(digest(input))}});`],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 const path=join(f.directory,'incidents',f.target.incidentId,'captures/retention/scope.lock');assert.equal(existsSync(path),true);assert.equal((await publishCapture(f.directory,input,f.domain)).generation,first.generation);assert.equal(existsSync(path),false);
});

test('actual readers see additive retirement and later restoration without changing accepted historical records',async t=>{
  const f=fixture(t),first=await f.record(f.manifest),next=structuredClone(f.manifest);next.id=randomUUID();next.generation=2;next.previousDigest=first.digest;next.payloads[0].availability={kind:'intentionally-retired',reason:'Fixture has reconciled its historical observation',dispositionEvidence:[first.record]};next.claims[0].limitations=['Exact raw replay no longer retained'];
  unlinkSync(join(f.dir,'fixture.bin'));await f.record(next);let packet=await captureRead(f.directory,{target:f.target,payloadIds:['binary']},f.domain);assert.equal(packet.payloads[0].declared.kind,'intentionally-retired');assert.equal(packet.payloads[0].observation,'absent');
  writeFileSync(join(f.dir,'fixture.bin'),'new unrelated material');packet=await captureRead(f.directory,{target:f.target},f.domain);assert.equal(packet.payloads[0].observation,'unexpectedly-present');
  const old=await f.domain('graph.query',{contextId:f.contextId,selector:{ids:[first.record.id],assertionStatus:'asserted'},limit:1});assert.equal(old.items[0].record.value.value.payloads[0].availability.kind,'present');
});

test('capture readers recheck current record authority and keep response omissions explicit',async t=>{
  const f=fixture(t);await f.record(f.manifest);
  const denied=async(m,a)=>{if(m==='graph.query')throw new DomainError('NOT_FOUND','not accessible');return f.domain(m,a);};await assert.rejects(captureRead(f.directory,{target:f.target},denied),{code:'NOT_FOUND'});
  const packet=await captureRead(f.directory,{target:f.target,maximumBytes:1024},f.domain);assert.ok(Buffer.byteLength(canonical(packet))<=1024);assert.deepEqual(packet.omittedFields,['/manifest']);assert.ok(packet.record);
  await assert.rejects(captureRead(f.directory,{target:f.target,payloadIds:['missing']},f.domain),{code:'NOT_FOUND'});
});

test('stale generation, competing local writer, protected content and unsafe paths refuse without payload effects',async t=>{
  const f=fixture(t),release=captureLock(f.directory,f.target);await assert.rejects(f.record(f.manifest),{code:'IDENTITY_CONFLICT'});release();
  const first=await f.record(f.manifest);await assert.rejects(f.record({...f.manifest,id:randomUUID()}),{code:'REVISION_CONFLICT'});
  assert.throws(()=>capturePath(f.directory,'incidents/../runtime'),{code:'INVALID_ARGUMENT'});
  const protectedManifest=structuredClone(f.manifest);protectedManifest.payloads[0].kind='world';protectedManifest.payloads[0].availability={kind:'intentionally-retired',reason:'invalid fixture',dispositionEvidence:[first.record]};assert.throws(()=>validateCaptureManifest(protectedManifest),{code:'FORBIDDEN'});assert.equal(readFileSync(join(f.dir,'fixture.bin'),'utf8'),'fixture');
});

test('active-or-latest-two is per meaningful scope and preserves pins/transitive run dependencies without age cutoffs',t=>{
  const f=fixture(t),run=(id,order,extra={})=>({...structuredClone(f.manifest),run:{...f.manifest.run,id,order,...extra}}),a=run('a',1),b=run('b',2),c=run('c',3);
  assert.deepEqual(selectCaptureRuns([a,b,c]),['b','c']);c.run.current=true;assert.deepEqual(selectCaptureRuns([a,b,c]),['c']);a.run.pins=['historical failure'];assert.deepEqual(selectCaptureRuns([a,b,c]),['a','c']);a.run.pins=[];c.run.dependencies=['a'];assert.deepEqual(selectCaptureRuns([a,b,c]),['a','c']);c.run.dependencies=['unknown'];assert.throws(()=>selectCaptureRuns([a,b,c]),{code:'NOT_FOUND'});
});
