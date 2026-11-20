import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,lstatSync,symlinkSync,readFileSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {SessionMemory,memorySessionKey} from '../runtime/session-memory.mjs';
import {canonical,bytesDigest} from '../runtime/json.mjs';

const provider={id:'test-owned-result-fixture',model:'scripted-output'};
const session=(id=randomUUID())=>({runtimeId:'codex-fixture',sessionId:id});
function fixture(t,options={}) {
  const directory=mkdtempSync(join(tmpdir(),'moment-memory-')),filename=join(directory,'memory.sqlite'),systemId=randomUUID();
  const memory=new SessionMemory(filename,systemId,options);
  t.after(()=>{try{memory.close();}catch{}rmSync(directory,{recursive:true,force:true});});
  return {memory,filename,systemId,directory};
}
const observe=(memory,s,text,extra={})=>memory.observe({session:s,deliveryId:randomUUID(),message:{text,authorship:'human'},...extra});
const replace=(...entries)=>({kind:'replace',explanation:'Scripted fixture assessment.',entries:entries.map(([sourceId,weight,generality,note])=>({sourceId,weight,...(generality===undefined?{}:{generality}),...(note===undefined?{}:{note})}))});
function finish(memory,result) {const dispatch=memory.claim(provider);assert.equal(dispatch.kind,'dispatch');return memory.finish(dispatch.id,result);}

test('checker explanations survive receipts and reopen without becoming source notes or content revisions',t=>{
  const f=fixture(t),memory=f.memory,s=session();
  assert.equal(memory.read({session:s}).lastAssessment,undefined);
  const admitted=observe(memory,s,'Please preserve my exact wording.');
  const selected={kind:'replace',entries:[{sourceId:admitted.sourceIds[0],weight:0.9,note:'A source description.'}],explanation:'Retain the wording preference because it guides future responses.'};
  const dispatch=memory.claim(provider),receipt=memory.finish(dispatch.id,selected);
  assert.equal(receipt.status,'succeeded');assert.equal(receipt.explanation,selected.explanation);
  assert.deepEqual(memory.finish(dispatch.id,selected),receipt);
  const initial=memory.read({session:s});assert.deepEqual(initial.lastAssessment,{dispatchId:dispatch.id,sequence:1,explanation:selected.explanation,incomingSourceIds:admitted.sourceIds,basisAvailability:'retained',workingSetId:initial.focus.workingSetId});
  assert.equal(initial.entries[0].note,'A source description.');assert.equal(initial.sources[0].text,'Please preserve my exact wording.');
  observe(memory,s,'What next?');
  const unchanged={kind:'unchanged',explanation:'The routine question adds no durable steering beyond the retained preference.'};
  const next=memory.claim(provider),second=memory.finish(next.id,unchanged);assert.equal(second.status,'succeeded');assert.equal(second.cacheRevision,initial.cacheRevision);
  const assessment=memory.read({session:s}).lastAssessment;assert.equal(assessment.sequence,2);assert.equal(assessment.explanation,unchanged.explanation);
  for(const output of [{kind:"unchanged"},{kind:'unchanged',explanation:'   '},{kind:'unchanged',explanation:'x'.repeat(513)}]) {
    observe(memory,s,'Another question.');const current=memory.claim(provider),failed=memory.finish(current.id,output);
    assert.equal(failed.status,'failed');assert.equal(failed.explanation,undefined);assert.deepEqual(memory.read({session:s}).lastAssessment,assessment);
  }
  memory.close();const reopened=new SessionMemory(f.filename,f.systemId);t.after(()=>reopened.close());
  assert.deepEqual(reopened.read({session:s}).lastAssessment,assessment);assert.deepEqual(reopened.finish(next.id,unchanged),second);
});

test('original message cache admits, reweights, evicts and preserves tentative wording and optional generality',t=>{
  const {memory}=fixture(t,{capacity:2}),s=session();
  const original='Possibly expensive idea…\nKeep "maybe" and my idiosyncrancies. 🦉\n';
  const a=observe(memory,s,original),b=observe(memory,s,'Please use pnpm in Moment.');
  finish(memory,replace([a.sourceIds[0],0.6,0.4,'Design proposal under discussion.']));
  finish(memory,replace([a.sourceIds[0],0.5,0.4,'Design proposal under discussion.'],[b.sourceIds[0],0.9,0.2]));
  let packet=memory.read({session:s});assert.equal(packet.cacheRevision,2);assert.equal(packet.processedThrough,2);assert.deepEqual(packet.pending,[]);
  assert.equal(packet.sources.find(source=>source.id===a.sourceIds[0]).text,original);
  assert.equal(packet.sources.find(source=>source.id===a.sourceIds[0]).digest,bytesDigest(original));
  const c=observe(memory,s,'Correction: preserve the proposal; don’t enact it yet.');
  finish(memory,replace([c.sourceIds[0],1,0.5],[b.sourceIds[0],0.95]));
  packet=memory.read({session:s});assert.deepEqual(packet.entries.map(entry=>entry.sourceId),[c.sourceIds[0],b.sourceIds[0]]);
  assert.equal(packet.entries[0].generality,0.5);assert.equal(packet.sources.some(source=>source.id===a.sourceIds[0]),false);
  assert.equal(memory.read({session:s,sourceIds:a.sourceIds}).sources.find(source=>source.id===a.sourceIds[0]).text,original);
});

