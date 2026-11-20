import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {openHome} from '../runtime/home.mjs';
import {serve} from '../runtime/server.mjs';
import {createClient} from '../runtime/client.mjs';
import {CodexMemoryProvider} from '../runtime/codex-memory.mjs';
import {guidanceNativeProfile} from '../runtime/guidance-profile.mjs';
import {installGuidance} from '../runtime/guidance-commands.mjs';
import {digest} from '../runtime/json.mjs';
const envelope={concurrentExecutions:1,cpuMillis:300000,memoryBytes:268435456,outputBytes:1048576,modelTokens:100000,apiSpendMicrounits:0,currency:'USD'},evidence={sources:[],artifactDigests:[],method:'Owned service qualification'};
async function fixture(t,scenario='normal') {
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'mg-')));mkdirSync(join(directory,'home'),{mode:0o700});const home=openHome({home:join(directory,'home'),override:join(directory,'store')}),root=home.root;
 const credentialFile=join(directory,'access.json'),claims=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');writeFileSync(credentialFile,JSON.stringify({tokens:{access_token:'fixture.'+claims+'.signature',account_id:scenario}}),{mode:0o600});
 let active=0,maximum=0;
 const engine=(kind)=>{
  const binary=join(directory,kind+'.mjs');writeFileSync(binary,'#!'+process.execPath+'\n'+readFileSync(new URL('./codex-'+(kind==='memory'?'memory':'guidance')+'-fixture.mjs',import.meta.url)),{mode:0o700});
  const selectedCredential=kind==='memory'?join(directory,'memory-access.json'):credentialFile;if(kind==='memory')writeFileSync(selectedCredential,JSON.stringify({tokens:{access_token:'fixture.'+claims+'.signature',account_id:'normal'}}),{mode:0o600});
  const p=new CodexMemoryProvider(root,{binary,credentialFile:selectedCredential,timeoutMillis:3000},kind==='guidance'?guidanceNativeProfile():undefined),ready=p.ready.bind(p),dispose=p.dispose.bind(p);let counted=false;
  p.ready=async()=>{const result=await ready();if(!counted){counted=true;active++;maximum=Math.max(maximum,active);}return result;};p.dispose=async remove=>{await dispose(remove);if(counted){counted=false;active--;}};return p;
 };
 const start=()=>serve(root,home.registry.systemId,{memoryProvider:engine('memory'),guidanceProvider:engine('guidance'),guidanceOptions:{fileRoots:[directory]}});
 let server=await start();const client=createClient(root);
 t.after(async()=>{await server.close();rmSync(directory,{recursive:true,force:true});});
 const call=async(method,input)=>{const r=await client.call(method,input);assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
 const contextId=randomUUID();await call('context.create',{id:contextId,label:'Candidate service qualification',bootstrapProfile:'owner-local',limits:envelope,idempotencyKey:randomUUID()});
 const write=async(method,input)=>{const c=await call('context.get',{contextId});return call(method,{contextId,expectedRevision:c.revision,idempotencyKey:randomUUID(),...input});};
 const incidentId=randomUUID();await write('incident.create',{id:incidentId,incident:{purpose:'Qualify connected guidance',status:'open',completionCriteria:['Verified handoff'],continuation:[]}});
 const path=join(directory,'guide.md');writeFileSync(path,'Use pnpm. Keep commands within this project.');const sourceId=randomUUID();
 await write('guidance.register',{id:sourceId,definition:{label:'Project guide',locator:{kind:'file',path},selection:{kind:'whole'},locations:[directory],classification:'private',evidence},active:true});await write('guidance.refresh',{sourceId});
 const setup=await installGuidance(root,contextId);assert.equal(setup.state,'ready');
 const request={id:randomUUID(),incidentId,task:{description:'Prepare a scoped implementation handoff.',location:directory,sourceRefs:[]},capability:setup.capability,grant:setup.grant,limits:setup.limits};
 const until=async predicate=>{const end=performance.now()+10000;while(performance.now()<end){const p=await call('guidance.read',{contextId,executionId:request.id,maximumBytes:262144});if(predicate(p))return p;await new Promise(r=>setTimeout(r,15));}throw Error('Owned connected service did not reach expected state');};
 return {root,directory,client,contextId,request,call,write,until,maximum:()=>maximum,restart:async()=>{await server.close();server=await start();}};
}
test('service exposes one consistent read/request surface and serializes actual owned native memory/guidance processes',async t=>{
 const x=await fixture(t,'delay'),view=await x.call('guidance.read',{contextId:x.contextId,location:x.directory});assert.equal(view.profile.capability.id,x.request.capability.id);
 await x.write('guidance.review',x.request);await x.until(p=>p.execution.state==='running');
 const session={runtimeId:'codex',sessionId:randomUUID()};await x.call('memory.observe',{session,deliveryId:randomUUID(),message:{text:'Keep this wording scoped to the current handoff.',authorship:'human'}});
 const result=await x.until(p=>p.execution.state==='succeeded');assert.equal(result.assessment.candidates[0].quotes[0].status,'exact');
 const deadline=performance.now()+8000;let memory;
 do{memory=await x.call('memory.read',{session});if(memory.processedThrough===1)break;await new Promise(r=>setTimeout(r,15));}while(performance.now()<deadline);
 assert.equal(memory.processedThrough,1);assert.equal(memory.entries.length,1);assert.equal(x.maximum(),1);
});
test('unknown guidance keeps the shared slot across service restart; attributable operator reconciliation releases pending memory',async t=>{
 const x=await fixture(t,'lose-turn');await x.write('guidance.review',x.request);const unknown=await x.until(p=>p.execution.state==='unknown');
 const slotBefore=JSON.parse(readFileSync(join(x.root,'runtime/native-labor.json'),'utf8'));assert.equal(slotBefore.holder.component,'guidance');
 const session={runtimeId:'codex',sessionId:randomUUID()};await x.call('memory.observe',{session,deliveryId:randomUUID(),message:{text:'Pending during native uncertainty.',authorship:'human'}});
 await x.restart();const after=await x.until(p=>p.execution.state==='unknown');assert.equal(after.execution.attempt,1);
 const memory=await x.call('memory.read',{session});assert.equal(memory.processedThrough,0);assert.equal(memory.pending[0].status,'pending');
 assert.deepEqual(JSON.parse(readFileSync(join(x.root,'runtime/native-labor.json'),'utf8')).holder,slotBefore.holder);
 assert.equal(readdirSync(join(x.root,'runtime/guidance-native/jobs')).length,1);
 await x.write('execution.reconcile',{executionId:x.request.id,attempt:1,resolution:{kind:'observed',outcome:{kind:'cancelled',evidence:{sources:[x.request.capability],artifactDigests:[],method:'Owned scripted process exit was observed; no external inference was performed'}}},usage:unknown.execution.usage});
 const deadline=performance.now()+8000;let settled;
 do{settled=await x.call('memory.read',{session});if(settled.processedThrough===1)break;await new Promise(r=>setTimeout(r,15));}while(performance.now()<deadline);
 assert.equal(settled.processedThrough,1,JSON.stringify(settled));assert.equal(x.maximum(),1);
});

