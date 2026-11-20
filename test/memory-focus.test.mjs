import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {SessionMemory,memorySelection} from '../runtime/session-memory.mjs';

const provider={id:'owned-focus-fixture',model:'scripted-output'};
function fixture(t,options={}){
  const directory=mkdtempSync(join(tmpdir(),'moment-focus-')),filename=join(directory,'memory.sqlite'),systemId=randomUUID(),memory=new SessionMemory(filename,systemId,options),session={runtimeId:'owned-focus',sessionId:randomUUID()};
  t.after(()=>{memory.close();rmSync(directory,{recursive:true,force:true});});return {memory,session,filename,systemId};
}
const observe=(memory,session,text,workingSetId)=>memory.observe({session,deliveryId:randomUUID(),message:{text,authorship:'human'},...(workingSetId?{workingSetId}:{})});
const select=(memory,session,expectedFocusRevision,purposeKey,extra={})=>memory.focus({session,expectedFocusRevision,idempotencyKey:randomUUID(),action:{kind:'select',purposeKey,...extra}},'owned-local-principal');
const decision=id=>({kind:'replace',entries:[{sourceId:id,weight:0.9,note:'Fixture source stays on its named task.'}],explanation:'Fixture retains this task original.'});

test('bounded reads qualify omitted descriptions and working-set fields without rewriting retained state',t=>{
  const {memory,session}=fixture(t),entries=[];
  for(let i=0;i<5;i++){
    const admitted=observe(memory,session,'Retain scoped clause '+i),dispatch=memory.claim(provider);
    entries.push({sourceId:admitted.sourceIds[0],weight:.8,note:'🍃'.repeat(1700)});
    assert.equal(memory.finish(dispatch.id,{kind:'replace',entries:[...entries],explanation:'Fixture deliberately uses large valid descriptions.'}).status,'succeeded');
  }
  select(memory,session,0,'default',{purpose:'A scoped conditional purpose. '.repeat(130),returnPoint:'Return when explicitly requested. '.repeat(50)});
  const before=memory.read({session,maximumBytes:262144});
  const bounded=memory.read({session});assert.ok(Buffer.byteLength(JSON.stringify(bounded))<=16384);assert.deepEqual(bounded.entries.map(x=>x.sourceId),entries.map(x=>x.sourceId));
  assert.ok(bounded.omittedFields.some(x=>/^\/entries\/\d+\/note$/.test(x)));
  for(let i=0;i<entries.length;i++)if(bounded.entries[i].note===undefined)assert.ok(bounded.omittedFields.includes('/entries/'+i+'/note'));
  const recovered=memory.read({session,maximumBytes:262144});assert.deepEqual(recovered,before);assert.deepEqual(recovered.entries,entries);
  assert.throws(()=>memory.read({session,maximumBytes:1}),{code:'LIMIT_EXCEEDED'});
});

test('bounded working-set catalog reserves omitted IDs and recovers them on a larger read',t=>{
  const {memory,session}=fixture(t,{maxWorkingSets:32});
  for(let i=0;i<30;i++)select(memory,session,i,'task-'+i+'x'.repeat(230));
  const all=memory.read({session,includeWorkingSets:true,maximumBytes:262144});assert.equal(all.workingSets.length,31);
  const partial=memory.read({session,includeWorkingSets:true});assert.ok(partial.workingSets.length<all.workingSets.length);
  assert.deepEqual(new Set([...partial.workingSets.map(x=>x.id),...partial.omittedWorkingSetIds]),new Set(all.workingSets.map(x=>x.id)));
  assert.ok(Buffer.byteLength(JSON.stringify(partial))<=16384);
  assert.equal(memory.read({session}).focus.workingSetId,all.focus.workingSetId);
  assert.deepEqual(memory.read({session,includeWorkingSets:true,maximumBytes:262144}),all);
});

