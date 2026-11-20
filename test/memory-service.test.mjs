import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readdirSync,writeFileSync,readFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {serve} from '../runtime/server.mjs';
import {openHome} from '../runtime/home.mjs';
import {createClient} from '../runtime/client.mjs';
import {createManaged} from '../runtime/managed.mjs';
import {issueCredential} from '../runtime/credentials.mjs';
import {exposedOperations} from '../runtime/bindings.mjs';
import {memoryHookDefinitions} from '../runtime/memory-commands.mjs';

const session=()=>({runtimeId:'test-codex',sessionId:randomUUID()});
const input=(s,text)=>({session:s,deliveryId:randomUUID(),message:{text,authorship:'human'}});
const output=dispatch=>({kind:'replace',explanation:'Scripted fixture assessment.',entries:[{sourceId:dispatch.request.incomingSourceIds.at(-1),weight:0.8,note:'Scripted fixture selection; no semantic model claim.'}]});
function run(root,args,stdin,t) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[new URL('../runtime/cli.mjs',import.meta.url).pathname,...args],{env:{...process.env,MOMENT_HOME:root},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);
    const timer=setTimeout(()=>{child.kill();reject(Error('Owned memory CLI timed out: '+stderr));},10000);
    child.once('exit',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});child.stdin.end(stdin??'');
    t.after(()=>{if(child.exitCode===null && child.signalCode===null)child.kill();});
  });
}
function nativeHook(root,s,event,t){
  const command=memoryHookDefinitions(s.runtimeId,join(root,'native'),root).hooks[event.hook_event_name][0].hooks[0].command;
  return new Promise((resolve,reject)=>{
    const child=spawn('/bin/sh',['-c',command],{env:{...process.env,MOMENT_HOME:root},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
    child.stdout.on('data',part=>stdout+=part);child.stderr.on('data',part=>stderr+=part);child.once('error',reject);child.once('exit',code=>resolve({code,stdout,stderr}));child.stdin.end(JSON.stringify(event));
    t.after(()=>{if(child.exitCode===null && child.signalCode===null)child.kill();});
  });
}
async function fixture(t,provider) {
  const directory=mkdtempSync(join(tmpdir(),'mm-')),home=openHome({home:directory,override:join(directory,'s')});
  let server=await serve(home.root,home.registry.systemId,{memoryProvider:provider});
  t.after(async()=>{await server.close();rmSync(directory,{recursive:true,force:true});});
  return {root:home.root,client:createClient(home.root),async restart(nextProvider){await server.close();server=await serve(home.root,home.registry.systemId,{memoryProvider:nextProvider});}};
}
async function until(client,s,predicate) {
  const deadline=performance.now()+5000;
  do {
    const result=await client.call('memory.read',{session:s});assert.equal(result.ok,true,JSON.stringify(result));
    if(predicate(result.value)) return result.value;
    await new Promise(resolve=>setTimeout(resolve,10));
  } while(performance.now()<deadline);
  throw Error('Confirmed owned service did not reach the expected memory state');
}

test('authenticated service and managed read share exact cache/coverage; internal writes and delegates stay separate',async t=>{
  let readyCalls=0,invocations=0;
  const provider={async ready(){readyCalls++;return {id:'owned-fixture',model:'scripted'};},async invoke(dispatch){invocations++;return {output:output(dispatch)};}};
  const {root,client}=await fixture(t,provider),s=session();
  const empty=await client.call('memory.read',{session:s});assert.equal(empty.ok,true);assert.equal(empty.value.exists,false);assert.equal(invocations,0);assert.equal(readyCalls,0);
  const observed=await client.call('memory.observe',input(s,'Maybe preserve this exact proposal.'));assert.equal(observed.ok,true,JSON.stringify(observed));
  const packet=await until(client,s,value=>value.processedThrough===1);assert.equal(packet.sources[0].text,'Maybe preserve this exact proposal.');assert.equal(packet.lastAssessment.explanation,'Scripted fixture assessment.');assert.equal(packet.lastAssessment.sequence,1);assert.equal(invocations,1);
  const managed=createManaged({root}),read=await managed.call('memory.read',{session:s});assert.equal(read.ok,true,JSON.stringify(read));assert.equal(read.value.cacheRevision,packet.cacheRevision);assert.deepEqual(read.value.lastAssessment,packet.lastAssessment);
  const assessmentInput={session:s,assessmentId:packet.lastAssessment.dispatchId,maximumBytes:262144};
  const history=await client.call('memory.assessments.read',assessmentInput);assert.equal(history.ok,true,JSON.stringify(history));assert.deepEqual(history.value.assessment.incomingSourceIds,observed.value.sourceIds);
  assert.equal(history.value.assessment.request.sources[0].text,'Maybe preserve this exact proposal.');
  const projected=await managed.call('memory.assessments.read',assessmentInput);assert.equal(projected.ok,true,JSON.stringify(projected));assert.deepEqual(projected.value,history.value);
  const human=await run(root,['memory','assessments','--file','-','--json'],JSON.stringify(assessmentInput),t);assert.equal(human.code,0,human.stderr);assert.deepEqual(JSON.parse(human.stdout).value,history.value);
  const listing=await run(root,['memory','assessments','--runtime',s.runtimeId,'--session',s.sessionId,'--json'],undefined,t);assert.equal(listing.code,0,listing.stderr);assert.equal(JSON.parse(listing.stdout).value.assessments[0].assessmentId,packet.lastAssessment.dispatchId);
  assert.equal((await managed.call('memory.observe',input(s,'Not an exposed MCP operation.'))).error.code,'FORBIDDEN');
  for(const operation of ['memory.observe','memory.rebuild','memory.cancel','memory.reconcile']) assert.equal(exposedOperations('operator').includes(operation),false);
  const credentialFile=issueCredential(root,randomUUID(),{}),delegate=createClient(root,{credentialFile});
  assert.equal((await delegate.call('memory.read',{session:s})).error.code,'FORBIDDEN');assert.equal((await delegate.call('memory.observe',input(s,'Unadmitted delegate.'))).error.code,'FORBIDDEN');
  assert.equal((await delegate.call('memory.assessments.read',assessmentInput)).error.code,'FORBIDDEN');
  await client.call('memory.read',{session:s});assert.equal(invocations,1);assert.equal(readyCalls,1);
});

test('unavailable provider retains pending input and reads do not retry qualification',async t=>{
  let attempts=0;const {client}=await fixture(t,{async ready(){attempts++;throw Error('Fixture has no supported authentication');},async invoke(){throw Error('Must not invoke');}}),s=session();
  assert.equal((await client.call('memory.observe',input(s,'Current steering remains in the native conversation.'))).ok,true);
  const packet=await until(client,s,value=>value.worker.state==='unavailable');assert.equal(packet.pending.length,1);assert.equal(packet.cacheRevision,0);
  for(let i=0;i<3;i++) assert.equal((await client.call('memory.read',{session:s})).ok,true);
  assert.equal((await client.call('memory.assessments.read',{session:s})).ok,true);
  assert.equal(attempts,1);
});

test('native, managed and CLI focus share guarded state without enabling memory or starting inference',async t=>{
  let calls=0;
  const {root,client}=await fixture(t,{async ready(){calls++;return {id:'unused-focus-provider',model:'scripted'};},async invoke(){throw Error('Focus must not invoke a checker');}}),s=session(),managed=createManaged({root});
  const request={session:s,expectedFocusRevision:0,idempotencyKey:'focus-related',action:{kind:'select',purposeKey:'bounded-aside',purpose:'An uncertain-duration aside.',returnPoint:'Return to the original purpose.'}};
  const focus=await managed.call('memory.focus',request);assert.equal(focus.ok,true,JSON.stringify(focus));assert.equal(focus.value.focus.revision,1);
  let packet=(await client.call('memory.read',{session:s,includeWorkingSets:true})).value;
  assert.equal(packet.focus.workingSetId,focus.value.focus.workingSetId);assert.equal(packet.workingSets.length,2);assert.equal(packet.subscription.enabled,false);assert.equal(calls,0);
  const original=packet.workingSets.find(x=>x.purposeKey==='default');
  assert.equal((await client.call('memory.focus',{session:s,expectedFocusRevision:1,idempotencyKey:'return-default',action:{kind:'select',purposeKey:'default'}})).ok,true);
  const replay=await run(root,['memory','focus','--file','-','--json'],JSON.stringify(request),t);assert.equal(replay.code,0,replay.stderr);assert.equal(JSON.parse(replay.stdout).value.replayed,true);
  packet=(await client.call('memory.read',{session:s})).value;assert.equal(packet.focus.workingSetId,original.id);assert.equal(calls,0);
  const viewed=await run(root,['memory','read','--runtime',s.runtimeId,'--session',s.sessionId,'--working-set',focus.value.focus.workingSetId,'--sets','--json'],undefined,t);
  assert.equal(viewed.code,0,viewed.stderr);const selected=JSON.parse(viewed.stdout).value;assert.equal(selected.focus.workingSetId,original.id);assert.equal(selected.workingSet.purposeKey,'bounded-aside');
  assert.equal((await client.call('memory.focus',{...request,idempotencyKey:'unavailable-source',expectedFocusRevision:2,action:{kind:'select',purposeKey:'unavailable',basisSourceIds:['unassociated-original']}})).error.code,'NOT_FOUND');
  const credentialFile=issueCredential(root,randomUUID(),{}),delegate=createClient(root,{credentialFile});assert.equal((await delegate.call('memory.focus',request)).error.code,'FORBIDDEN');
  assert.equal((await client.call('memory.focus',{...request,expectedFocusRevision:0,idempotencyKey:'stale'})).error.code,'REVISION_CONFLICT');
  assert.equal((await client.call('memory.read',{session:s})).value.focus.revision,2);assert.equal(calls,0);assert.equal(readdirSync(join(root,'runtime/session-memory-focus')).length,0);
});

test('a working set binds existing work without adopting a project or enabling a checker',async t=>{
  const {root,client}=await fixture(t),s=session(),contextId=randomUUID();
  const description=await client.call('system.describe',{protocolVersion:'0.1'});assert.equal(description.ok,true);
  const created=await client.call('context.create',{id:contextId,idempotencyKey:randomUUID(),label:'Owned work binding',bootstrapProfile:'owner-local',limits:{concurrentExecutions:1,cpuMillis:10000,memoryBytes:10000,outputBytes:10000,modelTokens:0,apiSpendMicrounits:0,currency:'USD'}});assert.equal(created.ok,true);
  const target={systemId:description.value.systemId,contextId};
  const focused=await client.call('memory.focus',{session:s,expectedFocusRevision:0,idempotencyKey:'bind-existing-work',action:{kind:'select',purposeKey:'default',work:target}});
  assert.equal(focused.ok,true,JSON.stringify(focused));
  const packet=await client.call('memory.read',{session:s});assert.equal(packet.ok,true);
  assert.deepEqual(packet.value.bindings.work.target,target);assert.equal(packet.value.bindings.work.contextState,'open');assert.equal(packet.value.subscription.enabled,false);
  assert.equal((await client.call('memory.configure',{session:s,expectedRevision:0,idempotencyKey:'bind-hook-on',enabled:true})).ok,true);
  const restored=await nativeHook(root,s,{session_id:s.sessionId,hook_event_name:'SessionStart',source:'resume'},t);assert.equal(restored.code,0,restored.stderr);
  const text=JSON.parse(restored.stdout).hookSpecificOutput?.additionalContext;assert.ok(text,'A default working set with a real work binding is meaningful focus');
  const map=JSON.parse(text.slice(text.indexOf('\n')+1));assert.deepEqual(map.bindings.work.target,target);assert.ok(Buffer.byteLength(text)<=4096);
});

test('operator limit reload preserves pending work and its original target across an owned service restart',async t=>{
  let invocations=0;const provider={async ready(){return {id:'owned-limit-recovery',model:'scripted'};},async invoke(dispatch){invocations++;return {output:output(dispatch)};}};
  const {root,client,restart}=await fixture(t,provider),s=session(),path=join(root,'runtime/session-memory-limits.json');
  writeFileSync(path,JSON.stringify({formatVersion:1,limits:{maxProfileBytes:1,maxAutomaticBytes:1536}}),{mode:0o600});await restart(provider);
  const admitted=await client.call('memory.observe',input(s,'Keep this input pending until its evidence budget is restored.'));assert.equal(admitted.ok,true);
  let packet=await until(client,s,value=>value.worker.state==='unavailable');assert.equal(packet.presentation.maximumBytes,1536);assert.equal(packet.pending[0].status,'pending');assert.equal(invocations,0);
  const original=packet.focus.workingSetId,aside=await client.call('memory.focus',{session:s,expectedFocusRevision:0,idempotencyKey:'limit-aside',action:{kind:'select',purposeKey:'aside'}});assert.equal(aside.ok,true);
  writeFileSync(path,JSON.stringify({formatVersion:1,limits:{maxAutomaticBytes:2048}}),{mode:0o600});await restart(provider);
  packet=await until(client,s,value=>value.processedThrough===1);assert.equal(invocations,1);assert.equal(packet.presentation.maximumBytes,2048);assert.equal(packet.focus.workingSetId,aside.value.focus.workingSetId);assert.deepEqual(packet.entries,[]);
  const recovered=await client.call('memory.read',{session:s,workingSetId:original});assert.equal(recovered.ok,true);assert.equal(recovered.value.entries[0].sourceId,admitted.value.sourceIds[0]);assert.equal(packet.subscription.enabled,false);
});

test('uncertain provider completion persists through an actual service restart and resumes only after reconciliation',async t=>{
  let calls=0;const broken={async ready(){return {id:'uncertain-fixture',model:'scripted'};},async invoke(){calls++;throw Error('Fixture lost a result');}};
  const {client,restart}=await fixture(t,broken),s=session();await client.call('memory.observe',input(s,'First source.'));
  let packet=await until(client,s,value=>value.pending[0]?.status==='unknown');const dispatchId=packet.pending[0].dispatchId;assert.ok(dispatchId);
  await restart({async ready(){return {id:'restarted-fixture',model:'scripted'};},async invoke(dispatch){calls++;return {output:output(dispatch)};}});
  packet=(await client.call('memory.read',{session:s})).value;assert.equal(packet.pending[0].dispatchId,dispatchId);assert.equal(packet.worker.state,'unknown');assert.equal(calls,1);
  await client.call('memory.observe',input(s,'Second source.'));assert.equal(calls,1);
  const resolution=await client.call('memory.reconcile',{dispatchId,resolution:{kind:'cancelled',evidence:'Owned fixture confirms no checker result is available and its request has terminated.'}});assert.equal(resolution.ok,true,JSON.stringify(resolution));
  packet=await until(client,s,value=>value.processedThrough===2);assert.equal(packet.gapCount,1);assert.equal(packet.sources[0].text,'Second source.');assert.equal(calls,2);
});

test('session-scoped hooks ignore other sessions before store access and preserve the selected native identity',async t=>{
  const {root,client}=await fixture(t),s=session(),unused=join(root,'unselected-store');
  assert.equal((await client.call('memory.configure',{session:s,expectedRevision:0,idempotencyKey:randomUUID(),enabled:true})).ok,true);
  const generated=await run(unused,['memory','hooks','--runtime',s.runtimeId,'--session',s.sessionId],undefined,t);
  assert.equal(generated.code,0,generated.stderr);assert.equal(existsSync(unused),false);
  const definitions=JSON.parse(generated.stdout);
  for(const groups of Object.values(definitions.hooks))for(const group of groups)for(const hook of group.hooks)assert.ok(hook.command.includes('"sessionId":"'+s.sessionId+'"'));
  const event={session_id:'another-session',hook_event_name:'UserPromptSubmit',prompt:'Leave this other session untouched.'};
  const skipped=await run(unused,['memory','hook','--runtime',s.runtimeId,'--session',s.sessionId],JSON.stringify(event),t);
  assert.equal(skipped.code,0,skipped.stderr);assert.equal(skipped.stderr,'');assert.deepEqual(JSON.parse(skipped.stdout),{});assert.equal(existsSync(unused),false);
  const selected=await run(root,['memory','hook','--runtime',s.runtimeId,'--session',s.sessionId],JSON.stringify({...event,session_id:s.sessionId}),t);
  assert.equal(selected.code,0,selected.stderr);const packet=(await client.call('memory.read',{session:s})).value;
  assert.equal(packet.observedThrough,1);assert.equal(packet.pending.length,1);assert.equal(packet.pending[0].sequence,1);
  assert.equal((await client.call('memory.read',{session:{...s,sessionId:'another-session'}})).value.exists,false);
});

test('hook CLI queues without waiting on a blocked checker and restores completed memory on compact/resume',async t=>{
  let release;const gate=new Promise(resolve=>release=resolve);
  const {root,client}=await fixture(t,{async ready(){return {id:'held-fixture',model:'scripted'};},async invoke(dispatch){await gate;return {output:output(dispatch)};}}),s=session();t.after(()=>release());
  assert.equal((await client.call('memory.configure',{session:s,expectedRevision:0,idempotencyKey:randomUUID(),enabled:true})).ok,true);
  const preview=await run(join(root,'unused'),['memory','hooks','--runtime',s.runtimeId],undefined,t);assert.equal(preview.code,0,preview.stderr);assert.equal(existsSync(join(root,'unused')),false);
  const definitions=JSON.parse(preview.stdout);assert.ok(definitions.hooks.UserPromptSubmit[0].hooks[0].command.includes('memory'));assert.ok(definitions.hooks.SessionStart[0].matcher.includes('compact'));
  const nativeEvent={session_id:s.sessionId,hook_event_name:'UserPromptSubmit',turn_id:'turn-one',prompt:'Possibly a cache—keep this as a proposal.',cwd:'/owned/fixture'};
  const submitted=await run(root,['memory','hook','--runtime',s.runtimeId],JSON.stringify(nativeEvent),t);assert.equal(submitted.code,0,submitted.stderr);assert.equal(submitted.stderr,'');
  const submittedText=JSON.parse(submitted.stdout).hookSpecificOutput.additionalContext;
  const submittedMap=JSON.parse(submittedText.slice(submittedText.indexOf('\n')+1));assert.equal(submittedMap.coverage.pending,1);assert.equal(submittedMap.coverage.processedThrough,0);assert.deepEqual(submittedMap.entries,[]);
  let packet=(await client.call('memory.read',{session:s})).value;assert.equal(packet.observedThrough,1);assert.equal(packet.processedThrough,0);assert.equal(packet.pending.length,1);
  assert.deepEqual(readdirSync(join(root,'runtime/session-memory-intake')),[]);
  release();await until(client,s,value=>value.processedThrough===1);
  for(const source of ['compact','resume']) {
    const restored=await run(root,['memory','hook','--runtime',s.runtimeId],JSON.stringify({session_id:s.sessionId,hook_event_name:'SessionStart',source}),t);
    assert.equal(restored.code,0,restored.stderr);const hook=JSON.parse(restored.stdout);assert.equal(hook.hookSpecificOutput.hookEventName,'SessionStart');assert.ok(hook.hookSpecificOutput.additionalContext.includes(nativeEvent.prompt));
  }
  const child=await run(root,['memory','hook','--runtime',s.runtimeId],JSON.stringify({...nativeEvent,agent_id:'child'}),t);assert.deepEqual(JSON.parse(child.stdout),{});
  assert.equal((await client.call('memory.read',{session:s})).value.observedThrough,1);
  const invalid=await run(root,['memory','hook','--runtime',s.runtimeId],'not json',t);assert.equal(invalid.code,0);assert.ok(JSON.parse(invalid.stdout).systemMessage.includes('current conversation can continue'));
});

test('automatic map fits its complete byte budget while explicit reads recover the whole original',async t=>{
  let invocations=0;
  const provider={async ready(){return {id:'bounded-map-fixture',model:'scripted'};},async invoke(dispatch){invocations++;return {output:output(dispatch)};}};
  const {root,client,restart}=await fixture(t,provider),s=session();
  const original='Keep this conditional wording exactly: “only for this release 🍃.”\n'.repeat(180);
  const admitted=await client.call('memory.observe',input(s,original));assert.equal(admitted.ok,true);
  await until(client,s,value=>value.processedThrough===1);
  assert.equal((await client.call('memory.configure',{session:s,expectedRevision:0,idempotencyKey:randomUUID(),enabled:true})).ok,true);
  const restored=await nativeHook(root,s,{session_id:s.sessionId,hook_event_name:'SessionStart',source:'compact'},t);
  assert.equal(restored.code,0,restored.stderr);
  const text=JSON.parse(restored.stdout).hookSpecificOutput.additionalContext;
  assert.ok(Buffer.byteLength(text)<=4096,'The complete automatic context, including its preface, exceeds 4 KiB');
  const map=JSON.parse(text.slice(text.indexOf('\n')+1));
  assert.deepEqual(map.session,s);assert.equal(map.coverage.processedThrough,1);assert.equal(map.entries[0].sourceId,admitted.value.sourceIds[0]);
  assert.equal(map.omitted.sourceBodies,1);assert.equal(map.sources.length,0);
  const recovered=await client.call('memory.read',{session:map.session,sourceIds:[map.entries[0].sourceId],maximumBytes:262144});
  assert.equal(recovered.ok,true);assert.equal(recovered.value.sources[0].text,original);assert.equal(invocations,1);
  for(const maximumBytes of [1024,1536]){
    writeFileSync(join(root,'runtime/session-memory-limits.json'),JSON.stringify({formatVersion:1,limits:{maxAutomaticBytes:maximumBytes}}),{mode:0o600});await restart(provider);
    const hook=await nativeHook(root,s,{session_id:s.sessionId,hook_event_name:'SessionStart',source:'resume'},t);assert.equal(hook.code,0,hook.stderr);
    const context=JSON.parse(hook.stdout).hookSpecificOutput?.additionalContext;assert.ok(context,hook.stdout);assert.ok(Buffer.byteLength(context)<=maximumBytes);assert.equal(invocations,1);
  }
});

test('automatic map exposes the last rejected input and meaningful focus even with an empty cache',async t=>{
  let invocations=0;
  const {root,client}=await fixture(t,{async ready(){return {id:'rejected-map-fixture',model:'scripted'};},async invoke(){invocations++;return {output:{kind:'unchanged',explanation:'Fixture deliberately retains no message; no quality claim.'}};}}),s=session();
  const admitted=await client.call('memory.observe',input(s,'A narrow conditional request must remain recoverable even if not selected.'));assert.equal(admitted.ok,true);
  const packet=await until(client,s,value=>value.processedThrough===1);assert.deepEqual(packet.entries,[]);
  assert.equal((await client.call('memory.configure',{session:s,expectedRevision:0,idempotencyKey:randomUUID(),enabled:true})).ok,true);
  let restored=await nativeHook(root,s,{session_id:s.sessionId,hook_event_name:'SessionStart',source:'resume'},t);
  let text=JSON.parse(restored.stdout).hookSpecificOutput?.additionalContext;assert.ok(text,'A rejected input still needs an assessment recovery handle');
  let map=JSON.parse(text.slice(text.indexOf('\n')+1));assert.equal(map.lastAssessment.dispatchId,packet.lastAssessment.dispatchId);assert.deepEqual(map.lastAssessment.incomingSourceIds,admitted.value.sourceIds);
  const focused=await client.call('memory.focus',{session:s,expectedFocusRevision:0,idempotencyKey:'map-aside',action:{kind:'select',purposeKey:'aside',purpose:'Investigate briefly; duration unknown.',returnPoint:'Return to the original conditional request.'}});assert.equal(focused.ok,true);
  restored=await nativeHook(root,s,{session_id:s.sessionId,hook_event_name:'SessionStart',source:'resume'},t);
  text=JSON.parse(restored.stdout).hookSpecificOutput?.additionalContext;assert.ok(text);
  map=JSON.parse(text.slice(text.indexOf('\n')+1));assert.equal(map.focus.workingSetId,focused.value.focus.workingSetId);assert.equal(map.workingSet.returnPoint,'Return to the original conditional request.');assert.equal(map.activeAssessment,null);
  assert.equal(map.lastAssessment.dispatchId,packet.lastAssessment.dispatchId);assert.equal(invocations,1);
});

test('unavailable optional memory storage preserves its bytes while ordinary Moment operations remain usable',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'mm-')),home=openHome({home:directory,override:join(directory,'s')}),runtime=join(home.root,'runtime');mkdirSync(runtime,{mode:0o700});
  const filename=join(runtime,'session-memory.sqlite'),bytes=Buffer.from('Unknown retained component data; do not reset.');writeFileSync(filename,bytes,{mode:0o600});
  const server=await serve(home.root,home.registry.systemId);t.after(async()=>{await server.close();rmSync(directory,{recursive:true,force:true});});
  const client=createClient(home.root),s=session();assert.equal((await client.call('system.describe',{protocolVersion:'0.1'})).ok,true);
  const read=await client.call('memory.read',{session:s});assert.equal(read.ok,false);assert.equal(read.error.code,'CAPABILITY_UNAVAILABLE');
  assert.equal((await client.call('memory.observe',input(s,'No replacement of unknown data.'))).error.code,'CAPABILITY_UNAVAILABLE');assert.deepEqual(readFileSync(filename),bytes);
});