test('unchanged advances processing without a content revision and identical text remains distinct submitted evidence',t=>{
  const {memory}=fixture(t),s=session(),input={session:s,deliveryId:'delivery-one',message:{text:'Please keep this qualification.',authorship:'human'}};
  const a=memory.observe(input),replay=memory.observe(input);assert.equal(replay.replayed,true);assert.equal(replay.sequence,a.sequence);assert.deepEqual(replay.sourceIds,a.sourceIds);
  assert.throws(()=>memory.observe({...input,message:{...input.message,text:'Other text'}}),{code:'IDEMPOTENCY_CONFLICT'});
  const first=memory.claim(provider),receipt=memory.finish(first.id,{kind:'unchanged',explanation:'Scripted fixture assessment.'});
  assert.equal(receipt.cacheRevision,0);assert.deepEqual(memory.finish(first.id,{kind:'unchanged',explanation:'Scripted fixture assessment.'}),receipt);
  assert.throws(()=>memory.finish(first.id,replace([a.sourceIds[0],1])),{code:'IDEMPOTENCY_CONFLICT'});
  const b=observe(memory,s,input.message.text);assert.equal(b.sequence,2);assert.notEqual(b.sourceIds[0],a.sourceIds[0]);
  finish(memory,{kind:'unchanged',explanation:'Scripted fixture assessment.'});const packet=memory.read({session:s});assert.equal(packet.cacheRevision,0);assert.equal(packet.processedThrough,2);assert.equal(packet.observedThrough,2);
});
test('split exchange summaries cannot replace original-source provenance through duplicate cache entries',t=>{
  const {memory}=fixture(t),s=session();
  const old=observe(memory,s,'Use a stepped, banded pass for this deferred simplification intent.',{exchange:[{text:'The previous release was completed.',authorship:'assistant'}]});
  finish(memory,replace([old.sourceIds[0],0.93,0.3,'Constraint belongs to the deferred simplification intent.']));
  const before=memory.read({session:s});
  const incoming=observe(memory,s,'Summarize the intent; keep its work deferred.',{exchange:[{text:'No GUI activity is planned here.',authorship:'assistant'}]});
  const dispatch=memory.claim(provider),invalid=replace([old.sourceIds[0],0.93,0.3,'Original intent.'],[incoming.sourceIds[0],0.85,0.2,'Current query.'],[old.sourceIds[0],0.42,0.1,'Assistant release completion.'],[incoming.sourceIds[0],0.1,undefined,'Assistant GUI acknowledgment.']);
  const receipt=memory.finish(dispatch.id,invalid);assert.equal(receipt.status,'failed');assert.match(receipt.error.message,/duplicate/);
  const after=memory.read({session:s});assert.deepEqual(after.entries,before.entries);assert.deepEqual(after.lastAssessment,before.lastAssessment);assert.equal(after.cacheRevision,before.cacheRevision);
  assert.equal(after.processedThrough,2);assert.equal(after.gaps[0].sequence,2);
  const exchanges=memory.read({session:s,sourceIds:[...old.contextIds,...incoming.contextIds]});
  const contextual=[...old.contextIds,...incoming.contextIds].map(id=>exchanges.sources.find(source=>source.id===id));
  assert.deepEqual(contextual.map(source=>source.authorship),['assistant','assistant']);
  assert.deepEqual(contextual.map(source=>source.text),['The previous release was completed.','No GUI activity is planned here.']);
  assert.deepEqual(exchanges.entries.map(entry=>entry.sourceId),[old.sourceIds[0]]);
  assert.equal(exchanges.sources.find(source=>source.id===old.sourceIds[0]).text,'Use a stepped, banded pass for this deferred simplification intent.');
});