test('escaped failure details cannot prevent a bounded read of current coverage and source handles',t=>{
  const {memory,session}=fixture(t),message='\u0000'.repeat(2000);let last;
  for(let i=0;i<40;i++){
    observe(memory,session,'Owned failure input '+i);last=memory.claim(provider);
    assert.equal(memory.failObserved(last.id,{code:'OWNED_FIXTURE_FAILURE',message}).status,'failed');
  }
  const packet=memory.read({session,maximumBytes:262144});assert.equal(packet.gapCount,40);assert.equal(packet.processedThrough,40);
  assert.ok(packet.omittedGapCount>0);assert.equal(packet.gaps.length+packet.omittedGapCount,40);assert.ok(Buffer.byteLength(JSON.stringify(packet))<=262144);
  const detail=memory.readAssessments({session,assessmentId:last.id,part:'outcome',maximumBytes:262144});
  assert.equal(JSON.parse(detail.part.body).receipt.error.message,message);
});

test('a late result updates its dormant set without restoring focus or overwriting active memory',t=>{
  const {memory,session}=fixture(t),a=observe(memory,session,'Release A is held pending its review.'),first=memory.claim(provider);memory.finish(first.id,decision(a.sourceIds[0]));
  const original=memory.read({session}),aId=original.focus.workingSetId;
  const request={session,expectedFocusRevision:0,idempotencyKey:'select-b',action:{kind:'select',purposeKey:'release-b',label:'Release B',purpose:'Separate B work, duration unknown.'}};
  const b=memory.focus(request,'owned-local-principal'),bId=b.focus.workingSetId;assert.notEqual(bId,aId);assert.deepEqual(memory.read({session}).entries,[]);
  const admitted=observe(memory,session,'Release B can now be prepared conditionally.',bId),running=memory.claim(provider);assert.equal(running.workingSetId,bId);
  const restored=select(memory,session,b.focus.revision,'default'),before=memory.read({session});assert.equal(restored.focus.workingSetId,aId);
  const replay=memory.focus(request,'owned-local-principal');assert.equal(replay.replayed,true);assert.equal(memory.read({session}).focus.workingSetId,aId);
  const receipt=memory.finish(running.id,decision(admitted.sourceIds[0]));assert.equal(receipt.status,'succeeded');
  const active=memory.read({session}),dormant=memory.read({session,workingSetId:bId});
  assert.equal(active.focus.workingSetId,aId);assert.deepEqual(active.entries,original.entries);assert.equal(active.cacheRevision,before.cacheRevision);
  assert.equal(active.lastAssessment.dispatchId,running.id);assert.equal(active.activeAssessment.dispatchId,first.id);
  assert.equal(dormant.workingSet.id,bId);assert.equal(dormant.focus.workingSetId,aId);assert.equal(dormant.entries[0].sourceId,admitted.sourceIds[0]);
  const returned=select(memory,session,active.focus.revision,'release-b');assert.equal(returned.focus.workingSetId,bId);assert.equal(memory.read({session}).entries[0].sourceId,admitted.sourceIds[0]);
  assert.equal(memory.db.prepare('SELECT count(*) AS n FROM sources').get().n,2);assert.equal(memory.subscription(session).enabled,false);
});

test('queued input binds at admission even if focus changes before claim',t=>{
  const {memory,session}=fixture(t),a=observe(memory,session,'A work arrives first.'),aId=memory.read({session}).focus.workingSetId;
  const b=select(memory,session,0,'b'),bId=b.focus.workingSetId,second=observe(memory,session,'B work arrives second.',bId);
  const old=memory.claim(provider);assert.equal(old.workingSetId,aId);memory.finish(old.id,decision(a.sourceIds[0]));
  assert.equal(memory.read({session}).focus.workingSetId,bId);assert.deepEqual(memory.read({session}).entries,[]);
  const next=memory.claim(provider);assert.equal(next.workingSetId,bId);memory.finish(next.id,decision(second.sourceIds[0]));
  assert.equal(memory.read({session}).processedThrough,2);assert.equal(memory.read({session}).entries[0].sourceId,second.sourceIds[0]);
});

