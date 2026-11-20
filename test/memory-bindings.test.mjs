import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openHome} from '../runtime/home.mjs';
import {serve} from '../runtime/server.mjs';
import {createClient} from '../runtime/client.mjs';
import {createManaged} from '../runtime/managed.mjs';
import {SessionMemory} from '../runtime/session-memory.mjs';
import {bytesDigest} from '../runtime/json.mjs';
import {memoryMap} from '../runtime/memory-presentation.mjs';
const limits={concurrentExecutions:1,cpuMillis:10000,memoryBytes:10000,outputBytes:10000,modelTokens:0,apiSpendMicrounits:0,currency:'USD'};
const evidence={sources:[],artifactDigests:[],method:'Private binding qualification; no model invocation or agent inspection claim.'};

async function fixture(t,text='Header\nUse pnpm only for the named task.\nOther\n',selection={kind:'lines',first:2,last:2}){
  const directory=realpathSync(mkdtempSync(join(tmpdir(),'mb-'))),home=openHome({home:directory,override:join(directory,'s')}),root=home.root;
  let server=await serve(root,home.registry.systemId,{guidanceOptions:{fileRoots:[directory]}});
  t.after(async()=>{await server.close();rmSync(directory,{recursive:true,force:true});});
  const client=createClient(root),contextId=randomUUID(),incidentId=randomUUID(),session={runtimeId:'owned-bindings',sessionId:randomUUID()};
  const call=async(method,input)=>{const r=await client.call(method,input);assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
  await call('context.create',{id:contextId,idempotencyKey:randomUUID(),label:'Owned binding context',bootstrapProfile:'owner-local',limits});
  const write=async(method,input)=>call(method,{contextId,expectedRevision:(await call('context.get',{contextId})).revision,idempotencyKey:randomUUID(),...input});
  await write('incident.create',{id:incidentId,incident:{purpose:'Verify source binding',status:'open',continuation:[],completionCriteria:['Scoped source recovery']}});
  const sourceId=randomUUID(),path=join(directory,'guide.md'),definition={label:'Owned selected guide',locator:{kind:'file',path},selection,locations:[directory],classification:'private',evidence};writeFileSync(path,text);
  const source=await write('guidance.register',{id:sourceId,definition,active:true}),observation=await write('guidance.refresh',{sourceId});assert.equal(observation.value.latest.state,'ready',JSON.stringify(observation.value.latest));
  const packet=await call('guidance.read',{contextId,sourceIds:[sourceId],maximumBytes:262144});
  const capture=packet.captures[0];
  const binding={source:source.ref,capture:capture.stored.ref,contentDigest:bytesDigest(capture.text??text),representation:'selected',applicability:'Applies only to the named owned task.',materialOmissions:['Other source sections were not selected.']};
  const work={systemId:home.registry.systemId,contextId,incidentId};
  const focus=async(action,key=randomUUID())=>client.call('memory.focus',{session,expectedFocusRevision:(await call('memory.read',{session})).focus?.revision??0,idempotencyKey:key,action:{kind:'select',purposeKey:'owned-task',...action}});
  const policy=(await call('control.get',{contextId,ref:(await call('context.get',{contextId})).policy})).value;
  const restrict=async actions=>{const p=await write('policy.publish',{policy:{...policy,id:randomUUID(),rules:[...policy.rules,{id:'owned-current-denial',effect:'deny',actions,when:{kind:'equal',left:{kind:'literal',value:true},right:{kind:'literal',value:true}}}]}});await write('policy.activate',{policy:p.ref,evidence});};
  return {root,home,directory,client,contextId,incidentId,session,call,write,path,definition,sourceId,binding,work,focus,restrict,restart:async()=>{await server.close();server=await serve(root,home.registry.systemId,{guidanceOptions:{fileRoots:[directory]}});}};
}

test('source bindings survive restart, retain selected identity and expose needed bodies through the existing reader',async t=>{
  const f=await fixture(t),result=await f.focus({work:f.work,guidance:[f.binding]});assert.equal(result.ok,true,JSON.stringify(result));
  const before=await f.call('memory.read',{session:f.session});assert.deepEqual(before.bindings.work.target,f.work);assert.deepEqual(before.bindings.guidance[0].binding,f.binding);assert.equal(before.bindings.guidance[0].freshness,'current-observation');
  assert.equal(before.subscription.enabled,false);assert.deepEqual(before.entries,[]);
  assert.equal(before.bindings.guidance[0].binding.materialOmissions[0],'Other source sections were not selected.');
  const native=createManaged({root:f.root}),read=await native.call('memory.read',{session:f.session});assert.equal(read.ok,true);assert.deepEqual(read.value.bindings,before.bindings);
  const detail=await f.call('guidance.read',{contextId:f.contextId,captureIds:[f.binding.capture.id],representation:f.binding.representation});assert.equal(detail.captures[0].text,'Use pnpm only for the named task.\n');assert.equal(bytesDigest(detail.captures[0].text),f.binding.contentDigest);
  const retained=new SessionMemory(join(f.root,'runtime/session-memory.sqlite'),f.home.registry.systemId);
  try{
    const set=JSON.parse(retained.db.prepare('SELECT value FROM memory_working_sets WHERE id=?').get(before.focus.workingSetId).value);
    assert.deepEqual(set.guidance,[f.binding]);assert.ok(!JSON.stringify(set).includes(detail.captures[0].text));
    const offline=retained.read({session:f.session});assert.deepEqual(offline.bindings.guidance,[]);assert.equal(offline.bindings.work,undefined);assert.ok(offline.bindings.omitted.every(x=>x.reason==='component-unavailable'));
    assert.throws(()=>retained.focus({session:f.session,expectedFocusRevision:before.focus.revision,idempotencyKey:'unconfigured-port',action:{kind:'select',purposeKey:'owned-task',guidance:[f.binding]}},'owned-fixture'),{code:'CAPABILITY_UNAVAILABLE'});
  }finally{retained.close();}
  await f.restart();assert.deepEqual((await f.call('memory.read',{session:f.session})).bindings,before.bindings);
});

test('current policy denial hides external guidance references without hiding personal conversation memory',async t=>{
  const f=await fixture(t);assert.equal((await f.focus({work:f.work,guidance:[f.binding]})).ok,true);
  const admitted=await f.call('memory.observe',{session:f.session,workingSetId:(await f.call('memory.read',{session:f.session})).focus.workingSetId,deliveryId:randomUUID(),message:{text:'My own scoped correction remains personal evidence.',authorship:'human'}});
  await f.restrict(['guidance.read']);
  writeFileSync(join(f.root,'runtime/guidance/bytes',f.binding.contentDigest.slice(7)),'The inaccessible body also fails its digest.');
  const packet=await f.call('memory.read',{session:f.session});assert.equal(packet.observedThrough,1);assert.deepEqual(packet.bindings.guidance,[]);assert.ok(packet.bindings.work);assert.deepEqual(packet.bindings.omitted,[{kind:'guidance',index:0,reason:'unavailable'}]);
  assert.ok(!JSON.stringify(packet.bindings).includes(f.binding.source.id));assert.ok(!JSON.stringify(packet.bindings).includes(f.binding.capture.id));
  assert.equal((await f.call('memory.read',{session:f.session,sourceIds:admitted.sourceIds})).sources[0].text,'My own scoped correction remains personal evidence.');
  assert.equal((await f.focus({guidance:[f.binding]})).error.code,'FORBIDDEN');
  const cleared=await f.focus({guidance:[],work:null});assert.equal(cleared.ok,true);assert.equal((await f.call('memory.read',{session:f.session})).bindings,undefined);
});

test('current work denial qualifies only the inaccessible binding and preserves independent guidance authority',async t=>{
  const f=await fixture(t);assert.equal((await f.focus({work:f.work,guidance:[f.binding]})).ok,true);
  await f.restrict(['incident.get']);const packet=await f.call('memory.read',{session:f.session});
  assert.equal(packet.bindings.work,undefined);assert.equal(packet.bindings.guidance.length,1);assert.deepEqual(packet.bindings.omitted,[{kind:'work',reason:'unavailable'}]);
  assert.ok(!JSON.stringify(packet.bindings).includes(f.incidentId));assert.equal((await f.focus({work:f.work})).error.code,'FORBIDDEN');
});

test('changed and withdrawn registered sources remain qualified historical evidence without silent rebinding',async t=>{
  const f=await fixture(t);assert.equal((await f.focus({guidance:[f.binding]})).ok,true);
  writeFileSync(f.path,'Header\nUse the newer scoped procedure.\nOther\n');await f.write('guidance.refresh',{sourceId:f.sourceId});
  let packet=await f.call('memory.read',{session:f.session});assert.equal(packet.bindings.guidance[0].freshness,'historical');assert.deepEqual(packet.bindings.guidance[0].binding,f.binding);
  const fresh=await f.call('guidance.read',{contextId:f.contextId,sourceIds:[f.sourceId]}),next={...f.binding,capture:fresh.captures[0].stored.ref,contentDigest:bytesDigest(fresh.captures[0].text)};
  assert.equal((await f.focus({guidance:[next]})).ok,true);assert.equal((await f.call('memory.read',{session:f.session})).bindings.guidance[0].freshness,'current-observation');
  await f.write('guidance.register',{id:f.sourceId,definition:f.definition,active:false});
  packet=await f.call('memory.read',{session:f.session});assert.equal(packet.bindings.guidance[0].freshness,'historical');assert.deepEqual(packet.bindings.guidance[0].binding,next);
});

test('bindings verify exact ranges, reject false identities and preserve the previous admitted set on failure',async t=>{
  const f=await fixture(t,'é 🍃 guideline',{kind:'whole'}),range={...f.binding,bodyRange:{offset:3,byteLength:4},contentDigest:bytesDigest('🍃')},foreignSystem=randomUUID();
  assert.equal((await f.focus({guidance:[range]})).ok,true);const before=await f.call('memory.read',{session:f.session});
  for(const bad of [
    {...range,contentDigest:bytesDigest('unrelated')},
    {...range,source:{...range.source,id:randomUUID()}},
    {...range,bodyRange:{offset:4,byteLength:3}},
    {...range,capture:{...range.capture,systemId:foreignSystem},source:{...range.source,systemId:foreignSystem}},
  ])assert.equal((await f.focus({guidance:[bad]})).ok,false);
  assert.equal((await f.focus({guidance:[range,range]})).error.code,'INVALID_ARGUMENT');
  assert.deepEqual((await f.call('memory.read',{session:f.session})).bindings,before.bindings);
  assert.equal((await f.focus({work:{...f.work,systemId:foreignSystem}})).error.code,'NOT_FOUND');
  assert.equal((await f.focus({guidance:[range,{...range,applicability:'Independent use of the same evidence within this purpose.'}]})).ok,true);
});

test('large scoped bindings have explicit read/map omissions and recover without changing stored meaning',async t=>{
  const f=await fixture(t),guidance=Array.from({length:8},(_,index)=>({...f.binding,applicability:'Scoped use '+index+': '+'condition '.repeat(180),materialOmissions:Array.from({length:8},(_,i)=>'Unselected passage '+i+': '+'detail '.repeat(60))}));
  assert.equal((await f.focus({guidance})).ok,true);
  const complete=await f.call('memory.read',{session:f.session,maximumBytes:262144});assert.equal(complete.bindings.guidance.length,8);
  const partial=await f.call('memory.read',{session:f.session});assert.equal(partial.bindings,undefined);assert.ok(partial.omittedFields.includes('/bindings'));assert.ok(Buffer.byteLength(JSON.stringify(partial))<=16384);
  const text=memoryMap(partial),map=JSON.parse(text.slice(text.indexOf('\n')+1));assert.ok(Buffer.byteLength(text)<=4096);assert.ok(map.readOmissions.fields.includes('/bindings'));
  const fullMapText=memoryMap(complete),fullMap=JSON.parse(fullMapText.slice(fullMapText.indexOf('\n')+1));assert.ok(Buffer.byteLength(fullMapText)<=4096);assert.ok(fullMap.omitted.fields.includes('bindings'));
  assert.deepEqual(await f.call('memory.read',{session:f.session,maximumBytes:262144}),complete);
});

test('equal guidance bytes retain independent source authority and original binding indexes',async t=>{
  const f=await fixture(t),otherContext=randomUUID();
  await f.call('context.create',{id:otherContext,idempotencyKey:randomUUID(),label:'Independent source policy',bootstrapProfile:'owner-local',limits});
  const write=async(method,input)=>f.call(method,{contextId:otherContext,expectedRevision:(await f.call('context.get',{contextId:otherContext})).revision,idempotencyKey:randomUUID(),...input});
  const sourceId=randomUUID(),source=await write('guidance.register',{id:sourceId,definition:f.definition,active:true});await write('guidance.refresh',{sourceId});
  const observed=await f.call('guidance.read',{contextId:otherContext,sourceIds:[sourceId]}),binding={...f.binding,source:source.ref,capture:observed.captures[0].stored.ref,contentDigest:bytesDigest(observed.captures[0].text)};
  assert.equal(binding.contentDigest,f.binding.contentDigest);assert.notDeepEqual(binding.source,f.binding.source);
  assert.equal((await f.focus({guidance:[f.binding,binding,{...f.binding,applicability:'A second independently scoped use.'}]})).ok,true);
  const context=await f.call('context.get',{contextId:otherContext}),policy=(await f.call('control.get',{contextId:otherContext,ref:context.policy})).value;
  const denial=await write('policy.publish',{policy:{...policy,id:randomUUID(),rules:[...policy.rules,{id:'deny-only-this-source-context',effect:'deny',actions:['guidance.read'],when:{kind:'equal',left:{kind:'literal',value:true},right:{kind:'literal',value:true}}}]}});await write('policy.activate',{policy:denial.ref,evidence});
  const packet=await f.call('memory.read',{session:f.session});assert.deepEqual(packet.bindings.guidance.map(x=>x.index),[0,2]);assert.deepEqual(packet.bindings.omitted,[{kind:'guidance',index:1,reason:'unavailable'}]);
  assert.ok(!JSON.stringify(packet.bindings).includes(binding.source.id));assert.ok(!JSON.stringify(packet.bindings).includes(binding.capture.id));
});

test('body-budget omissions still permit authorized byte verification; corruption stays unavailable',async t=>{
  const text='\u0000'.repeat(65536),f=await fixture(t,text,{kind:'whole'});
  assert.equal((await f.focus({guidance:[f.binding]})).ok,true);
  const body=join(f.root,'runtime/guidance/bytes',f.binding.contentDigest.slice(7));writeFileSync(body,'corrupted immutable bytes');
  const packet=await f.call('memory.read',{session:f.session});assert.deepEqual(packet.bindings.guidance,[]);assert.deepEqual(packet.bindings.omitted,[{kind:'guidance',index:0,reason:'integrity'}]);
  assert.equal((await f.focus({guidance:[f.binding]})).error.code,'IDENTITY_CONFLICT');
  rmSync(body);assert.equal((await f.call('memory.read',{session:f.session})).bindings.omitted[0].reason,'component-unavailable');
});

test('project binding requires both central associations and rechecks them on subsequent reads',async t=>{
  const f=await fixture(t),projectId=randomUUID(),contextDir=join(f.root,'contexts',f.contextId);mkdirSync(contextDir,{recursive:true,mode:0o700});
  const manifest={formatVersion:1,id:f.contextId,projectIds:[projectId]},project={id:projectId,label:'Owned project',origins:[],locations:[{path:f.directory}],contextIds:[f.contextId]};
  writeFileSync(join(contextDir,'manifest.json'),JSON.stringify(manifest),{mode:0o600});f.home.registry.projects=[project];writeFileSync(join(f.root,'registry.json'),JSON.stringify(f.home.registry),{mode:0o600});
  const work={...f.work,projectId};assert.equal((await f.focus({work})).ok,true);assert.deepEqual((await f.call('memory.read',{session:f.session})).bindings.work.target,work);
  project.contextIds=[];writeFileSync(join(f.root,'registry.json'),JSON.stringify(f.home.registry),{mode:0o600});
  const packet=await f.call('memory.read',{session:f.session});assert.equal(packet.bindings.work,undefined);assert.deepEqual(packet.bindings.omitted,[{kind:'work',reason:'unavailable'}]);
  assert.equal((await f.focus({work})).error.code,'NOT_FOUND');
});
