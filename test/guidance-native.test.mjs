import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,realpathSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setup,schema,grant,incident,allowDelegated,delegated} from './helpers.mjs';
import {GuidanceBodies} from '../runtime/guidance.mjs';
import {GuidanceRuntime} from '../runtime/guidance-runtime.mjs';
import {CodexMemoryProvider} from '../runtime/codex-memory.mjs';
import {NativeLabor} from '../runtime/native-labor.mjs';
import {guidanceNativeProfile,guidanceInputDocument,guidanceOutputDocument,guidanceInputSchema,guidanceOutputSchema,guidanceFeatures,guidanceCapabilityName,anchorQuotation,decodeGuidanceOutput} from '../runtime/guidance-profile.mjs';
const envelope={concurrentExecutions:1,cpuMillis:300000,memoryBytes:268435456,outputBytes:1048576,modelTokens:100000,apiSpendMicrounits:0,currency:'USD'},jobLimits={...envelope,cpuMillis:10000,outputBytes:65536,modelTokens:5000};
const evidence={sources:[],artifactDigests:[],method:'owned test'};
async function fixture(t,scenario='normal') {
 const f=setup(t,{limits:envelope}),root=realpathSync(mkdtempSync(join(tmpdir(),'moment-guidance-native-')));
 const binary=join(root,'codex.mjs');writeFileSync(binary,'#!'+process.execPath+'\n'+readFileSync(new URL('./codex-guidance-fixture.mjs',import.meta.url)),{mode:0o700});
 const credentialFile=join(root,'access.json'),claims=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');writeFileSync(credentialFile,JSON.stringify({tokens:{access_token:'fixture.'+claims+'.signature',account_id:scenario,refresh_token:'UNSELECTED'}}),{mode:0o600});
 f.kernel.guidance.bodies=new GuidanceBodies(join(root,'bytes'));f.kernel.guidance.fileRoots=[root];
 const incidentId=randomUUID();assert.equal(f.write('incident.create',{id:incidentId,incident}).ok,true);
 const sourceId=randomUUID(),path=join(root,'guide.md'),definition={label:'Guide',locator:{kind:'file',path},selection:{kind:'whole'},locations:[root],classification:'private',evidence};writeFileSync(path,'Use pnpm. Keep task-specific scope.');
 assert.equal(f.write('guidance.register',{id:sourceId,definition,active:true}).ok,true);assert.equal(f.write('guidance.refresh',{sourceId}).ok,true);
 for(const [schema,document] of [[guidanceInputSchema,guidanceInputDocument],[guidanceOutputSchema,guidanceOutputDocument]])assert.equal(f.write('schema.publish',{schema,document}).ok,true);
 const cap=f.write('capability.advertise',{capability:{id:randomUUID(),providerId:f.ownerId,name:guidanceCapabilityName,version:'1',inputSchema:guidanceInputSchema,outputSchema:guidanceOutputSchema,features:guidanceFeatures,platform:{os:process.platform,architecture:process.arch},isolation:'process',reconciliation:'lookup',evidence,expiresAt:new Date(Date.now()+3600000).toISOString()}});assert.equal(cap.ok,true,JSON.stringify(cap));
 const snapshot=f.store.read(f.contextId),old=f.kernel.lookup(snapshot,snapshot.context.policy).value;
 const p=f.write('policy.publish',{policy:{...old,id:randomUUID(),parent:snapshot.context.policy,rules:[...old.rules,{id:'native-guidance-profile',effect:'permit',actions:[guidanceCapabilityName],when:old.rules[0].when}]}});assert.equal(f.write('policy.activate',{policy:p.value.ref,evidence}).ok,true);
 const source=f.store.read(f.contextId).controlState.guidanceSources[sourceId],capture=source.value.latest.capture;
 const g=grant(f,f.ownerId,{actions:['execution.request','guidance.review',guidanceCapabilityName],limits:envelope,resourceRefs:[cap.value.ref,source.ref,capture]});
 const engine=new CodexMemoryProvider(root,{binary,credentialFile,timeoutMillis:3000},guidanceNativeProfile()),slot=new NativeLabor(root),provider=slot.provider('guidance',engine),runtime=new GuidanceRuntime(f.kernel,root,{provider});
 const fault=runtime.fault.bind(runtime);let lastFault;runtime.fault=(context,execution,error)=>{lastFault=error;return fault(context,execution,error);};
 f.kernel.guidance.workerStatus=()=>runtime.status();
 t.after(async()=>{slot.close();await runtime.close();rmSync(root,{recursive:true,force:true});});
 const request={contextId:f.contextId,expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:randomUUID(),id:randomUUID(),incidentId,task:{description:'Fix the user-confirmed race without broadening the release scope.',location:root,sourceRefs:[]},capability:cap.value.ref,grant:g.ref,limits:jobLimits};
 return {f,root,sourceId,path,engine,slot,provider,runtime,request,async wait(predicate){const end=performance.now()+7000;while(performance.now()<end){const value=f.call('guidance.read',{contextId:f.contextId,executionId:request.id,maximumBytes:262144});assert.equal(value.ok,true,JSON.stringify(value));if(predicate(value.value))return value.value;await new Promise(r=>setTimeout(r,15));}throw Error('Owned guidance fixture did not reach expected state: '+JSON.stringify(runtime.status())+'\n'+lastFault?.stack);}};
}
test('native guidance uses existing execution receipts and anchors source text, with measured tokens and explicit unmeasured resources',async t=>{
 const x=await fixture(t);assert.equal(x.f.call('guidance.review',x.request).ok,true);x.runtime.wake();const packet=await x.wait(p=>p.execution?.state==='succeeded');await x.runtime.running;
 assert.equal(packet.assessment.candidates[0].quotes[0].status,'exact');assert.equal(packet.assessment.candidates[0].quotes[0].original,'Use pnpm.');assert.equal(packet.assessment.usage.modelTokens,30);
 assert.deepEqual(packet.execution.usage.unmeasured,['cpuMillis','memoryBytes']);assert.equal(packet.execution.usage.modelTokens,30);assert.equal(packet.freshness,'current-observation');assert.equal(x.slot.holder,undefined);
 assert.equal(x.f.kernel.executions.totals(x.f.store.read(x.f.contextId)).cpuMillis,10000);assert.equal(x.f.kernel.executions.totals(x.f.store.read(x.f.contextId)).memoryBytes,0);
 const dispatches=readdirSync(x.runtime.directory);assert.equal(dispatches.length,1);const d=JSON.parse(readFileSync(join(x.runtime.directory,dispatches[0]),'utf8'));assert.equal(d.settled,true);assert.equal(d.request.task.description,x.request.task.description);
 assert.equal(readFileSync(x.f.kernel.guidance.bodies.path(packet.assessment.rawDigest),'utf8').includes('user-confirmed'),true);
});
test('raw native invalid output is an observed failed result and never destroys registered guidance',async t=>{
 const x=await fixture(t,'invalid-output');x.f.call('guidance.review',x.request);x.runtime.wake();const p=await x.wait(p=>p.execution?.state==='failed');await x.runtime.running;
 assert.equal(p.execution.outcome.code,'OUTPUT_INVALID');assert.equal(p.captures[0].text,'Use pnpm. Keep task-specific scope.');assert.equal(x.slot.holder,undefined);
 const journal=JSON.parse(readFileSync(join(x.engine.directory,'jobs',readdirSync(join(x.engine.directory,'jobs'))[0]),'utf8'));assert.equal(journal.rawOutput,'not-json');
});
test('source changes during inference remain a stale historical result; reading and exact retry cannot rebase it',async t=>{
 const x=await fixture(t,'delay');x.f.call('guidance.review',x.request);x.runtime.wake();await x.wait(p=>p.execution?.state==='running');
 writeFileSync(x.path,'New whole source.');assert.equal(x.f.write('guidance.refresh',{sourceId:x.sourceId}).ok,true);
 const p=await x.wait(p=>p.execution?.state==='succeeded');assert.equal(p.freshness,'stale');assert.ok(p.staleReasons.some(s=>s.includes('latest observation')));
 const replay=x.f.call('guidance.review',x.request);assert.equal(replay.ok,true);assert.equal(replay.value.intent.input.captures[0].ref.id,p.execution.intent.input.captures[0].ref.id);
});
test('unknown native dispatch holds global capacity and recovers its completed lost acknowledgment without another turn',async t=>{
 const x=await fixture(t,'lose-ack-completed');x.f.call('guidance.review',x.request);x.runtime.wake();
 const p=await x.wait(p=>p.execution?.state==='succeeded');await x.runtime.running;
 assert.equal(p.execution.attempt,1);assert.equal(readdirSync(join(x.engine.directory,'jobs')).length,1);assert.equal(x.slot.holder,undefined);
});
test('missing native accounting remains explicit and reserves declared model capacity after an observed result',async t=>{
 const x=await fixture(t,'no-usage');x.f.call('guidance.review',x.request);x.runtime.wake();const p=await x.wait(p=>p.execution?.state==='succeeded');
 assert.equal(p.assessment.usage.modelTokens,undefined);assert.ok(p.execution.usage.unmeasured.includes('modelTokens'));assert.equal(x.f.kernel.executions.totals(x.f.store.read(x.f.contextId)).modelTokens,5000);
});
test('source projection preserves raw proposals, UTF8 offsets and ambiguity; refuses changed permission wording and stitched quotes',()=>{
 const source='é; this is scoped. Keep it here.\nrepeat repeat';
 const editorial=anchorQuotation(source,'This is scoped.');assert.equal(editorial.status,'editorial-initial');assert.equal(editorial.proposed,'This is scoped.');assert.equal(editorial.original,'this is scoped.');assert.equal(editorial.matches[0].offset,4);
 assert.equal(anchorQuotation(source,'repeat').status,'ambiguous');assert.equal(anchorQuotation(source,'this is scoped. repeat').status,'unanchored');assert.equal(anchorQuotation('May deploy after approval.','May deploy.').status,'unanchored');
});