test('ordinary authorized configuration, global hooks and off state keep identity and inference separate',async t=>{
  let invocations=0,qualifications=0;
  const {root,client}=await fixture(t,{async ready(){qualifications++;return {id:'enabled-fixture',model:'scripted'};},async invoke(dispatch){invocations++;return {output:output(dispatch)};}}),s=session();
  const managed=createManaged({root});
  const empty=(await client.call('memory.read',{session:s})).value;
  assert.equal(empty.subscription.enabled,false);assert.equal(empty.automation.state,'off');
  const event={session_id:s.sessionId,hook_event_name:'UserPromptSubmit',prompt:'Retain this exact local preference.'};
  const skipped=await run(root,['memory','hook','--runtime',s.runtimeId],JSON.stringify(event),t);
  assert.deepEqual(JSON.parse(skipped.stdout),{});assert.equal((await client.call('memory.read',{session:s})).value.exists,false);
  assert.equal(invocations,0);assert.equal(qualifications,0);
  const request={session:s,expectedRevision:0,idempotencyKey:randomUUID(),enabled:true};
  const configured=await managed.call('memory.configure',request);assert.equal(configured.ok,true,JSON.stringify(configured));
  assert.equal(configured.value.subscription.revision,1);assert.equal(invocations,0);assert.equal(qualifications,0);
  assert.equal((await client.call('memory.read',{session:s})).value.automation.state,'awaiting-input');
  const credentialFile=issueCredential(root,randomUUID(),{}),delegate=createClient(root,{credentialFile});
  assert.equal((await delegate.call('memory.configure',request)).error.code,'FORBIDDEN');
  const observed=await nativeHook(root,s,event,t);assert.equal(observed.code,0,observed.stderr);
  let packet=await until(client,s,x=>x.processedThrough===1);assert.equal(packet.automation.state,'input-observed');assert.equal(invocations,1);
  const hint=readFileSync(join(root,'runtime/session-memory-enrollment.json'));
  const off=await run(root,['memory','off','--runtime',s.runtimeId,'--session',s.sessionId,'--json'],undefined,t);
  assert.equal(off.code,0,off.stderr);assert.equal(JSON.parse(off.stdout).value.subscription.enabled,false);
  // A stale/forged hint cannot authorize capture or presentation after disable.
  writeFileSync(join(root,'runtime/session-memory-enrollment.json'),hint);
  const after=await run(root,['memory','hook','--runtime',s.runtimeId],JSON.stringify({...event,prompt:'Do not capture this later input.'}),t);
  assert.deepEqual(JSON.parse(after.stdout),{});
  packet=(await client.call('memory.read',{session:s})).value;
  assert.equal(packet.observedThrough,1);assert.equal(packet.entries.length,1);assert.equal(invocations,1);
  // Historical configuration replay must republish current off, never old on.
  assert.equal((await client.call('memory.configure',request)).value.replayed,true);
  assert.deepEqual(JSON.parse(readFileSync(join(root,'runtime/session-memory-enrollment.json'))).enabled,[]);
  const on=await run(root,['memory','on','--runtime',s.runtimeId,'--session',s.sessionId,'--json'],undefined,t);
  assert.equal(on.code,0,on.stderr);assert.equal(JSON.parse(on.stdout).value.subscription.revision,3);
  assert.equal((await client.call('memory.read',{session:s})).value.automation.state,'awaiting-input');assert.equal(invocations,1);
  assert.equal((await client.call('memory.read',{session:{...s,sessionId:randomUUID()}})).value.subscription.enabled,false);
});