test('operator setup refuses a selected delegate rather than falling back to owner custody',async t=>{
 const x=await fixture(t),actor=randomUUID(),grant=await x.write('grant.issue',{grant:{id:randomUUID(),principalId:actor,actions:['context.get'],incidentIds:'all',resourceRefs:[],delegable:false,limits:envelope}});
 const {issueCredential}=await import('../runtime/credentials.mjs'),credentialFile=issueCredential(x.root,actor,{[x.contextId]:grant.ref}),before=await x.call('context.get',{contextId:x.contextId});
 await assert.rejects(installGuidance(x.root,x.contextId,{credentialFile}),{code:'FORBIDDEN'});
 const after=await x.call('context.get',{contextId:x.contextId});assert.equal(after.revision,before.revision);
});

test('read-only compatibility setup adds only owner discovery and preserves limits and other predicates',async t=>{
 const x=await fixture(t),context=await x.call('context.get',{contextId:x.contextId});
 const current=(await x.call('control.get',{contextId:x.contextId,ref:context.policy})).value;
 const policy={...current,id:randomUUID(),parent:context.policy,rules:current.rules.map(rule=>({...rule,actions:rule.actions.filter(action=>action!=='guidance.read')})).filter(rule=>rule.actions.length)};
 const published=await x.write('policy.publish',{policy});await x.write('policy.activate',{policy:published.ref,evidence});
 assert.equal((await x.client.call('guidance.read',{contextId:x.contextId})).error.code,'FORBIDDEN');
 const before=await x.call('context.get',{contextId:x.contextId}),result=await installGuidance(x.root,x.contextId,{readOnly:true});assert.equal(result.state,'read-admitted');
 const after=await x.call('context.get',{contextId:x.contextId}),active=(await x.call('control.get',{contextId:x.contextId,ref:after.policy})).value;
 assert.deepEqual(after.limits,before.limits);assert.deepEqual(active.limits,policy.limits);assert.deepEqual(active.rules.slice(0,-1),policy.rules);assert.deepEqual(active.rules.at(-1).actions,['guidance.read']);
 assert.equal((await x.client.call('guidance.read',{contextId:x.contextId})).ok,true);
 const unchanged=after.revision;await installGuidance(x.root,x.contextId,{readOnly:true});assert.equal((await x.call('context.get',{contextId:x.contextId})).revision,unchanged);
});