test('a changed same-set basis rejects an older result while preserving its observed evidence',t=>{
  const {memory,session}=fixture(t),a=observe(memory,session,'Discuss the proposal, hold implementation.'),running=memory.claim(provider),id=memory.read({session}).focus.workingSetId;
  select(memory,session,0,'default',{purpose:'A newly qualified discussion.',basisSourceIds:a.sourceIds});
  const receipt=memory.finish(running.id,decision(a.sourceIds[0]));assert.equal(receipt.status,'failed');assert.equal(receipt.error.code,'REVISION_CONFLICT');assert.deepEqual(memory.read({session}).entries,[]);
  const trace=memory.readAssessments({session,assessmentId:running.id,maximumBytes:262144});assert.equal(trace.assessment.outcome.output.entries[0].sourceId,a.sourceIds[0]);assert.equal(trace.assessment.basis.workingSetId,id);
});

test('fresh ambiguous legacy writes refuse after a focus change while exact earlier intake retries remain attributable',t=>{
  const {memory,session}=fixture(t),input={session,deliveryId:'original-intake',message:{text:'The original task.',authorship:'human'}},a=memory.observe(input);
  select(memory,session,0,'another-task');
  assert.equal(memory.observe(input).replayed,true);assert.deepEqual(memory.observe(input).sourceIds,a.sourceIds);
  assert.throws(()=>observe(memory,session,'This operator write has no explicit set.'),{code:'INVALID_ARGUMENT'});
  const packet=memory.read({session});assert.equal(packet.observedThrough,1);assert.equal(packet.pending[0].workingSetId,a.workingSetId);
  assert.throws(()=>select(memory,session,0,'stale-task'),{code:'REVISION_CONFLICT'});
});

test('set capacity and release preserve pending custody and original source recovery',t=>{
  const {memory,session}=fixture(t,{maxWorkingSets:2});const a=observe(memory,session,'Keep the A source.'),running=memory.claim(provider);memory.finish(running.id,decision(a.sourceIds[0]));
  const b=select(memory,session,0,'b'),bId=b.focus.workingSetId;assert.throws(()=>select(memory,session,b.focus.revision,'c'),{code:'LIMIT_EXCEEDED'});
  const queued=observe(memory,session,'B is pending.',bId);select(memory,session,b.focus.revision,'default');
  const before=memory.read({session});assert.throws(()=>memory.focus({session,expectedFocusRevision:before.focus.revision,idempotencyKey:'release-pending',action:{kind:'release',workingSetId:bId}},'owned-local-principal'),{code:'CAPABILITY_UNAVAILABLE'});
  memory.cancel(session,queued.sequence);
  const released=memory.focus({session,expectedFocusRevision:before.focus.revision,idempotencyKey:'release-b',action:{kind:'release',workingSetId:bId}},'owned-local-principal');
  assert.equal(released.releasedWorkingSetId,bId);assert.equal(memory.read({session,sourceIds:queued.sourceIds}).sources.some(s=>s.id===queued.sourceIds[0]),true);
  assert.throws(()=>memory.read({session,workingSetId:bId}),{code:'NOT_FOUND'});assert.equal(memory.subscription(session).revision,0);
});

