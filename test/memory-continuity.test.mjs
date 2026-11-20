import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {SessionMemory,renderMemoryPrompt} from '../runtime/session-memory.mjs';
import {canonical,digest,bytesDigest} from '../runtime/json.mjs';

const provider={id:'test-owned-assessment-fixture',model:'scripted-output'};
function fixture(t,options={}) {
  const directory=mkdtempSync(join(tmpdir(),'moment-continuity-')),filename=join(directory,'memory.sqlite'),systemId=randomUUID();
  const memory=new SessionMemory(filename,systemId,options);
  t.after(()=>{try{memory.close();}catch{}rmSync(directory,{recursive:true,force:true});});
  return {memory,filename,systemId,session:{runtimeId:'owned-fixture',sessionId:randomUUID()}};
}
const observe=(m,session,text)=>m.observe({session,deliveryId:randomUUID(),message:{text,authorship:'human'}});
const selected=id=>({kind:'replace',entries:[{sourceId:id,weight:0.9,note:'Keep this exact conditional steering.'}],explanation:'Fixture retains the scoped original.'});

test('observed cancellation does not advertise a still-pending raw result',t=>{
  const {memory,session}=fixture(t);observe(memory,session,'An owned cancelled assessment has no completed result.');const dispatch=memory.claim(provider);
  memory.unknown(dispatch.id,'Owned fixture awaits attributable terminal evidence');
  assert.equal(memory.readAssessments({session}).assessments[0].nativeOutput.availability,'pending');
  memory.reconcile(dispatch.id,{kind:'cancelled',evidence:'The owned fixture observed terminal interruption; no completed raw result was supplied.'});
  const packet=memory.readAssessments({session});assert.equal(packet.assessments[0].status,'cancelled');assert.equal(packet.assessments[0].nativeOutput.availability,'not-supplied');
});

test('a successful omitted original has an ordinary recovery handle and an inspectable decision',t=>{
  const {memory,session}=fixture(t);
  const first=observe(memory,session,'Hold implementation until the design review finishes.');
  let dispatch=memory.claim(provider);memory.finish(dispatch.id,selected(first.sourceIds[0]));
  const second=observe(memory,session,'The review finished; please combine the conditional release intent.');
  dispatch=memory.claim(provider);memory.finish(dispatch.id,{kind:'unchanged',explanation:'Fixture deliberately reproduces the rejected incoming message.'});
  const packet=memory.read({session});
  assert.deepEqual(packet.lastAssessment.incomingSourceIds,second.sourceIds);
  assert.equal(packet.lastAssessment.basisAvailability,'retained');
  const recovered=memory.read({session,sourceIds:packet.lastAssessment.incomingSourceIds});
  assert.equal(recovered.sources.find(x=>x.id===second.sourceIds[0]).text,'The review finished; please combine the conditional release intent.');
  const assessment=memory.readAssessments({session,assessmentId:packet.lastAssessment.dispatchId,maximumBytes:262144});
  assert.deepEqual(assessment.assessment.basis.incomingSourceIds,second.sourceIds);
  assert.deepEqual(assessment.assessment.outcome.output,{kind:'unchanged',explanation:'Fixture deliberately reproduces the rejected incoming message.'});
});

test('settled assessment reconstructs its exact old request and prompt after reopening without debug snapshots',t=>{
  const f=fixture(t),{memory,session}=f;
  const first=observe(memory,session,'Keep "maybe" literal; this is a tentative aside. 🦉');
  const initial=memory.claim(provider);memory.finish(initial.id,selected(first.sourceIds[0]));
  observe(memory,session,'Now return to the release, without changing the aside into permission.');
  const dispatch=memory.claim(provider),expectedPrompt=renderMemoryPrompt(dispatch.request),output={kind:'unchanged',explanation:'Fixture keeps the conditional original.'};
  memory.finish(dispatch.id,output,{modelTokens:17});memory.close();
  const reopened=new SessionMemory(f.filename,f.systemId);t.after(()=>reopened.close());
  const packet=reopened.readAssessments({session,assessmentId:dispatch.id,maximumBytes:262144});
  assert.equal(packet.assessment.renderedInput,expectedPrompt);
  assert.deepEqual(packet.assessment.request,dispatch.request);
  assert.equal(digest(packet.assessment.request),dispatch.inputDigest);
  assert.equal(bytesDigest(packet.assessment.renderedInput),packet.assessment.basis.renderedInputDigest);
  assert.deepEqual(packet.assessment.outcome.output,output);
  assert.equal(packet.assessment.outcome.receipt.usage.modelTokens,17);
  assert.throws(()=>reopened.readAssessments({session:{...session,sessionId:randomUUID()},assessmentId:dispatch.id}),{code:'NOT_FOUND'});
});