test('bounded reconstruction preserves earlier session identity and exact referenced assistant exchange',t=>{
  const {memory}=fixture(t),old=session(),next=session();
  const a=observe(memory,old,'Yes, do that.',{exchange:[{text:'Proposed: retain tentative wording without automatic adoption.',authorship:'assistant',nativeItemId:'assistant-item'}]});
  finish(memory,replace([a.sourceIds[0],0.8,undefined,'Acceptance applies to the referenced proposal.']));
  const seed=memory.rebuild({session:next,deliveryId:'seed',sourceIds:a.sourceIds,expectedRevision:0});assert.equal(seed.sequence,1);
  const dispatch=memory.claim(provider);assert.equal(dispatch.request.incomingSourceIds[0],a.sourceIds[0]);
  assert.equal(dispatch.request.sources.find(source=>source.id===a.contextIds[0]).text,'Proposed: retain tentative wording without automatic adoption.');
  memory.finish(dispatch.id,replace([a.sourceIds[0],0.9]));
  const packet=memory.read({session:next});assert.equal(packet.sources.find(source=>source.id===a.sourceIds[0]).session.sessionId,old.sessionId);
  assert.equal(packet.sources.find(source=>source.id===a.contextIds[0]).nativeItemId,'assistant-item');
  assert.throws(()=>memory.rebuild({session:next,deliveryId:'stale',sourceIds:a.sourceIds,expectedRevision:0}),{code:'REVISION_CONFLICT'});
  assert.throws(()=>memory.rebuild({session:next,deliveryId:'bad',sourceIds:a.contextIds,expectedRevision:1}),{code:'INVALID_ARGUMENT'});
  assert.equal(memory.read({session:next}).observedThrough,1);
});

test('harness notices are skipped and unknown authorship remains observable without becoming a human assertion',t=>{
  const {memory}=fixture(t),s=session();
  const notice=observe(memory,s,'Resume the goal.',{message:{text:'Resume the goal.',authorship:'harness'}});
  assert.equal(notice.status,'skipped');assert.equal(memory.claim(provider),null);
  const a=observe(memory,s,'Maybe do this.',{message:{text:'Maybe do this.',authorship:'unknown'}});
  finish(memory,replace([a.sourceIds[0],0.3,undefined,'Unconfirmed authorship and tentative proposal.']));
  const packet=memory.read({session:s});assert.equal(packet.processedThrough,2);assert.equal(packet.sources[0].authorship,'unknown');
  assert.equal(packet.entries.some(entry=>entry.sourceId===notice.sourceIds[0]),false);
});

test('explicit native history can seed a new session without queuing work in the origin, with exchange preserved across later rebuilds',t=>{
  const {memory}=fixture(t),old=session(),next=session(),later=session();
  const input={session:next,deliveryId:'selected-history',sourceIds:[],expectedRevision:0,captures:[{session:old,message:{text:'Yes, that tentative arrangement.',authorship:'unknown',nativeItemId:'selected-native-item'},exchange:[{text:'Proposal: retain original evidence without installation.',authorship:'assistant'}]}]};
  const seed=memory.rebuild(input);assert.equal(memory.read({session:old}).exists,false);assert.equal(memory.rebuild(input).replayed,true);
  const dispatch=memory.claim(provider);assert.equal(dispatch.request.sources.length,2);assert.equal(dispatch.request.sources.find(source=>source.id===seed.sourceIds[0]).origin,'selected-history');
  memory.finish(dispatch.id,replace([seed.sourceIds[0],0.8]));
  const packet=memory.read({session:next});assert.equal(packet.sources.length,2);assert.equal(packet.sources.find(source=>source.id===seed.sourceIds[0]).session.sessionId,old.sessionId);
  memory.rebuild({session:later,deliveryId:'second-rebuild',sourceIds:seed.sourceIds,expectedRevision:0});const again=memory.claim(provider);
  assert.equal(again.request.sources.find(source=>source.id===seed.contextIds[0]).text,'Proposal: retain original evidence without installation.');
  memory.finish(again.id,replace([seed.sourceIds[0],0.9]));assert.equal(memory.read({session:later}).sources.length,2);
  assert.throws(()=>memory.rebuild({...input,deliveryId:'empty',captures:[]}),{code:'INVALID_ARGUMENT'});
  assert.throws(()=>memory.rebuild({...input,deliveryId:'harness',captures:[{session:old,message:{text:'Automated reminder.',authorship:'harness'}}]}),{code:'INVALID_ARGUMENT'});
});