test('two authorized collaborators read shared results; hidden/revoked sources and weaker receipt-replay grants stay bounded',async t=>{
 const x=await fixture(t);x.f.call('guidance.review',x.request);x.runtime.wake();const p=await x.wait(p=>p.execution?.state==='succeeded');await x.runtime.running;
 allowDelegated(x.f);const capture=p.execution.intent.input.captures[0].ref,source=p.captures[0].stored.value.source,execution=x.f.kernel.ref(x.f.contextId,x.request.id);
 for(let i=0;i<2;i++) {
  const actor=randomUUID(),g=grant(x.f,actor,{actions:['guidance.read','execution.get'],limits:envelope,resourceRefs:[source,capture,execution]});
  const result=delegated(x.f,actor,g,'guidance.read',{executionId:x.request.id,maximumBytes:262144});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.value.assessment.rawDigest,p.assessment.rawDigest);
  x.f.write('grant.revoke',{grant:g.ref,reason:'Reader leaves'});assert.equal(delegated(x.f,actor,g,'guidance.read',{executionId:x.request.id}).error.code,'FORBIDDEN');
 }
 const narrow=grant(x.f,x.f.ownerId,{actions:['guidance.review'],limits:envelope,resourceRefs:[source,capture,x.request.capability]});
 assert.equal(x.f.call('guidance.review',x.request,x.f.ownerId,narrow.ref).error.code,'FORBIDDEN');
 const actor=randomUUID(),hidden=grant(x.f,actor,{actions:['guidance.read','execution.get'],limits:envelope,resourceRefs:[capture,execution]});
 assert.equal(delegated(x.f,actor,hidden,'guidance.read',{executionId:x.request.id}).error.code,'NOT_FOUND');
});
test('active native cancellation observes interruption, settles the same attempt and releases shared capacity',async t=>{
 const x=await fixture(t,'wait-interrupt');x.f.call('guidance.review',x.request);x.runtime.wake();await x.wait(p=>p.execution?.state==='running');
 // Running admission precedes turn/start: wait for its exact native acknowledgment.
 const deadline=performance.now()+3000;while(!x.engine.currentJob?.turnId && performance.now()<deadline)await new Promise(r=>setTimeout(r,5));
 assert.ok(x.engine.currentJob?.turnId);assert.equal(x.f.write('execution.cancel',{executionId:x.request.id,reason:'Native consumer cancelled the bounded review'}).ok,true);x.runtime.wake();
 const p=await x.wait(p=>p.execution?.state==='cancelled');await x.runtime.running;assert.equal(p.execution.attempt,1);assert.equal(x.slot.holder,undefined);assert.equal(p.captures[0].text,'Use pnpm. Keep task-specific scope.');
});