test('bounded history keeps source handles after detail retirement and cursors exclude later assessments',t=>{
  const {memory,session}=fixture(t,{retainedAssessments:2});const ids=[];
  for(let i=0;i<4;i++){
    const admitted=observe(memory,session,'Scoped source '+i),dispatch=memory.claim(provider);ids.push({id:dispatch.id,sourceId:admitted.sourceIds[0]});
    memory.finish(dispatch.id,{kind:'unchanged',explanation:'Fixture keeps no selected entries.'});
  }
  const old=memory.readAssessments({session,assessmentId:ids[0].id});
  assert.equal(old.assessment.basisAvailability,'retired');assert.deepEqual(old.assessment.incomingSourceIds,[ids[0].sourceId]);assert.equal(old.assessment.basis,undefined);
  assert.deepEqual(memory.readAssessments({session,assessmentId:ids[0].id,part:'basis'}).unavailablePart,{part:'basis',reason:'retired'});
  assert.equal(memory.read({session,sourceIds:old.assessment.incomingSourceIds}).sources[0].text,'Scoped source 0');
  const page=memory.readAssessments({session,limit:1});assert.equal(page.assessments[0].assessmentId,ids[3].id);assert.ok(page.nextCursor);
  observe(memory,session,'A later assessment.');const next=memory.claim(provider);memory.finish(next.id,{kind:'unchanged',explanation:'Fixture later assessment.'});
  const second=memory.readAssessments({session,limit:1,cursor:page.nextCursor});assert.equal(second.assessments[0].assessmentId,ids[2].id);
  assert.throws(()=>memory.readAssessments({session,limit:2,cursor:page.nextCursor}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>memory.readAssessments({session:{...session,sessionId:randomUUID()},limit:1,cursor:page.nextCursor}),{code:'INVALID_ARGUMENT'});
  assert.equal(memory.db.prepare("SELECT count(*) AS n FROM memory_values WHERE kind='profile'").get().n,1);
});

test('whole component omissions and UTF-8 ranges retain independent identities without invoking a checker',t=>{
  const {memory,session}=fixture(t);observe(memory,session,'Retain this 🦉 qualification and its exact source.');const dispatch=memory.claim(provider);
  memory.finish(dispatch.id,{kind:'unchanged',explanation:'Fixture explicit omission.'});
  const small=memory.readAssessments({session,assessmentId:dispatch.id,maximumBytes:1800});assert.ok(small.omittedParts.includes('profile'));assert.equal(Buffer.byteLength(canonical(small))<=1800,true);
  const full=memory.readAssessments({session,assessmentId:dispatch.id,maximumBytes:262144}),bytes=Buffer.from(full.assessment.renderedInput),offset=bytes.indexOf(Buffer.from('🦉'));
  assert.ok(offset>0);
  const ranged=memory.readAssessments({session,assessmentId:dispatch.id,part:'renderedInput',bodyRange:{offset,byteLength:4},maximumBytes:1800});
  assert.equal(ranged.part.body,'🦉');assert.equal(ranged.part.wholeDigest,bytesDigest(bytes));assert.equal(ranged.part.selectedDigest,bytesDigest('🦉'));assert.equal(ranged.part.representation,'range');
  assert.throws(()=>memory.readAssessments({session,assessmentId:dispatch.id,part:'renderedInput',bodyRange:{offset:offset+1,byteLength:3}}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>memory.readAssessments({session,assessmentId:dispatch.id,maximumBytes:1}),{code:'LIMIT_EXCEEDED'});
  assert.equal(memory.active(),undefined);assert.equal(memory.read({session}).processedThrough,1);
});

test('preparation byte exhaustion preserves pending intake and leaves no partial evidence publication',t=>{
  const {memory,session}=fixture(t,{maxProfileBytes:1});const source=observe(memory,session,'Keep this pending when evidence space is unavailable.');
  const before=memory.db.prepare('SELECT * FROM memory_values ORDER BY kind,digest').all();
  assert.throws(()=>memory.claim(provider),{code:'LIMIT_EXCEEDED'});
  assert.equal(memory.active(),undefined);const packet=memory.read({session});assert.equal(packet.pending[0].status,'pending');assert.equal(packet.processedThrough,0);
  assert.equal(memory.read({session,sourceIds:source.sourceIds}).sources[0].text,'Keep this pending when evidence space is unavailable.');
  assert.deepEqual(memory.db.prepare('SELECT * FROM memory_values ORDER BY kind,digest').all(),before);assert.equal(memory.db.prepare('SELECT count(*) AS n FROM memory_assessments').get().n,0);
});

test('unknown assessment custody survives reopen and immutable value corruption is diagnosed',t=>{
  const f=fixture(t),{memory,session}=f;observe(memory,session,'The request might have started.');const dispatch=memory.claim(provider);memory.unknown(dispatch.id,'Owned fixture lost its completion observation.');memory.close();
  const reopened=new SessionMemory(f.filename,f.systemId);t.after(()=>reopened.close());
  const pending=reopened.readAssessments({session,assessmentId:dispatch.id,maximumBytes:262144});assert.equal(pending.assessment.status,'unknown');assert.deepEqual(pending.assessment.request,dispatch.request);
  reopened.db.prepare("UPDATE memory_values SET payload='{}' WHERE kind='basis'").run();
  assert.throws(()=>reopened.readAssessments({session,assessmentId:dispatch.id}),{code:'IDENTITY_CONFLICT'});
  assert.throws(()=>reopened.readAssessments({session:{...session,sessionId:randomUUID()},assessmentId:dispatch.id}),{code:'NOT_FOUND'});
});