test('whole-source partial reads account for omissions and can include a smaller later source',t=>{
  const {memory}=fixture(t),s=session(),other=session();
  const large=observe(memory,s,'long '.repeat(2000)),small=observe(memory,s,'Small, useful qualifier.');
  finish(memory,replace([large.sourceIds[0],1]));finish(memory,replace([large.sourceIds[0],1],[small.sourceIds[0],0.8]));
  const full=memory.read({session:s,maximumBytes:262144}),metadata={...full,sources:[],omittedSourceIds:full.sources.map(source=>source.id)};
  const packet=memory.read({session:s,maximumBytes:Buffer.byteLength(canonical(metadata))+800});
  assert.ok(Buffer.byteLength(canonical(packet))<=Buffer.byteLength(canonical(metadata))+800);
  assert.deepEqual(packet.omittedSourceIds,large.sourceIds);assert.equal(packet.sources[0].text,'Small, useful qualifier.');
  const recovered=memory.read({session:s,sourceIds:large.sourceIds,maximumBytes:262144});assert.equal(recovered.sources.find(source=>source.id===large.sourceIds[0]).text,'long '.repeat(2000));
  assert.throws(()=>memory.read({session:other,sourceIds:large.sourceIds,maximumBytes:1}),{code:'NOT_FOUND'});
  assert.throws(()=>memory.read({session:s,maximumBytes:1}),{code:'LIMIT_EXCEEDED'});
});

test('malformed, invented and context-only selections retain prior valid cache with an explicit failed-input gap',t=>{
  const {memory}=fixture(t,{capacity:1}),s=session(),a=observe(memory,s,'Keep the actual source.');
  finish(memory,replace([a.sourceIds[0],0.8]));
  for(const output of [{kind:'replace',explanation:'Scripted fixture assessment.',entries:[{sourceId:'invented',weight:1}]},{kind:'replace',explanation:'Scripted fixture assessment.',entries:[{sourceId:a.sourceIds[0],weight:1,extra:true}]},replace([a.sourceIds[0],0.4],[a.sourceIds[0],0.5]),{kind:'nonsense'}]) {
    observe(memory,s,'Another proposal.');const receipt=finish(memory,output);assert.equal(receipt.status,'failed');assert.equal(receipt.error.code,'INVALID_ARGUMENT');
  }
  const withExchange=observe(memory,s,'Yes?',{exchange:[{text:'An assistant proposal.',authorship:'assistant'}]});
  assert.equal(finish(memory,replace([withExchange.contextIds[0],1])).status,'failed');
  const packet=memory.read({session:s});assert.equal(packet.cacheRevision,1);assert.equal(packet.processedThrough,6);assert.equal(packet.gaps.length,5);assert.equal(packet.entries[0].sourceId,a.sourceIds[0]);
});

test('unknown dispatch survives reopening, reserves global capacity and requires observed reconciliation',t=>{
  const {memory,filename,systemId}=fixture(t),a=session(),b=session();
  const first=observe(memory,a,'First correction.');observe(memory,b,'Independent conversation.');
  const dispatch=memory.claim(provider);assert.equal(memory.claim(provider),null);
  memory.unknown(dispatch.id,'Transport acknowledgment was lost.');
  const reopened=new SessionMemory(filename,systemId);
  try {
    assert.equal(reopened.active().status,'unknown');assert.equal(reopened.claim(provider),null);
    assert.equal(reopened.read({session:a}).pending[0].status,'unknown');
    assert.throws(()=>reopened.reconcile(dispatch.id,{kind:'retry'}),{code:'INVALID_ARGUMENT'});
    reopened.reconcile(dispatch.id,{kind:'not_started',evidence:'Owned fixture confirmed no native thread/turn was started.'});
    const retry=reopened.claim(provider);assert.notEqual(retry.id,dispatch.id);
    assert.equal(reopened.finish(retry.id,replace([first.sourceIds[0],0.8])).status,'succeeded');
    assert.equal(reopened.claim(provider).request.session.sessionId,b.sessionId);
  } finally {reopened.close();}
});

test('cancellation preserves uncertain dispatch and stale completion cannot overwrite a newer cache',t=>{
  const {memory}=fixture(t),s=session();
  const a=observe(memory,s,'First source.'),b=observe(memory,s,'Queued source.');
  const dispatch=memory.claim(provider);
  assert.equal(memory.cancel(s,b.sequence).status,'cancelled');assert.equal(memory.cancel(s,a.sequence).status,'unknown');
  memory.reconcile(dispatch.id,{kind:'cancelled',evidence:'Owned provider confirmed this turn terminated before any result was admitted.'});
  assert.equal(memory.read({session:s}).processedThrough,2);assert.equal(memory.claim(provider),null);
  const c=observe(memory,s,'Next correction.'),next=memory.claim(provider);
  const state=memory.session(s);state.revision++;state.entries=[{sourceId:a.sourceIds[0],weight:0.5}];
  memory.transaction(()=>{
    // Simulate a complete competing writer in the current representation.
    const focus=memory.continuity.focus(state.key),set=memory.continuity.workingSet(state.key,focus.workingSetId);
    set.entries=memory.continuity.putValue('entries',state.entries);set.revision++;memory.continuity.putWorkingSet(set);memory.putSession(state);
  });
  const receipt=memory.finish(next.id,replace([c.sourceIds[0],1]));assert.equal(receipt.status,'failed');assert.equal(receipt.error.code,'REVISION_CONFLICT');
  assert.equal(memory.read({session:s}).entries[0].sourceId,a.sourceIds[0]);
});