test('global disabled hook avoids transcript access and does not start a service',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'moment-hook-off-')),home=openHome({home:directory,override:join(directory,'s')});
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const event={session_id:randomUUID(),hook_event_name:'UserPromptSubmit',transcript_path:'/unreadable/unselected',prompt:'Unenrolled input.'};
  const skipped=await nativeHook(home.root,{runtimeId:'codex'},event,t);
  assert.deepEqual(JSON.parse(skipped.stdout),{});assert.equal(existsSync(join(home.root,'runtime/store.sqlite')),false);assert.equal(existsSync(join(home.root,'runtime/owner.json')),false);
});

test('committed configuration with publication failure retains exact retry and later repairs projection',async t=>{
  const {root,client}=await fixture(t),s=session(),path=join(root,'runtime/session-memory-enrollment.json');
  unlinkSync(path);mkdirSync(path);
  const request={session:s,expectedRevision:0,idempotencyKey:randomUUID(),enabled:true};
  const failed=await client.call('memory.configure',request);assert.equal(failed.error.code,'OUTCOME_UNKNOWN');assert.equal(failed.error.retry,'reconcile');
  let packet=(await client.call('memory.read',{session:s})).value;assert.equal(packet.subscription.enabled,true);assert.equal(packet.automation.state,'unavailable');
  rmSync(path,{recursive:true});
  const retry=await client.call('memory.configure',request);assert.equal(retry.ok,true,JSON.stringify(retry));assert.equal(retry.value.replayed,true);
  packet=(await client.call('memory.read',{session:s})).value;assert.equal(packet.subscription.revision,1);assert.equal(packet.automation.state,'awaiting-input');
  assert.equal(JSON.parse(readFileSync(path)).enabled[0].session.sessionId,s.sessionId);
});

