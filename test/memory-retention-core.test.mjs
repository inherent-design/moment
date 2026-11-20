import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {SessionMemory} from '../runtime/session-memory.mjs';
import {canonical,bytesDigest} from '../runtime/json.mjs';

function fixture(t,options={}){const directory=mkdtempSync(join(tmpdir(),'moment-retention-')),memory=new SessionMemory(join(directory,'memory.sqlite'),randomUUID(),options);t.after(()=>{memory.close();rmSync(directory,{recursive:true,force:true});});return memory;}
const rows=memory=>canonical(Object.fromEntries(['memory_values','memory_assessments','memory_sessions','memory_working_sets'].map(table=>[table,memory.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));

test('an unknown pooled value kind preserves its bytes and refuses collection',t=>{
 const memory=fixture(t),payload=canonical({unrecognized:'Preserve this evidence until its format is understood.'});
 memory.transaction(()=>memory.db.prepare('INSERT INTO memory_values VALUES (?,?,?,?)').run('future-value',bytesDigest(payload),payload,Buffer.byteLength(payload)));
 const before=rows(memory);assert.throws(()=>memory.transaction(()=>memory.continuity.collectValues()),{code:'UNSUPPORTED_VERSION'});assert.equal(rows(memory),before);
});

test('unknown assessment state cannot be treated as a completed disposable history',t=>{
 const memory=fixture(t),session={runtimeId:'owned-retention',sessionId:randomUUID()},provider={id:'owned-fixture',model:'scripted-output'},ids=[];
 for(let i=0;i<2;i++){
  memory.observe({session,deliveryId:randomUUID(),message:{text:'Original '+i,authorship:'human'}});const dispatch=memory.claim(provider);ids.push(dispatch.id);
  assert.equal(memory.finish(dispatch.id,{kind:'unchanged',explanation:'Retain this fixture selection.'}).status,'succeeded');
 }
 memory.transaction(()=>{const manifest=memory.continuity.manifest(ids[0]);manifest.status='future-phase';memory.continuity.putManifest(manifest);});
 const before=rows(memory);assert.throws(()=>memory.transaction(()=>memory.continuity.retireOldest()),{code:'UNSUPPORTED_VERSION'});assert.equal(rows(memory),before);assert.ok(memory.continuity.manifest(ids[0]).basis);
});

test('unsupported metadata cannot conceal a pooled reference from collection',t=>{
 const memory=fixture(t),session={runtimeId:'owned-retention',sessionId:randomUUID()};
 memory.observe({session,deliveryId:randomUUID(),message:{text:'Keep attributed evidence.',authorship:'human'}});
 const dispatch=memory.claim({id:'owned-fixture',model:'scripted-output'});memory.finish(dispatch.id,{kind:'unchanged',explanation:'Keep selection.'});
 memory.transaction(()=>{const manifest=memory.continuity.manifest(dispatch.id);manifest.futureEvidence=memory.continuity.putValue('raw','Future-format source evidence.');memory.continuity.putManifest(manifest);});
 const before=rows(memory);assert.throws(()=>memory.transaction(()=>memory.continuity.collectValues()),{code:'UNSUPPORTED_VERSION'});assert.equal(rows(memory),before);
});

test('a damaged unreferenced value is retained for inspection rather than silently deleted',t=>{
 const memory=fixture(t),payload=canonical('Evidence with a broken identity.');
 memory.transaction(()=>memory.db.prepare('INSERT INTO memory_values VALUES (?,?,?,?)').run('raw',bytesDigest('different'),payload,Buffer.byteLength(payload)));
 const before=rows(memory);assert.throws(()=>memory.transaction(()=>memory.continuity.collectValues()),{code:'IDENTITY_CONFLICT'});assert.equal(rows(memory),before);
});

test('retirement preserves dormant selections and their latest basis beyond the requested detail count',t=>{
 const memory=fixture(t,{retainedAssessments:1}),session={runtimeId:'owned-retention',sessionId:randomUUID()},provider={id:'owned-fixture',model:'scripted-output'};
 const source=memory.observe({session,deliveryId:randomUUID(),message:{text:'Keep the scoped return point.',authorship:'human'}}),a=memory.claim(provider);
 memory.finish(a.id,{kind:'replace',entries:[{sourceId:source.sourceIds[0],weight:0.8,note:'A conditional original.'}],explanation:'Keep the original selection.'});
 const original=memory.read({session}),setA=original.workingSet.id;
 const switched=memory.focus({session,expectedFocusRevision:original.focus.revision,idempotencyKey:randomUUID(),action:{kind:'select',purposeKey:'other-work'}},randomUUID());
 const completed=[];
 for(let i=0;i<2;i++){memory.observe({session,workingSetId:switched.workingSet.id,deliveryId:randomUUID(),message:{text:'Other work '+i,authorship:'human'}});const dispatch=memory.claim(provider);memory.finish(dispatch.id,{kind:'unchanged',explanation:'Keep this distinct work bounded.'});completed.push(dispatch.id);}
 assert.ok(memory.continuity.manifest(a.id).basis);assert.equal(memory.continuity.manifest(completed[0]).basisAvailability,'retired');assert.ok(memory.continuity.manifest(completed[1]).basis);
 assert.deepEqual(memory.read({session,workingSetId:setA}).entries,original.entries);assert.equal(memory.read({session,sourceIds:source.sourceIds}).sources[0].text,'Keep the scoped return point.');
 let orphan;memory.transaction(()=>{orphan=memory.continuity.putValue('raw','Regenerable unused fixture value.');});
 memory.transaction(()=>memory.continuity.collectValues());assert.equal(memory.db.prepare('SELECT 1 FROM memory_values WHERE kind=? AND digest=?').get(orphan.kind,orphan.digest),undefined);
 assert.deepEqual(memory.read({session,workingSetId:setA}).entries,original.entries);
});

test('actual detail retirement follows exact signed SQLite order rather than rounded numbers',t=>{
 const memory=fixture(t),session={runtimeId:'owned-retention',sessionId:randomUUID()},ids=[];
 for(let i=0;i<3;i++){memory.observe({session,deliveryId:randomUUID(),message:{text:'Ordered original '+i,authorship:'human'}});const dispatch=memory.claim({id:'owned-fixture',model:'scripted-output'});memory.finish(dispatch.id,{kind:'unchanged',explanation:'Keep ordering evidence.'});ids.push(dispatch.id);}
 memory.transaction(()=>{memory.db.prepare('UPDATE memory_assessments SET rowid=? WHERE id=?').run(9223372036854775807n,ids[0]);memory.db.prepare('UPDATE memory_assessments SET rowid=? WHERE id=?').run(-9223372036854775808n,ids[1]);assert.equal(memory.continuity.retireOldest(),true);});
 assert.ok(memory.continuity.manifest(ids[0]).basis);assert.equal(memory.continuity.manifest(ids[1]).basisAvailability,'retired');assert.ok(memory.continuity.manifest(ids[2]).basis);
});