test('focus evidence recovers an omitted task change without promoting its assistant exchange',t=>{
  const {memory,session}=fixture(t);
  const original=memory.observe({session,deliveryId:'task-change',message:{text:'Maybe combine the completed reviews into a conditional release intent.',authorship:'unknown'},exchange:[{text:'Assistant proposal: both reviews are complete.',authorship:'assistant'}]});
  const first=memory.claim(provider);memory.finish(first.id,{kind:'unchanged',explanation:'Fixture reproduces a dropped task-change message.'});
  const focus=select(memory,session,0,'release-intent',{basisSourceIds:[...original.sourceIds,...original.contextIds],purpose:'Consider the conditional release intent.'});
  observe(memory,session,'Continue that discussion.',focus.focus.workingSetId);
  const dispatch=memory.claim(provider),selection=memorySelection(dispatch.request);
  assert.equal(selection.selectableSourceIds.includes(original.sourceIds[0]),true);assert.equal(selection.selectableSourceIds.includes(original.contextIds[0]),false);assert.equal(selection.contextOnlySourceIds.includes(original.contextIds[0]),true);
  assert.deepEqual(dispatch.request.focusSourceIds,original.sourceIds);assert.equal(dispatch.request.workingSet.purposeKey,'release-intent');
  const receipt=memory.finish(dispatch.id,decision(original.sourceIds[0]));assert.equal(receipt.status,'succeeded');
  const trace=memory.readAssessments({session,assessmentId:dispatch.id,maximumBytes:262144});assert.deepEqual(trace.assessment.request,dispatch.request);assert.equal(memory.read({session}).sources.find(x=>x.id===original.sourceIds[0]).authorship,'unknown');
});

test('an explicitly seeded set shares immutable selection values and same-purpose reuse creates no extra set',t=>{
  const {memory,session}=fixture(t),original=observe(memory,session,'Keep the correction attached to this task.'),dispatch=memory.claim(provider);memory.finish(dispatch.id,decision(original.sourceIds[0]));
  const before=memory.read({session}),chosen=select(memory,session,0,'related',{seedFrom:before.focus.workingSetId});
  assert.equal(chosen.cacheRevision,before.cacheRevision);assert.equal(memory.read({session}).entries[0].sourceId,original.sourceIds[0]);
  const again=select(memory,session,chosen.focus.revision,'related');assert.equal(again.created,false);assert.equal(again.focus.workingSetId,chosen.focus.workingSetId);assert.equal(again.focus.revision,chosen.focus.revision);
  assert.equal(memory.db.prepare('SELECT count(*) AS n FROM memory_working_sets').get().n,2);
  const references=memory.db.prepare('SELECT value FROM memory_working_sets ORDER BY id').all().map(row=>JSON.parse(row.value).entries);
  assert.deepEqual(references[0],references[1]);assert.equal(memory.db.prepare('SELECT count(*) AS n FROM sources').get().n,1);
});

test('two actual focus writers admit one observed revision and retain a single active selection',async t=>{
  const f=fixture(t),{memory,session,filename,systemId}=f;
  memory.configure({session,expectedRevision:0,idempotencyKey:'initialize-session',enabled:false},'owned-local-principal');
  const run=purposeKey=>new Promise((resolve,reject)=>{
    const input={session,expectedFocusRevision:0,idempotencyKey:purposeKey,action:{kind:'select',purposeKey}};
    const source=`import {SessionMemory} from ${JSON.stringify(new URL('../runtime/session-memory.mjs',import.meta.url).href)};const m=new SessionMemory(${JSON.stringify(filename)},${JSON.stringify(systemId)});try{console.log(JSON.stringify({value:m.focus(${JSON.stringify(input)},'owned-local-principal')}));}catch(e){console.log(JSON.stringify({error:e.code}));}finally{m.close();}`;
    const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);child.on('error',reject);
    const timer=setTimeout(()=>{child.kill();reject(Error('Owned focus writer timed out'));},5000);
    child.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error(stderr));else resolve(JSON.parse(stdout));});
    t.after(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill();});
  });
  const results=await Promise.all([run('a'),run('b')]);assert.equal(results.filter(x=>x.value).length,1);assert.equal(results.filter(x=>x.error==='REVISION_CONFLICT').length,1);
  const current=memory.read({session,includeWorkingSets:true});assert.equal(current.focus.revision,1);assert.equal(current.workingSets.length,2);assert.equal(current.workingSets.filter(x=>x.active).length,1);assert.equal(current.subscription.enabled,false);
});