test('CLI prepares a bounded native-history rebuild without starting Moment, then admits its exact reviewed input',async t=>{
  const {root,client}=await fixture(t,{async ready(){return {id:'history-fixture',model:'scripted'};},async invoke(dispatch){return {output:output(dispatch)};}}),s=session();
  const codexHome=join(root,'selected-native'),sessions=join(codexHome,'sessions');mkdirSync(sessions,{recursive:true,mode:0o700});
  const transcriptPath=join(sessions,'selected.jsonl'),sessionId='earlier-owned-session';
  writeFileSync(transcriptPath,[{type:'session_meta',payload:{id:sessionId,cli_version:'0.169.0'}},{type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'Proposal: preserve original evidence.'}]}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Yes, keep it tentative.'}]},metadata:{client_authored:true}}].map(frame=>JSON.stringify(frame)+'\n').join(''),{mode:0o600});
  const unused=join(root,'unused'),prepared=await run(unused,['memory','select','--file','-','--codex-home',codexHome,'--runtime',s.runtimeId,'--json'],JSON.stringify({session:s,expectedRevision:0,selections:[{transcriptPath,sessionId}]}),t);
  assert.equal(prepared.code,0,prepared.stderr);assert.equal(existsSync(unused),false);const result=JSON.parse(prepared.stdout);assert.equal(result.ok,true);assert.equal(result.value.input.captures[0].message.text,'Yes, keep it tentative.');
  const admitted=await run(root,['memory','rebuild','--file','-','--json'],JSON.stringify(result.value.input),t);assert.equal(admitted.code,0,admitted.stderr);assert.equal(JSON.parse(admitted.stdout).ok,true);
  const packet=await until(client,s,value=>value.processedThrough===1);assert.equal(packet.sources.length,2);assert.equal(packet.sources.find(source=>source.origin==='selected-history').session.sessionId,sessionId);
  const invalid=await run(unused,['memory','status','--file','-','--json'],'{}',t);assert.equal(invalid.code,1);assert.equal(JSON.parse(invalid.stdout).error.code,'INVALID_ARGUMENT');assert.equal(invalid.stderr,'');assert.equal(existsSync(unused),false);
});
