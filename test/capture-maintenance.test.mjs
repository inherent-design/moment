import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,realpathSync,statSync,existsSync,symlinkSync,linkSync,chmodSync,utimesSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setup,incident} from './helpers.mjs';
import {publishCapture,captureDirectory} from '../runtime/captures.mjs';
import {nativeCapture,planCaptureMaintenance,applyCaptureMaintenance} from '../runtime/capture-maintenance.mjs';
import {canonical,digest,bytesDigest,DomainError} from '../runtime/json.mjs';

async function fixture(t){
  const f=setup(t),root=realpathSync(f.directory),created=f.write('incident.create',{id:randomUUID(),incident}),target={systemId:f.systemId,contextId:f.contextId,incidentId:created.value.ref.id},dir=join(root,'incidents',target.incidentId,'captures');mkdirSync(dir,{recursive:true,mode:0o700});
  const bytes=Buffer.alloc(32768,65),source=join(dir,'survivor.jar'),replacement=join(dir,'duplicate.jar'),world=join(dir,'world-save/level.dat');mkdirSync(join(dir,'world-save'));writeFileSync(world,'KEEP_WORLD');writeFileSync(source,bytes);writeFileSync(replacement,bytes);
  const domain=async(m,a)=>{const r=f.call(m,a);if(!r.ok)throw new DomainError(r.error.code,r.error.message,r.error.retry);return r.value;};
  const payload=(id,path,kind='archive')=>({id,path:'captures/'+path,bytes:bytes.length,digest:bytesDigest(bytes),kind,availability:{kind:'present'},pins:[],dependencies:[],requiredBy:[]});
  const manifest={formatVersion:1,id:randomUUID(),target,generation:1,run:{id:'owned-run',category:'release-archives',state:'completed',current:false,order:1,pins:[],dependencies:[]},provenance:{dirtyInputDigests:[],tools:[],commands:['owned fixture'],environment:[],outcomes:[],limitations:[]},claims:[],payloads:[payload('survivor','survivor.jar'),payload('duplicate','duplicate.jar'),{...payload('world','world-save/level.dat','world'),bytes:10,digest:bytesDigest('KEEP_WORLD')}],continuation:{summary:'Owned test',unresolved:[]},evidence:{sources:[],method:'Owned fixture',artifactDigests:[]}};
  await publishCapture(root,{contextId:f.contextId,expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:randomUUID(),manifest},domain);
  const policyFile=join(root,'policy.json'),custodyFile=join(root,'custody.json'),policy={formatVersion:1,id:randomUUID(),revision:1,enabled:true,scope:[target],kinds:['archive'],maximumFiles:8,maximumBytes:1048576,authority:{sources:[],method:'Explicit authority for owned fixtures only',artifactDigests:[]}};
  writeFileSync(policyFile,canonical(policy)+'\n',{mode:0o600});
  const custody={formatVersion:1,id:randomUUID(),revision:1,policyDigest:bytesDigest(readFileSync(policyFile)),scope:[target],ownerPid:process.pid,participants:['owned test writer'],confirmed:true,unknownWriters:[],exclusions:['captures/world-save'],evidence:{sources:[],method:'Single owned fixture writer',artifactDigests:[]}};writeFileSync(custodyFile,canonical(custody)+'\n',{mode:0o600});
  const request={formatVersion:1,id:randomUUID(),policyFile,custodyFile,target,manifestDigest:digest(manifest),pairs:[{sourceId:'survivor',targetId:'duplicate'}]};
  return {...f,root,target,dir,source,replacement,world,manifest,domain,request,policy,custody,policyFile,custodyFile};
}
const nativeOptions={skip:process.platform!=='darwin'};

