import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {SessionMemory} from '../runtime/session-memory.mjs';
import {MemoryWorker} from '../runtime/memory-worker.mjs';
import {fingerprintMemory,convertLegacyMemory} from '../runtime/storage-migration.mjs';
import {legacyMemoryFixture} from './legacy-memory-fixture.mjs';
import {canonical} from '../runtime/json.mjs';

function fixture(t,options={}){
  const directory=mkdtempSync(join(tmpdir(),'moment-migrate-memory-')),filename=join(directory,'memory.sqlite'),systemId=randomUUID(),legacy=legacyMemoryFixture(filename,systemId,options);
  const cleanup=[];t.after(async()=>{for(const close of cleanup.reverse())await close();rmSync(directory,{recursive:true,force:true});});return {directory,filename,systemId,...legacy,dispose:close=>cleanup.push(close)};
}
function convert(filename,systemId,options){
  const db=new DatabaseSync(filename);db.exec('BEGIN IMMEDIATE');
  try{const result=convertLegacyMemory(db,systemId,options);db.exec('COMMIT');return result;}
  catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
}

for(const version of [1,2])test('explicit memory '+version+'→3 conversion preserves every old row, discovers legacy receipts and fences old session SQL',t=>{
  const f=fixture(t,{version}),db=new DatabaseSync(f.filename),before=fingerprintMemory(db,f.systemId),readOld=db.prepare('SELECT value FROM sessions WHERE key=?');
  assert.throws(()=>new SessionMemory(f.filename,f.systemId),{code:'UNSUPPORTED_VERSION'});assert.equal(db.prepare('PRAGMA user_version').get().user_version,version);
  db.exec('BEGIN IMMEDIATE');const result=convertLegacyMemory(db,f.systemId);db.exec('COMMIT');
  assert.equal(result.formatVersion,3);assert.equal(result.convertedSessions,1);assert.equal(result.boundInputs,1);assert.deepEqual(result.originalFingerprint,before);assert.deepEqual(fingerprintMemory(db,f.systemId,{originalOnly:true}),before);
  assert.throws(()=>readOld.get(f.key),/no such table: sessions/);db.close();
  const memory=new SessionMemory(f.filename,f.systemId);f.dispose(()=>memory.close());
  const packet=memory.read({session:f.session});assert.equal(packet.entries[0].sourceId,f.first.id);assert.equal(packet.sources[0].text,'Preserve exact history.');assert.equal(packet.lastAssessment.basisAvailability,'legacy');assert.deepEqual(packet.lastAssessment.incomingSourceIds,[f.first.id]);
  const history=memory.readAssessments({session:f.session});assert.equal(history.assessments[0].assessmentId,f.receipt.dispatchId);assert.equal(history.assessments[0].startedAt,undefined);assert.equal(history.assessments[0].observedAt,'2026-11-01T00:00:00.000Z');
  const detail=memory.readAssessments({session:f.session,assessmentId:f.receipt.dispatchId});assert.deepEqual(detail.assessment.outcome.receipt,f.receipt);assert.equal(detail.assessment.request,undefined);assert.equal(detail.assessment.profile,undefined);
  memory.focus({session:f.session,expectedFocusRevision:0,idempotencyKey:'new-focus',action:{kind:'select',purposeKey:'new-work'}},'owned-fixture');
  const replay=memory.observe(f.originalInput);assert.equal(replay.replayed,true);assert.equal(replay.workingSetId,packet.focus.workingSetId);assert.equal(memory.read({session:f.session}).workingSet.purposeKey,'new-work');assert.equal(memory.db.prepare('SELECT count(*) AS n FROM sources').get().n,1);
});

test('format conversion retains exact unknown custody and its actual request without inventing a profile',async t=>{
  const f=fixture(t,{unknown:true});convert(f.filename,f.systemId);
  const memory=new SessionMemory(f.filename,f.systemId);f.dispose(()=>memory.close());assert.deepEqual(memory.active(),f.active);
  let calls=0;const worker=new MemoryWorker(memory,{recover:true,provider:{async ready(){calls++;throw Error('Unknown work must not dispatch');},async invoke(){calls++;throw Error('No new inference');}}});f.dispose(()=>worker.close());worker.wake();await new Promise(setImmediate);await worker.running;
  assert.equal(calls,0);assert.equal(worker.status().state,'unknown');
  const trace=memory.readAssessments({session:f.session,assessmentId:f.active.id,maximumBytes:262144});assert.deepEqual(trace.assessment.request,f.active.request);assert.equal(trace.assessment.profile,undefined);assert.equal(trace.assessment.renderedInput,undefined);assert.equal(trace.assessment.basisAvailability,'legacy');
  const current=memory.read({session:f.session}),target=memory.focus({session:f.session,expectedFocusRevision:0,idempotencyKey:'aside',action:{kind:'select',purposeKey:'aside'}},'owned-fixture');
  assert.equal(memory.read({session:f.session}).pending[0].workingSetId,current.focus.workingSetId);
  const output={kind:'replace',entries:[{sourceId:f.active.request.incomingSourceIds[0],weight:0.8}],explanation:'Owned fixture observed this original result.'};
  assert.equal(memory.reconcile(f.active.id,{kind:'observed',output}).status,'succeeded');assert.equal(memory.read({session:f.session}).focus.workingSetId,target.focus.workingSetId);assert.deepEqual(memory.read({session:f.session}).entries,[]);
  assert.equal(memory.read({session:f.session,workingSetId:current.focus.workingSetId}).entries[0].sourceId,f.active.request.incomingSourceIds[0]);assert.equal(calls,0);
});

test('a failed conversion rolls back new tables, renamed roots and values while retaining original sources',t=>{
  const f=fixture(t),db=new DatabaseSync(f.filename),before=fingerprintMemory(db,f.systemId);db.close();
  assert.throws(()=>convert(f.filename,f.systemId,{limits:{maxWorkingSetBytes:1}}),{code:'LIMIT_EXCEEDED'});
  const after=new DatabaseSync(f.filename);assert.equal(after.prepare('PRAGMA user_version').get().user_version,2);assert.deepEqual(fingerprintMemory(after,f.systemId),before);assert.equal(after.prepare("SELECT 1 FROM sqlite_schema WHERE name='memory_sessions'").get(),undefined);after.close();
});

test('actual process death before the memory commit rolls back to exact legacy rows and permits explicit forward retry',t=>{
  const f=fixture(t),db=new DatabaseSync(f.filename),before=fingerprintMemory(db,f.systemId);db.close();
  const source=`import {DatabaseSync} from 'node:sqlite';import {convertLegacyMemory} from ${JSON.stringify(new URL('../runtime/storage-migration.mjs',import.meta.url).href)};const d=new DatabaseSync(process.argv[1]);d.exec('BEGIN IMMEDIATE');convertLegacyMemory(d,process.argv[2]);process.kill(process.pid,'SIGKILL');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',source,f.filename,f.systemId],{encoding:'utf8'});assert.equal(child.signal,'SIGKILL',child.stderr);
  const recovered=new DatabaseSync(f.filename);assert.equal(recovered.prepare('PRAGMA user_version').get().user_version,2);assert.deepEqual(fingerprintMemory(recovered,f.systemId),before);recovered.close();
  const result=convert(f.filename,f.systemId);assert.equal(result.changed,true);assert.equal(result.formatVersion,3);assert.equal(canonical(result.originalFingerprint),canonical(before));
});
