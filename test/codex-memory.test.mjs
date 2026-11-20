import {renderMemoryInput,memoryPrompt,memoryOutputSchema} from '../runtime/session-memory.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,readdirSync,chmodSync,statSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {SessionMemory} from '../runtime/session-memory.mjs';import {CodexMemoryProvider,configuredMemoryProvider,readMemoryAccessSession} from '../runtime/codex-memory.mjs';import {MemoryWorker} from '../runtime/memory-worker.mjs';
import {bytesDigest,digest} from '../runtime/json.mjs';
import {NativeLabor} from '../runtime/native-labor.mjs';

function fixture(t,scenario='normal') {
  const root=mkdtempSync(join(tmpdir(),'mcp-')),memory=new SessionMemory(join(root,'memory.sqlite'),randomUUID());
  const binary=join(root,'codex.mjs');writeFileSync(binary,'#!'+process.execPath+'\n'+readFileSync(new URL('./codex-memory-fixture.mjs',import.meta.url)),{mode:0o700});
  const credentialFile=join(root,'access.json'),claims=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  writeFileSync(credentialFile,JSON.stringify({tokens:{access_token:'fixture.'+claims+'.signature',account_id:scenario,refresh_token:'UNSELECTED_REFRESH_SENTINEL'}}),{mode:0o600});
  const provider=new CodexMemoryProvider(root,{binary,credentialFile}),session={runtimeId:'native-protocol-fixture',sessionId:randomUUID()};
  const workers=[];t.after(async()=>{for(const worker of workers)await worker.close();await provider.close();try{memory.close();}catch{}rmSync(root,{recursive:true,force:true});});
  const observe=()=>memory.observe({session,deliveryId:randomUUID(),message:{text:'Maybe preserve this original wording.',authorship:'human'}});
  return {root,memory,binary,credentialFile,provider,session,observe,workers};
}
async function until(memory,session,predicate) {
  const deadline=performance.now()+5000;
  do {const packet=memory.read({session});if(predicate(packet))return packet;await new Promise(resolve=>setTimeout(resolve,10));}while(performance.now()<deadline);
  throw Error('Owned scripted child did not reach the expected memory state');
}
test('native adapter binds profile/model, tolerates early completion, records reported usage and cleans settled state',async t=>{
  const f=fixture(t),before=readFileSync(f.credentialFile),admitted=f.observe();
  const identity=await f.provider.ready();assert.equal(identity.model,'gpt-6-luna');const dispatch=f.memory.claim(identity),result=await f.provider.invoke(dispatch,new AbortController().signal);
  const observed=JSON.parse(readFileSync(join(f.provider.environment.CODEX_HOME,'observed-request.json'),'utf8')),sent=observed.turnStart.input[0].text;
  const originalMarker='\n\nOriginal source messages:\n',assessmentsMarker='\n\nPrevious cache assessments (reconsider against the original sources):\n';
  const projected=JSON.parse(sent.slice(sent.indexOf(originalMarker)+originalMarker.length,sent.indexOf(assessmentsMarker)));
  assert.deepEqual(projected.map(({id,authorship,origin,session,text})=>({id,authorship,origin,session,text})),dispatch.request.sources.map(({id,authorship,origin,session,text})=>({id,authorship,origin,session,text})));
  assert.ok(dispatch.request.sources.every(source=>source.digest),'Frozen requests retain the exact source identity omitted only from model presentation');
  const recorded=JSON.parse(readFileSync(join(f.root,'runtime/session-memory-native/jobs',dispatch.id+'.json'),'utf8'));
  assert.equal(recorded.nativePromptDigest,bytesDigest(sent));assert.equal(recorded.baseInstructionsDigest,bytesDigest(observed.threadStart.baseInstructions));assert.equal(recorded.developerInstructionsDigest,bytesDigest(observed.threadStart.developerInstructions));
  assert.equal(result.output.explanation,'Scripted fixture assessment.');assert.equal(recorded.profileVersion,6);assert.equal(result.output.entries[0].sourceId,admitted.sourceIds[0]);assert.equal(result.output.entries[0].generality,undefined);assert.equal(result.usage.cachedInputTokens,0);
  const receipt=f.memory.finish(dispatch.id,result.output,result.usage);await f.provider.settled(receipt);
  assert.equal(receipt.promptVersion,'6');assert.equal(receipt.explanation,result.output.explanation);assert.equal(f.memory.read({session:f.session}).lastAssessment.explanation,result.output.explanation);
  assert.equal(f.memory.read({session:f.session}).cacheRevision,1);assert.deepEqual(readFileSync(f.credentialFile),before);
  assert.deepEqual(readdirSync(join(f.root,'runtime/session-memory-native')).filter(name=>name.startsWith('instance-')),[]);
  const journal=JSON.parse(readFileSync(join(f.root,'runtime/session-memory-native/jobs',dispatch.id+'.json'),'utf8'));assert.equal(journal.state,'committed');assert.equal(journal.output,undefined);assert.equal(JSON.stringify(journal).includes('UNSELECTED_REFRESH_SENTINEL'),false);
  const unchanged=fixture(t,'unchanged-output');unchanged.observe();const next=unchanged.memory.claim(await unchanged.provider.ready()),decision=await unchanged.provider.invoke(next,new AbortController().signal);
  assert.equal(decision.output.kind,'unchanged');const unchangedReceipt=unchanged.memory.finish(next.id,decision.output,decision.usage);await unchanged.provider.settled(unchangedReceipt);
  assert.equal(unchangedReceipt.status,'succeeded');assert.equal(unchangedReceipt.cacheRevision,0);assert.equal(unchanged.memory.read({session:unchanged.session}).lastAssessment.explanation,decision.output.explanation);
});
test('compatible native behavior is accepted independently of older or future release labels',async t=>{
  for(const version of ['0.167.2','0.170.0','0.999.0-dev']) {
    const f=fixture(t);writeFileSync(f.binary,readFileSync(f.binary,'utf8').replace('codex-cli 0.169.0','codex-cli '+version),{mode:0o700});
    f.observe();const identity=await f.provider.ready(),dispatch=f.memory.claim(identity),result=await f.provider.invoke(dispatch,new AbortController().signal);
    const journal=JSON.parse(readFileSync(join(f.root,'runtime/session-memory-native/jobs',dispatch.id+'.json'),'utf8'));
    assert.equal(journal.nativeVersion,'codex-cli '+version);assert.equal(result.output.kind,'replace');
    await f.provider.settled(f.memory.finish(dispatch.id,result.output,result.usage));
  }
});
test('native selection distinguishes original cache units from referenced exchanges and bounds distinct candidates',async t=>{
  const f=fixture(t);
  const old=f.memory.observe({session:f.session,deliveryId:randomUUID(),message:{text:'Use a stepped, banded pass for the deferred simplification intent.',authorship:'human'},exchange:[{text:'A previous release was completed.',authorship:'assistant'}]});
  const initial=f.memory.claim({id:'fixture',model:'scripted'});f.memory.finish(initial.id,{kind:'replace',entries:[{sourceId:old.sourceIds[0],weight:0.9,note:'Constraint applies to the deferred simplification intent.'}],explanation:'Retain the scoped original.'});
  const incoming=f.memory.observe({session:f.session,deliveryId:randomUUID(),message:{text:'Summarize that intent; keep its work deferred.',authorship:'human'},exchange:[{text:'No GUI activity is planned here.',authorship:'assistant'}]});
  const dispatch=f.memory.claim(await f.provider.ready()),result=await f.provider.invoke(dispatch,new AbortController().signal);
  const observed=JSON.parse(readFileSync(join(f.provider.environment.CODEX_HOME,'observed-request.json'),'utf8'));
  assert.equal(observed.turnStart.outputSchema.properties.entries.maxItems,2);
  const sent=observed.turnStart.input[0].text,start='\n\nSession and capacity:\n',end='\n\nOriginal source messages:\n';
  const metadata=JSON.parse(sent.slice(sent.indexOf(start)+start.length,sent.indexOf(end)));
  assert.deepEqual(metadata.selectableSourceIds,[old.sourceIds[0],incoming.sourceIds[0]]);
  assert.deepEqual(new Set(metadata.contextOnlySourceIds),new Set([...old.contextIds,...incoming.contextIds]));assert.equal(metadata.maximumEntries,2);
  assert.equal(dispatch.request.sources.length,4);assert.equal(result.output.entries[0].sourceId,incoming.sourceIds[0]);
  await f.provider.settled(f.memory.finish(dispatch.id,result.output,result.usage));
});
test('missing or incompatible API fields preserve pending inputs with safe boundary diagnostics',async t=>{
  for(const scenario of ['missing-login','malformed-login','missing-thread-id','wrong-permissions']) {
    const f=fixture(t,scenario);f.observe();const worker=new MemoryWorker(f.memory,{provider:f.provider});f.workers.push(worker);worker.wake();
    const deadline=performance.now()+5000;
    while(worker.status().state!=='unavailable' && performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(worker.status().state,'unavailable');assert.match(worker.status().reason,/Codex 0\.169\.0: (account\/login\/start|thread\/start)/);
    assert.equal(worker.status().reason.includes('PRIVATE_UPSTREAM_SENTINEL'),false);
    const packet=f.memory.read({session:f.session});assert.equal(packet.processedThrough,0);assert.equal(packet.pending[0].status,'pending');assert.equal(f.memory.active(),undefined);
  }
});
test('an incompatible turn acknowledgment retains unknown work and its diagnostic without replay',async t=>{
  const f=fixture(t,'malformed-turn');f.observe();const worker=new MemoryWorker(f.memory,{provider:f.provider});f.workers.push(worker);worker.wake();
  const packet=await until(f.memory,f.session,value=>value.pending[0]?.status==='unknown');
  await worker.running;await new Promise(setImmediate);await worker.running;
  assert.equal(packet.processedThrough,0);assert.match(f.memory.active().detail,/turn\/start/);assert.equal(worker.status().state,'unknown');assert.match(worker.status().reason,/turn\/start/);
  assert.equal(readdirSync(join(f.root,'runtime/session-memory-native/jobs')).length,1);
});
test('observed native failure and malformed output become explicit failed gaps, preserving the prior cache',async t=>{
  for(const scenario of ['failed-turn','invalid-output','duplicate-output','invalid-unicode-output']) {
    const f=fixture(t,scenario);f.observe();const worker=new MemoryWorker(f.memory,{provider:f.provider});f.workers.push(worker);worker.wake();
    const packet=await until(f.memory,f.session,value=>value.processedThrough===1);assert.equal(packet.entries.length,0);assert.equal(packet.gapCount,1);assert.equal(packet.gaps[0].error.code,scenario==='failed-turn'?'NATIVE_TURN_FAILED':'OUTPUT_INVALID');
  }
});
test('domain-rejected native output stays private and attributable for diagnosis while the valid cache is preserved',async t=>{
  const f=fixture(t,'rejected-output');f.observe();const worker=new MemoryWorker(f.memory,{provider:f.provider});f.workers.push(worker);worker.wake();
  const packet=await until(f.memory,f.session,value=>value.processedThrough===1);assert.equal(packet.entries.length,0);assert.equal(packet.gaps[0].error.code,'INVALID_ARGUMENT');
  const jobs=join(f.root,'runtime/session-memory-native/jobs');let job;
  const deadline=performance.now()+5000;do{const names=readdirSync(jobs);job=names.length?JSON.parse(readFileSync(join(jobs,names[0]),'utf8')):undefined;if(job?.receiptStatus==='failed')break;await new Promise(resolve=>setTimeout(resolve,10));}while(performance.now()<deadline);
  assert.equal(job.receiptStatus,'failed');assert.equal(job.validationError.code,'INVALID_ARGUMENT');
  assert.equal(job.output,undefined);assert.equal(job.rawOutput,undefined);
  const trace=f.memory.readAssessments({session:f.session,assessmentId:job.assessmentId,maximumBytes:262144}).assessment;
  assert.equal(trace.outcome.output.entries.length,6);assert.equal(JSON.parse(trace.rawOutput).entries.length,6);assert.equal(trace.outcome.receipt.status,'failed');
});
test('pre-turn refusal remains pending without retry, while lost turn acknowledgment retains unknown dispatch',async t=>{
  for(const scenario of ['refuse-thread','lose-turn']) {
    const f=fixture(t,scenario);f.observe();const worker=new MemoryWorker(f.memory,{provider:f.provider});f.workers.push(worker);worker.wake();
    const deadline=performance.now()+5000;while(!['unavailable','unknown'].includes(worker.status().state) && performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    const packet=f.memory.read({session:f.session});assert.equal(packet.processedThrough,0);assert.equal(packet.pending[0].status,scenario==='refuse-thread'?'pending':'unknown');
    if(scenario==='lose-turn') assert.equal(f.memory.active().status,'unknown');else assert.equal(f.memory.active(),undefined);
  }
});
test('a durably observed native result recovers without another model turn and altered journals are refused',async t=>{
  const f=fixture(t);f.observe();const dispatch=f.memory.claim(await f.provider.ready());
  await f.provider.invoke(dispatch,new AbortController().signal);f.memory.unknown(dispatch.id,'Fixture interruption after native result publication.');await f.provider.close();
  const provider=new CodexMemoryProvider(f.root,{binary:f.binary,credentialFile:f.credentialFile});t.after(()=>provider.close());
  const priorPath=join(f.root,'runtime/session-memory-native/jobs',dispatch.id+'.json'),prior=JSON.parse(readFileSync(priorPath,'utf8'));prior.nativeVersion='codex-cli 0.150.0';writeFileSync(priorPath,JSON.stringify(prior),{mode:0o600});
  const recovery=provider.recover(dispatch);assert.equal(recovery.kind,'observed');const receipt=f.memory.reconcile(dispatch.id,recovery);assert.equal(receipt.status,'succeeded');await provider.settled(receipt);
  assert.equal(readdirSync(join(f.root,'runtime/session-memory-native')).filter(name=>name.startsWith('instance-')).length,0);
  const path=join(f.root,'runtime/session-memory-native/jobs',dispatch.id+'.json'),journal=JSON.parse(readFileSync(path,'utf8'));
  journal.profileVersion=3;writeFileSync(path,JSON.stringify(journal),{mode:0o600});assert.throws(()=>provider.recover(dispatch),{code:'UNSUPPORTED_VERSION'});
  journal.profileVersion=6;journal.inputDigest='sha256:'+'0'.repeat(64);writeFileSync(path,JSON.stringify(journal),{mode:0o600});
  assert.throws(()=>provider.recover(dispatch),{code:'IDENTITY_CONFLICT'});
});

test('observed interruption and completed output with a lost acknowledgment reconcile without another inference',async t=>{
  for(const scenario of ['interrupted-turn','lose-ack-completed']){
    const f=fixture(t,scenario);f.observe();const worker=new MemoryWorker(f.memory,{provider:f.provider});f.workers.push(worker);worker.wake();
    await until(f.memory,f.session,packet=>packet.processedThrough===1||packet.pending[0]?.status==='unknown');
    await worker.running;await new Promise(setImmediate);await worker.running;
    const packet=f.memory.read({session:f.session});assert.equal(packet.processedThrough,1);assert.equal(f.memory.active(),undefined);
    assert.equal(packet.gapCount,scenario==='interrupted-turn'?1:0);if(scenario==='interrupted-turn')assert.equal(packet.gaps[0].status,'cancelled');else assert.equal(packet.sources[0].text,'Maybe preserve this original wording.');
  }
});
test('journal bounds refuse a new checker before native startup and preserve retained evidence',async t=>{
  const f=fixture(t);f.observe();const dispatch=f.memory.claim(await f.provider.ready()),result=await f.provider.invoke(dispatch,new AbortController().signal);
  await f.provider.settled(f.memory.finish(dispatch.id,result.output,result.usage));
  const provider=new CodexMemoryProvider(f.root,{binary:f.binary,credentialFile:f.credentialFile,maximumJournals:1});t.after(()=>provider.close());
  await assert.rejects(provider.ready(),{code:'LIMIT_EXCEEDED'});assert.equal(readdirSync(join(f.root,'runtime/session-memory-native')).filter(name=>name.startsWith('instance-')).length,0);
  assert.equal(readdirSync(join(f.root,'runtime/session-memory-native/jobs')).length,1);
});
test('private provider configuration is explicit, absent/disabled needs no credentials, and unqualified sources are refused',async t=>{
  const f=fixture(t);assert.equal(configuredMemoryProvider(f.root),undefined);
  mkdirSync(join(f.root,'runtime'),{mode:0o700});const config=join(f.root,'runtime/session-memory.json');writeFileSync(config,JSON.stringify({formatVersion:1,enabled:false}),{mode:0o600});assert.equal(configuredMemoryProvider(f.root),undefined);
  writeFileSync(config,JSON.stringify({formatVersion:1,enabled:true,provider:{kind:'untrusted-generated-code'}}),{mode:0o600});assert.ok(configuredMemoryProvider(f.root).unavailableReason);
  writeFileSync(config,JSON.stringify({formatVersion:1,enabled:true,provider:{kind:'codex',credentialFile:f.credentialFile,model:'gpt-6-luna',binary:f.binary}}),{mode:0o600});assert.ok(configuredMemoryProvider(f.root) instanceof CodexMemoryProvider);
  chmodSync(f.credentialFile,0o644);assert.throws(()=>readMemoryAccessSession(f.credentialFile),{code:'UNAUTHENTICATED'});assert.equal(existsSync(join(f.root,'runtime/session-memory-native')),false);
});

test('production labor wrapper commits exact native instructions, schema and raw output before journal cleanup',async t=>{
  const f=fixture(t),credentialsBefore=readFileSync(f.credentialFile),admission=f.observe(),labor=new NativeLabor(f.root);t.after(()=>labor.close());
  const invoke=f.provider.invoke.bind(f.provider);let actual,raw;
  f.provider.invoke=async(...args)=>{
    const result=await invoke(...args);actual=JSON.parse(readFileSync(join(f.provider.environment.CODEX_HOME,'observed-request.json'),'utf8'));raw=result.rawOutput;return result;
  };
  const worker=new MemoryWorker(f.memory,{provider:labor.provider('memory',f.provider)});f.workers.push(worker);worker.wake();
  const packet=await until(f.memory,f.session,value=>value.processedThrough===1);await worker.running;
  const trace=f.memory.readAssessments({session:f.session,assessmentId:packet.lastAssessment.dispatchId,maximumBytes:262144}).assessment;
  assert.equal(trace.nativeProfile.baseInstructions,actual.threadStart.baseInstructions);assert.equal(trace.nativeProfile.developerInstructions,actual.threadStart.developerInstructions);
  assert.deepEqual(trace.nativeSchema,actual.turnStart.outputSchema);assert.equal(trace.renderedInput,actual.turnStart.input[0].text);
  assert.equal(trace.preparation.inputDigest,bytesDigest(actual.turnStart.input[0].text));assert.equal(trace.preparation.schemaDigest,digest(actual.turnStart.outputSchema));
  assert.equal(trace.nativeProfile.parameters.permissions,actual.threadStart.permissions);assert.equal(trace.nativeProfile.parameters.model,actual.threadStart.model);
  assert.equal(trace.rawOutput,raw);assert.equal(trace.outcome.receipt.nativeOutputDigest,bytesDigest(raw));assert.equal(trace.outcome.receipt.evidenceRetained,true);
  assert.equal(trace.request.incomingSourceIds[0],admission.sourceIds[0]);assert.equal(trace.outcome.receipt.usage.modelTokens,30);
  const job=JSON.parse(readFileSync(join(f.root,'runtime/session-memory-native/jobs',trace.assessmentId+'.json'),'utf8'));
  assert.equal(job.state,'committed');assert.equal(job.rawOutput,undefined);assert.equal(job.output,undefined);assert.equal(job.assessmentId,trace.assessmentId);
  assert.equal(labor.holder,undefined);assert.deepEqual(readFileSync(f.credentialFile),credentialsBefore);
  assert.equal(readdirSync(join(f.root,'runtime/session-memory-native')).filter(x=>x.startsWith('instance-')).length,0);
});

test('profile storage refusal releases the prepared native process and labor slot without invoking a turn',async t=>{
  const f=fixture(t),labor=new NativeLabor(f.root);t.after(()=>labor.close());let invocations=0;
  const prepare=f.provider.prepare.bind(f.provider),invoke=f.provider.invoke.bind(f.provider);
  f.provider.prepare=dispatch=>{const prepared=prepare(dispatch);prepared.profile.developerInstructions='x'.repeat(1048576);return prepared;};
  f.provider.invoke=(...args)=>{invocations++;return invoke(...args);};
  f.observe();const worker=new MemoryWorker(f.memory,{provider:labor.provider('memory',f.provider)});f.workers.push(worker);worker.wake();
  const packet=await until(f.memory,f.session,()=>worker.status().state==='unavailable');await worker.running;
  assert.equal(invocations,0);assert.equal(f.memory.active(),undefined);assert.equal(packet.pending[0].status,'pending');assert.equal(packet.processedThrough,0);
  assert.equal(labor.holder,undefined);assert.equal(labor.preparing,undefined);assert.equal(f.provider.native,undefined);
  assert.equal(readdirSync(join(f.root,'runtime/session-memory-native')).filter(x=>x.startsWith('instance-')).length,0);
  assert.equal(readdirSync(join(f.root,'runtime/session-memory-native/jobs')).length,0);
});

test('encoded native evidence fits its reserved journal and invalid control output remains explicitly recoverable',async t=>{
  const f=fixture(t,'encoded-control-output');let observedBytes;
  const invoke=f.provider.invoke.bind(f.provider);f.provider.invoke=async(...args)=>{const result=await invoke(...args);observedBytes=statSync(f.provider.jobPath(args[0].id)).size;return result;};
  f.observe();const worker=new MemoryWorker(f.memory,{provider:f.provider});f.workers.push(worker);worker.wake();
  const packet=await until(f.memory,f.session,value=>value.processedThrough===1||worker.status().state==='unknown');await worker.running;
  assert.equal(packet.processedThrough,1);assert.equal(packet.gaps[0].error.code,'OUTPUT_INVALID');assert.equal(observedBytes>393216,true);assert.equal(observedBytes<=524288,true);
  const list=f.memory.readAssessments({session:f.session}),id=list.assessments[0].assessmentId,detail=f.memory.readAssessments({session:f.session,assessmentId:id,maximumBytes:262144});
  assert.equal(detail.assessment.nativeOutput.availability,'retained');assert.equal(detail.omittedParts.includes('rawOutput'),true);
  const selected=f.memory.readAssessments({session:f.session,assessmentId:id,part:'rawOutput',bodyRange:{offset:0,byteLength:1000}});
  assert.equal(selected.part.body,'\0'.repeat(1000));assert.equal(selected.part.wholeDigest,bytesDigest('\0'.repeat(65536)));assert.equal(selected.part.selectedDigest,bytesDigest('\0'.repeat(1000)));
});


test('profile5 retained completion settles after renderer upgrade without redispatching or rewriting its historical input',async t=>{
  const f=fixture(t);f.provider.assessment={...f.provider.assessment,id:'codex-memory/app-server-v2/5',version:5,render:d=>renderMemoryInput(d.request,memoryPrompt,'moment-memory-input/1')};f.observe();
  const dispatch=f.memory.claim(await f.provider.ready()),legacy=renderMemoryInput(dispatch.request,memoryPrompt,'moment-memory-input/1');
  f.memory.transaction(()=>f.memory.continuity.prepare(dispatch,{kind:'moment-memory',version:1,renderer:'moment-memory-input/1',prompt:memoryPrompt,outputSchema:memoryOutputSchema},legacy));
  const preparation=f.provider.prepare(dispatch);f.memory.prepareProfile(dispatch.id,preparation);dispatch.nativePreparation=preparation;
  await f.provider.invoke(dispatch,new AbortController().signal);await f.provider.close();
  const upgraded=new CodexMemoryProvider(f.root,{credentialFile:f.credentialFile,binary:f.binary});t.after(()=>upgraded.close());
  assert.equal(f.memory.active().nativePreparation,undefined,'Native preparation must be recovered from retained assessment evidence, not this process-local dispatch');
  assert.throws(()=>upgraded.recover(f.memory.active()),{code:'UNSUPPORTED_VERSION'});
  upgraded.ready=()=>{throw Error('Recovery must not prepare another native inference');};
  const worker=new MemoryWorker(f.memory,{provider:upgraded,recover:true});f.workers.push(worker);worker.wake();await until(f.memory,f.session,p=>p.processedThrough===1);await worker.running;assert.equal(upgraded.native,undefined);
  const detail=f.memory.readAssessments({session:f.session,assessmentId:dispatch.id,maximumBytes:262144});assert.equal(detail.assessment.renderedInput,legacy);assert.equal(detail.assessment.nativeProfile.version,5);assert.equal(detail.assessment.outcome.receipt.provider.id,'codex-memory/app-server-v2/5');
  assert.equal(JSON.parse(readFileSync(join(f.root,'runtime/session-memory-native/jobs',dispatch.id+'.json'),'utf8')).state,'committed');
});