test('native preview/apply preserves byte paths and metadata; completion replay does not touch later replacement',nativeOptions,async t=>{
  const f=await fixture(t),plan=await planCaptureMaintenance(f.root,f.request,f.domain),before=statSync(f.replacement,{bigint:true});assert.equal(plan.items.length,1);assert.deepEqual(plan.deferred,[]);assert.equal(typeof plan.items[0].before.mtime_ns,'string');assert.equal(BigInt(plan.items[0].before.mtime_ns),before.mtimeNs);
  const result=await applyCaptureMaintenance(f.root,plan,f.domain);assert.equal(result.state,'complete');assert.equal(result.logicalPathsRemoved,0);assert.equal(result.files,1);assert.deepEqual(readFileSync(f.source),readFileSync(f.replacement));assert.notEqual(statSync(f.replacement,{bigint:true}).ino,before.ino);assert.equal(statSync(f.replacement,{bigint:true}).mtimeNs,before.mtimeNs);assert.equal(readFileSync(f.world,'utf8'),'KEEP_WORLD');
  writeFileSync(f.replacement,'LATER_OWNER_CONTENT');const receipt=await applyCaptureMaintenance(f.root,plan,f.domain);assert.deepEqual(receipt,result);assert.equal(readFileSync(f.replacement,'utf8'),'LATER_OWNER_CONTENT');
});

test('stale context, revoked custody and forged exclusion frontier refuse before clone effects',nativeOptions,async t=>{
  const f=await fixture(t),plan=await planCaptureMaintenance(f.root,f.request,f.domain),before=statSync(f.replacement,{bigint:true});
  await assert.rejects(applyCaptureMaintenance(f.root,{...plan,protectedPaths:[]},f.domain),{code:'FORBIDDEN'});assert.equal(statSync(f.replacement,{bigint:true}).ino,before.ino);
  writeFileSync(f.custodyFile,canonical({...f.custody,confirmed:false})+'\n');await assert.rejects(applyCaptureMaintenance(f.root,plan,f.domain),{code:'FORBIDDEN'});writeFileSync(f.custodyFile,canonical(f.custody)+'\n');
  f.write('incident.update',{incidentId:f.target.incidentId,incident:{...incident,purpose:'Concurrent owner change'},evidence:{sources:[],method:'Owned concurrent writer',artifactDigests:[]}});
  await assert.rejects(applyCaptureMaintenance(f.root,plan,f.domain),{code:'REVISION_CONFLICT'});assert.equal(statSync(f.replacement,{bigint:true}).ino,before.ino);
});

test('a hand-edited plan cannot apply a representation that preview would defer',nativeOptions,async t=>{
 const f=await fixture(t),plan=await planCaptureMaintenance(f.root,f.request,f.domain),next=structuredClone(f.manifest),before=statSync(f.replacement,{bigint:true});
 next.id=randomUUID();next.generation=2;next.previousDigest=digest(f.manifest);next.payloads[1].availability={kind:'packed',path:'captures/recovery.zip',digest:next.payloads[1].digest,restoration:['Test-owned restoration recipe'],verifiedEvidence:[{systemId:f.systemId,contextId:f.contextId,id:f.target.incidentId}]};
 await publishCapture(f.root,{contextId:f.contextId,expectedRevision:f.store.read(f.contextId).context.revision,idempotencyKey:randomUUID(),manifest:next},f.domain);
 const forged={...plan,contextRevision:f.store.read(f.contextId).context.revision,manifestDigest:digest(next)};
 await assert.rejects(applyCaptureMaintenance(f.root,forged,f.domain),{code:'FORBIDDEN'});assert.equal(statSync(f.replacement,{bigint:true}).ino,before.ino);
});

test('hand-edited executable observations cannot bypass the qualified adapter restriction',nativeOptions,async t=>{
 const f=await fixture(t),plan=await planCaptureMaintenance(f.root,f.request,f.domain);chmodSync(f.source,0o755);chmodSync(f.replacement,0o755);
 const [sourceBefore,before]=await nativeCapture('inspect',{paths:[f.source,f.replacement],roots:plan.roots,protectedPaths:plan.protectedPaths,maximumBytes:f.policy.maximumBytes}),inode=statSync(f.replacement,{bigint:true}).ino;
 const forged={...plan,items:[{...plan.items[0],source_before:sourceBefore,before}]};
 await assert.rejects(applyCaptureMaintenance(f.root,forged,f.domain),{code:'FORBIDDEN'});assert.equal(statSync(f.replacement,{bigint:true}).ino,inode);
});