test('one captured source can supply several distinct task-scoped guidance candidates',()=>{
 const id=randomUUID(),dispatch={request:{sources:[{capture:{id}}]}};
 const candidate={captureId:id,interpretation:'Consolidate documentation ownership.',scope:'Docs in this handoff.',reason:'Canonical prose procedure.',quotes:['Consolidate documentation.']};
 const second={...candidate,interpretation:'Keep dependency patch procedures current.',scope:'Affected dependency procedures.',reason:'Separate consistency concern.',quotes:['Maintain patch procedures.']};
 const output={candidates:[candidate,second],exclusions:[],premises:[],uncertainties:[],evidenceCoverage:'One mixed canonical guide.'};
 assert.equal(decodeGuidanceOutput(JSON.stringify(output),dispatch).candidates.length,2);
 assert.throws(()=>decodeGuidanceOutput(JSON.stringify({...output,candidates:[{...candidate,captureId:randomUUID()}]}),dispatch),{code:'INVALID_ARGUMENT'});
});

test('profile discovery rechecks current grant revocation and the exact expiry boundary without dispatching',async t=>{
 const x=await fixture(t),read=()=>{const result=x.f.call('guidance.read',{contextId:x.f.contextId,sourceIds:[]});assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
 assert.equal(read().profile.capability.id,x.request.capability.id);
 assert.equal(x.f.write('grant.revoke',{grant:x.request.grant,reason:'Profile discovery must use current authority'}).ok,true);
 assert.equal(read().profile,undefined);
 grant(x.f,x.f.ownerId,{actions:['execution.request','guidance.review',guidanceCapabilityName],limits:envelope,resourceRefs:[x.request.capability]});
 assert.equal(read().profile.capability.id,x.request.capability.id);
 const expiry=Date.parse(x.f.store.read(x.f.contextId).controlState.capabilities[x.request.capability.id].value.expiresAt);
 x.f.kernel.clock.wall=()=>expiry-1;assert.equal(read().profile.capability.id,x.request.capability.id);
 x.f.kernel.clock.wall=()=>expiry;assert.equal(read().profile,undefined);
 assert.equal(readdirSync(x.runtime.directory).length,0);assert.equal(x.slot.holder,undefined);
});

test('dispatch retention charges the actual on-disk newline before creating a new journal',async t=>{
 const x=await fixture(t),admitted=x.f.call('guidance.review',x.request);assert.equal(admitted.ok,true,JSON.stringify(admitted));
 const execution=admitted.value,xpath=x.runtime.path(execution);
 x.runtime.dispatch(x.f.contextId,execution);const length=readFileSync(xpath).length;rmSync(xpath);
 // Owned, unselected JSON objects supply measured byte pressure, not receipts.
 let remaining=16777216-(length-1);
 while(remaining) {
  let size=Math.min(200000,remaining);if(remaining-size===1)size--;
  const bytes=Buffer.alloc(size,32);bytes[0]=123;bytes[size-1]=125;
  writeFileSync(join(x.runtime.directory,randomUUID()+'.json'),bytes,{mode:0o600});remaining-=size;
 }
 assert.throws(()=>x.runtime.dispatch(x.f.contextId,execution),{code:'LIMIT_EXCEEDED'});
 assert.equal(existsSync(xpath),false);assert.equal(x.slot.holder,undefined);
});

test('malformed retained dispatch identities refuse as conflicts without rewriting the recovery bytes',async t=>{
 const x=await fixture(t),admitted=x.f.call('guidance.review',x.request);assert.equal(admitted.ok,true,JSON.stringify(admitted));
 const path=x.runtime.path(admitted.value);
 for(const bytes of ['{}','null','[]']) {
  writeFileSync(path,bytes,{mode:0o600});
  assert.throws(()=>x.runtime.dispatch(x.f.contextId,admitted.value),{code:'IDENTITY_CONFLICT'});
  assert.equal(readFileSync(path,'utf8'),bytes);
 }
 assert.equal(x.slot.holder,undefined);
});