test('source/backlog/prompt/session bounds refuse transactionally and expose input coverage',t=>{
  const {memory}=fixture(t,{maxSourceBytes:40,maxPending:1,maxInputs:2,maxSessions:1,maxPromptBytes:900}),s=session();
  assert.throws(()=>observe(memory,s,'x'.repeat(41)),{code:'LIMIT_EXCEEDED'});assert.equal(memory.read({session:s}).exists,false);
  const a=observe(memory,s,'Tiny input.');assert.throws(()=>observe(memory,s,'Backlog.'),{code:'LIMIT_EXCEEDED'});
  assert.throws(()=>observe(memory,session(),'Different session.'),{code:'LIMIT_EXCEEDED'});
  const refused=memory.claim(provider);assert.equal(refused.kind,'refused');assert.equal(memory.read({session:s}).gaps[0].error.code,'LIMIT_EXCEEDED');
  const b=observe(memory,s,'Another small input.');assert.equal(b.sequence,a.sequence+1);memory.cancel(s,b.sequence);
  assert.throws(()=>observe(memory,s,'Beyond retained receipts.'),{code:'LIMIT_EXCEEDED'});
  assert.equal(memory.read({session:s}).observedThrough,2);
});

test('private storage refuses other system identity, unknown version, symlinks and altered source bytes',t=>{
  const {memory,filename,systemId,directory}=fixture(t),s=session(),a=observe(memory,s,'Exact original.');
  assert.equal(lstatSync(filename).mode&0o077,0);
  assert.throws(()=>new SessionMemory(filename,randomUUID()),{code:'IDENTITY_CONFLICT'});
  const link=join(directory,'alias.sqlite');symlinkSync(filename,link);assert.throws(()=>new SessionMemory(link,systemId));
  const source=memory.source(a.sourceIds[0]);source.text='Altered';memory.db.prepare('UPDATE sources SET value=? WHERE id=?').run(canonical(source),source.id);
  assert.throws(()=>memory.read({session:s,sourceIds:a.sourceIds}),{code:'IDENTITY_CONFLICT'});
  const db=new DatabaseSync(filename);db.exec('PRAGMA user_version=99');db.close();
  assert.throws(()=>new SessionMemory(filename,systemId),{code:'UNSUPPORTED_VERSION'});
});

test('an unrelated SQLite file is refused before initialization or journal-mode changes',t=>{
  const {directory,systemId}=fixture(t),filename=join(directory,'unrelated.sqlite');
  for(const version of [0,1,2]){
    const db=new DatabaseSync(filename);db.exec('CREATE TABLE IF NOT EXISTS unrelated(value TEXT); PRAGMA user_version='+version);db.close();chmodSync(filename,0o600);
    const before=readFileSync(filename);assert.throws(()=>new SessionMemory(filename,systemId),{code:'UNSUPPORTED_VERSION'});assert.deepEqual(readFileSync(filename),before);
  }
});

test('two actual competing processes admit only one global checker dispatch',async t=>{
  const {memory,filename,systemId}=fixture(t),s=session();observe(memory,s,'One pending input.');
  const moduleUrl=new URL('../runtime/session-memory.mjs',import.meta.url).href;
  const script='const {SessionMemory}=await import(process.argv[1]);const memory=new SessionMemory(process.argv[2],process.argv[3]);try{console.log(JSON.stringify(memory.claim({id:"competing-fixture",model:"none"})));}finally{memory.close();}';
  const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',script,moduleUrl,filename,systemId],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);
    child.once('exit',code=>code===0?resolve(JSON.parse(stdout)):reject(Error(stderr)));t.after(()=>{if(child.exitCode===null && child.signalCode===null)child.kill();});
  });
  const results=await Promise.all([run(),run()]);assert.equal(results.filter(Boolean).length,1);assert.equal(results.find(Boolean).kind,'dispatch');
  assert.equal(memory.active().key,memorySessionKey(s));
});