test('an incomplete receipt cannot settle cooperative custody or claim a finished replay',nativeOptions,async t=>{
 const f=await fixture(t),plan=await planCaptureMaintenance(f.root,f.request,f.domain),receipt=await applyCaptureMaintenance(f.root,plan,f.domain),path=join(captureDirectory(f.root,f.target),'maintenance-'+digest(plan).slice(7)+'.receipt.json');
 writeFileSync(path,canonical({...receipt,state:'incomplete',completedItems:0})+'\n',{mode:0o600});
 await assert.rejects(applyCaptureMaintenance(f.root,plan,f.domain,{reconcile:true}),{code:'OUTCOME_UNKNOWN'});assert.equal(JSON.parse(readFileSync(path,'utf8')).state,'incomplete');
});

test('world/state/pin classes, metadata differences, symlinks and hardlinks are concrete deferrals',nativeOptions,async t=>{
  const f=await fixture(t);let plan=await planCaptureMaintenance(f.root,{...f.request,pairs:[{sourceId:'world',targetId:'duplicate'}]},f.domain);assert.equal(plan.items.length,0);assert.match(plan.deferred[0].reason,/Protected/);
  chmodSync(f.source,0o600);plan=await planCaptureMaintenance(f.root,f.request,f.domain);assert.equal(plan.items.length,0);assert.match(plan.deferred[0].reason,/metadata/);chmodSync(f.source,0o644);
  linkSync(f.replacement,join(f.dir,'same-inode.jar'));plan=await planCaptureMaintenance(f.root,f.request,f.domain);assert.equal(plan.items.length,0);assert.match(plan.deferred[0].reason,/independent regular/);
  const linked=join(f.dir,'link.jar');symlinkSync(f.source,linked);await assert.rejects(nativeCapture('inspect',{paths:[linked],roots:[f.dir],protectedPaths:[],maximumBytes:1048576}),{code:'CAPABILITY_UNAVAILABLE'});
});

test('native protection observes the admitted root rather than unrelated host ancestors',nativeOptions,async t=>{
 const f=await fixture(t),root=join(f.root,'state/unrelated/captures'),path=join(root,'archive.jar');mkdirSync(root,{recursive:true});writeFileSync(path,'Owned independent archive.');
 const observed=await nativeCapture('inspect',{paths:[path],roots:[root],protectedPaths:[],maximumBytes:4096});assert.equal(observed[0].sha256,bytesDigest('Owned independent archive.').slice(7));
 const protectedPath=join(root,'recipient-state/payload.jar');mkdirSync(join(root,'recipient-state'));writeFileSync(protectedPath,'Preserve operation state.');await assert.rejects(nativeCapture('inspect',{paths:[protectedPath],roots:[root],protectedPaths:[],maximumBytes:4096}),{code:'CAPABILITY_UNAVAILABLE'});
});

test('owned process interruption at durable native phases reconciles the exact plan without losing either original',nativeOptions,async t=>{
  for(const phase of ['staging','prepared','swapped','deleted']){
    const f=await fixture(t),plan=await planCaptureMaintenance(f.root,f.request,f.domain),driver=join(f.root,'driver.py'),implementation=fileURLToPath(new URL('../runtime/capture-native.py',import.meta.url));
    // Only the owned test driver changes scheduling. Production guards/effects run unchanged.
    const script=`import os,sys,signal\nns={'__name__':'capture_test_driver'}\nexec(compile(open(${JSON.stringify(implementation)}).read(),${JSON.stringify(implementation)},'exec'),ns)\noriginal=ns['save']\ndef pause():\n os.write(2,b'OWNED_CHECKPOINT\\n');os.kill(os.getpid(),signal.SIGSTOP)\ndef saved(path,value):\n original(path,value)\n if ${JSON.stringify(phase)}!='deleted' and any(x.get('phase')==${JSON.stringify(phase)} for x in value.get('items',{}).values()):pause()\nns['save']=saved\nreal_unlink=os.unlink\ndef unlink(path,*a,**kw):\n result=real_unlink(path,*a,**kw)\n if ${JSON.stringify(phase)}=='deleted' and str(path).startswith('.moment-share-'):pause()\n return result\nos.unlink=unlink\nns['main']()\n`;
    writeFileSync(driver,script);let observed=false;
    const backend=(operation,input)=>nativeCapture(operation,input,{adapter:driver,onSpawn:child=>child.stderr.on('data',data=>{if(data.toString().includes('OWNED_CHECKPOINT')){observed=true;child.kill('SIGKILL');}})});
    await assert.rejects(applyCaptureMaintenance(f.root,plan,f.domain,{backend}),{code:'OUTCOME_UNKNOWN'});assert.equal(observed,true,'The exact owned durable checkpoint was observed');
    if(phase==='prepared'){
      const journalPath=join(captureDirectory(f.root,f.target),'maintenance-'+digest(plan).slice(7)+'.journal.json'),saved=readFileSync(journalPath),unknown=JSON.parse(saved),inode=statSync(f.replacement,{bigint:true}).ino;
      unknown.items['0'].phase='future-phase';writeFileSync(journalPath,canonical(unknown)+'\n');
      await assert.rejects(applyCaptureMaintenance(f.root,plan,f.domain,{reconcile:true}),{code:'CAPABILITY_UNAVAILABLE'});assert.equal(statSync(f.replacement,{bigint:true}).ino,inode);assert.equal(JSON.parse(readFileSync(journalPath,'utf8')).items['0'].phase,'future-phase');
      writeFileSync(journalPath,saved);
    }
    const receipt=await applyCaptureMaintenance(f.root,plan,f.domain,{reconcile:true});assert.equal(receipt.state,'complete');assert.deepEqual(readFileSync(f.source),readFileSync(f.replacement));assert.equal(readFileSync(f.world,'utf8'),'KEEP_WORLD');
    assert.equal(existsSync(join(captureDirectory(f.root,f.target),'scope.lock')),false);
  }
});

test('retired controller custody requires exact reconciliation and a completed replay clears only its own lock',nativeOptions,async t=>{
 const f=await fixture(t),plan=await planCaptureMaintenance(f.root,f.request,f.domain),module=new URL('../runtime/captures.mjs',import.meta.url).href,identity=digest(plan),abandon=()=>{const child=spawnSync(process.execPath,['--input-type=module','-e',`import {captureLock} from ${JSON.stringify(module)};captureLock(${JSON.stringify(f.root)},${JSON.stringify(f.target)},{operationDigest:${JSON.stringify(identity)}});`],{encoding:'utf8'});assert.equal(child.status,0,child.stderr);},lock=join(captureDirectory(f.root,f.target),'scope.lock');
 abandon();await assert.rejects(applyCaptureMaintenance(f.root,plan,f.domain),{code:'IDENTITY_CONFLICT'});assert.equal(existsSync(lock),true);
 const receipt=await applyCaptureMaintenance(f.root,plan,f.domain,{reconcile:true});assert.equal(receipt.state,'complete');assert.equal(existsSync(lock),false);
 abandon();writeFileSync(f.replacement,'LATER OWNER CONTENT');assert.deepEqual(await applyCaptureMaintenance(f.root,plan,f.domain,{reconcile:true}),receipt);assert.equal(existsSync(lock),false);assert.equal(readFileSync(f.replacement,'utf8'),'LATER OWNER CONTENT');
});
