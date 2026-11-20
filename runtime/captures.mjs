import {mkdirSync,lstatSync,openSync,closeSync,unlinkSync,constants} from 'node:fs';
import {join,resolve,dirname,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonical,digest,fail} from './json.mjs';
import {readPrivateJson,publishPrivate,replacePrivate} from './private-files.mjs';
import {catalog,validateSurface} from './bindings.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hash=/^sha256:[0-9a-f]{64}$/;
const maximumManifestBytes=262144;
export const captureSchema=()=>({name:'local.capture-manifest',version:'1',digest:digest(catalog.surfaceSchemas.CaptureManifest)});
const optionalStat=p=>{try{return lstatSync(p);}catch(e){if(e.code==='ENOENT')return;throw e;}};
function integer(n,name,min=0){if(!Number.isSafeInteger(n)||n<min)fail('INVALID_ARGUMENT','Invalid capture '+name);}
function string(s,name,max=4096){if(typeof s!=='string'||!s.length||Buffer.byteLength(s)>max)fail('INVALID_ARGUMENT','Invalid capture '+name);}
export function captureTarget(value){
  if(!value||Object.keys(value).sort().join(',')!=='contextId,incidentId,systemId'||!Object.values(value).every(x=>typeof x==='string'&&uuid.test(x)))fail('INVALID_ARGUMENT','Select exact capture system/context/incident IDs');
  return value;
}
/** Never traverse a source symlink, including an ancestor. Missing paths stay missing. */
export function capturePath(root,relativePath,{create=false}={}){
  if(typeof relativePath!=='string'||relativePath.startsWith('/')||relativePath.includes('\\')||relativePath.split('/').some(x=>!x||x==='.'||x==='..'))fail('INVALID_ARGUMENT','Capture paths must be confined relative names');
  let at=resolve(root);const base=optionalStat(at);if(!base?.isDirectory()||base.isSymbolicLink()||base.uid!==process.getuid())fail('IDENTITY_CONFLICT','Capture root is not an owned directory');
  for(const [i,part] of relativePath.split('/').entries()){
    at=join(at,part);let stat=optionalStat(at);
    if(!stat&&create){mkdirSync(at,{mode:0o700});stat=lstatSync(at);}
    if(stat?.isSymbolicLink()||stat&&i<relativePath.split('/').length-1&&!stat.isDirectory())fail('IDENTITY_CONFLICT','Capture path has a symbolic or non-directory ancestor');
  }
  return at;
}
function incidentRoot(root,target,{create=false}={}){
  captureTarget(target);return capturePath(root,'incidents/'+target.incidentId,{create});
}
export function captureDirectory(root,target,{create=false}={}){
  captureTarget(target);return capturePath(root,'incidents/'+target.incidentId+'/captures/retention',{create});
}
export function payloadPath(root,target,name){
  if(!name.startsWith('captures/')||name.startsWith('captures/retention/'))fail('INVALID_ARGUMENT','Payloads stay in the incident captures namespace outside retention metadata');
  captureTarget(target);return capturePath(root,'incidents/'+target.incidentId+'/'+name);
}
export function validateCaptureManifest(manifest){
  validateSurface('CaptureManifest',manifest);captureTarget(manifest.target);
  if(!uuid.test(manifest.id)||Buffer.byteLength(canonical(manifest))>maximumManifestBytes)fail('LIMIT_EXCEEDED','Invalid or oversized capture manifest');
  integer(manifest.generation,'generation',1);integer(manifest.run.order,'run order');
  if(manifest.generation>1&&!hash.test(manifest.previousDigest??''))fail('INVALID_ARGUMENT','A successor needs its exact previous manifest digest');
  if(manifest.generation===1&&manifest.previousDigest!==undefined)fail('INVALID_ARGUMENT','Initial capture manifests have no previous digest');
  if(manifest.payloads.length>128||manifest.claims.length>128)fail('LIMIT_EXCEEDED','Capture manifest exceeds128 payload/claim entries');
  string(manifest.run.id,'run ID',128);string(manifest.run.category,'category',256);
  const ids=new Set(),paths=new Set(),claims=new Set(manifest.claims.map(c=>c.id));
  if(claims.size!==manifest.claims.length)fail('INVALID_ARGUMENT','Duplicate capture claim ID');
  for(const p of manifest.payloads){
    string(p.id,'payload ID',128);string(p.path,'payload path');integer(p.bytes,'payload bytes');
    if(ids.has(p.id)||paths.has(p.path)||!hash.test(p.digest))fail('INVALID_ARGUMENT','Duplicate or invalid capture payload identity');
    ids.add(p.id);paths.add(p.path);
    if(!p.path.startsWith('captures/')||p.path.startsWith('captures/retention/')||p.path.includes('\\')||p.path.split('/').some(x=>!x||x==='.'||x==='..'))fail('INVALID_ARGUMENT','Unsafe capture payload path');
    if(p.availability.kind==='packed'&&(!p.availability.verifiedEvidence.length||!p.availability.restoration.length))fail('INVALID_ARGUMENT','Packed evidence needs verified restoration sources and procedure');
    if(p.availability.kind==='intentionally-retired'&&!p.availability.dispositionEvidence.length)fail('INVALID_ARGUMENT','Retirement needs attributable disposition evidence');
    if(p.availability.kind==='packed'&&p.availability.path===p.path)fail('INVALID_ARGUMENT','Packed bytes need a distinct recovery locator');
  }
  for(const p of manifest.payloads){
    if(p.dependencies.some(id=>!ids.has(id))||p.requiredBy.some(id=>!claims.has(id)))fail('INVALID_ARGUMENT','Capture dependency/claim identity is unavailable');
  }
  for(const claim of manifest.claims){string(claim.id,'claim ID',128);if(claim.payloadIds.some(id=>!ids.has(id)))fail('INVALID_ARGUMENT','Claim references an unknown payload');}
  // A claim may preserve a historical observation with an explicit limitation,
  // but retirement must never masquerade as directly accessible evidence.
  for(const p of manifest.payloads)if(['authored','world','state','recovery','private'].includes(p.kind)&&p.availability.kind!=='present')fail('FORBIDDEN','Protected capture payloads cannot be minimized by this protocol');
  return manifest;
}
export function readCaptureHead(root,target){
  const dir=captureDirectory(root,target),path=join(dir,'current.json');if(!optionalStat(path))return;
  const head=readPrivateJson(path,8192);
  if(head.formatVersion!==1||canonical(head.target)!==canonical(target)||!Number.isSafeInteger(head.generation)||head.generation<1||!hash.test(head.digest)||!uuid.test(head.record?.id??'')||head.record.systemId!==target.systemId||head.record.contextId!==target.contextId)fail('IDENTITY_CONFLICT','Capture disposition pointer is invalid');
  return head;
}
/** Cooperative scope exclusion. A local lock is never an assertion about external writers. */
export function captureLock(root,target,{operationDigest,reconcile=false}={}){
  const dir=captureDirectory(root,target,{create:true}),path=join(dir,'scope.lock'),value={formatVersion:1,pid:process.pid,id:randomUUID(),target,...(operationDigest?{operationDigest}:{})};
  if(optionalStat(path)&&reconcile&&operationDigest){const old=readPrivateJson(path,8192);let dead=false;try{process.kill(old.pid,0);}catch(e){dead=e.code==='ESRCH';}if(dead&&old.operationDigest===operationDigest&&canonical(old.target)===canonical(target))unlinkSync(path);}
  try{publishPrivate(path,canonical(value)+'\n');}
  catch(e){if(e.code!=='EEXIST')throw e;fail('IDENTITY_CONFLICT','Another or interrupted capture operation owns this scope; reconcile only its exact bound request after observed owner retirement');}
  return()=>{const actual=readPrivateJson(path,8192);if(canonical(actual)!==canonical(value))fail('IDENTITY_CONFLICT','Capture scope lock changed; preserve it');unlinkSync(path);};
}
/** Settle only this completed operation's retired cooperative controller lock.
 * Reconciliation still requires serialized operator custody; this is no OS lease. */
export function settleCaptureLock(root,target,operationDigest){
  const path=join(captureDirectory(root,target),'scope.lock');if(!optionalStat(path))return;
  const old=readPrivateJson(path,8192);if(old.operationDigest!==operationDigest||canonical(old.target)!==canonical(target)||!Number.isSafeInteger(old.pid)||old.pid<1)return;
  try{process.kill(old.pid,0);return;}catch(e){if(e.code!=='ESRCH')return;}
  captureLock(root,target,{operationDigest,reconcile:true})();
}
async function graphRecord(domain,contextId,id){
  const q=await domain('graph.query',{contextId,selector:{ids:[id],assertionStatus:'asserted'},limit:1});
  const item=q.items.find(x=>x.record.ref.id===id);if(!item)fail('NOT_FOUND','Capture manifest is not currently accessible');return item;
}
export async function retainedCapture(root,target,domain){
  const head=readCaptureHead(root,target);if(!head)return;
  const item=await graphRecord(domain,target.contextId,head.record.id),record=item.record.value;
  if(record.kind!=='atom'||canonical(record.schema)!==canonical(captureSchema()))fail('UNSUPPORTED_VERSION','Capture manifest schema is not supported by this installed build');
  const manifest=validateCaptureManifest(record.value);
  if(digest(manifest)!==head.digest||manifest.generation!==head.generation||canonical(manifest.target)!==canonical(target))fail('IDENTITY_CONFLICT','Capture pointer and admitted immutable manifest differ');
  const snapshot=readPrivateJson(join(captureDirectory(root,target),head.generation+'-'+head.digest.slice(7)+'.json'),maximumManifestBytes+4096);
  if(canonical(snapshot)!==canonical({manifest,digest:head.digest,record:head.record}))fail('IDENTITY_CONFLICT','Retained capture representation differs');
  return {head,manifest};
}
export async function captureRead(root,input,domain){
  const {target}=input;captureTarget(target);integer(input.maximumBytes??16384,'read budget',1024);if((input.maximumBytes??16384)>65536)fail('LIMIT_EXCEEDED','Capture read budget exceeds65536bytes');await domain('incident.get',{contextId:target.contextId,incidentId:target.incidentId});
  const selected=await retainedCapture(root,target,domain),packet={target,availability:selected?'registered':'unregistered',payloads:[],omittedPayloadIds:[],omittedFields:[]};
  if(!selected)return packet;
  const {head,manifest}=selected,budget=input.maximumBytes??16384;
  Object.assign(packet,{generation:head.generation,manifestDigest:head.digest,record:head.record});
  const ids=input.payloadIds??manifest.payloads.map(x=>x.id),payloads=ids.map(id=>{const p=manifest.payloads.find(x=>x.id===id);if(!p)fail('NOT_FOUND','Selected capture payload ID is unavailable');return p;});
  packet.omittedPayloadIds=[...ids];packet.omittedFields=['/manifest'];
  const fits=()=>Buffer.byteLength(canonical(packet))<=budget;
  if(!fits())fail('LIMIT_EXCEEDED','Capture metadata and omitted identities exceed the response budget');
  packet.manifest=manifest;packet.omittedFields=[];
  if(!fits()){delete packet.manifest;packet.omittedFields=['/manifest'];}
  for(const p of payloads){
    const actual=optionalStat(payloadPath(root,target,p.path));
    if(actual&&!actual.isFile())fail('IDENTITY_CONFLICT','Capture payload is not a regular file');
    let observation=actual?'present-unverified':'absent';
    if(p.availability.kind==='intentionally-retired'&&actual)observation='unexpectedly-present';
    if(p.availability.kind==='packed'&&!actual){const archive=optionalStat(payloadPath(root,target,p.availability.path));if(archive?.isFile())observation='materialization-required';}
    const prior=packet.omittedPayloadIds;packet.omittedPayloadIds=prior.filter(x=>x!==p.id);packet.payloads.push({id:p.id,path:p.path,declared:p.availability,observation});
    if(!fits()){packet.payloads.pop();packet.omittedPayloadIds=prior;}
  }
  return packet;
}
/** Existing kernel admission plus explicit private publication journal. No payload effects. */
export async function publishCapture(root,input,domain){
  validateSurface('CapturePublication',input);const manifest=validateCaptureManifest(input.manifest),target=manifest.target;
  if(input.contextId!==target.contextId)fail('INVALID_ARGUMENT','Capture publication context differs');
  await domain('incident.get',{contextId:target.contextId,incidentId:target.incidentId});
  string(input.idempotencyKey,'publication retry key',128);integer(input.expectedRevision,'expected revision');
  const dir=captureDirectory(root,target,{create:true}),key=digest({contextId:input.contextId,idempotencyKey:input.idempotencyKey}),journalPath=join(dir,'publication-'+key.slice(7)+'.json'),identity=digest(input);
  const journal=optionalStat(journalPath)?readPrivateJson(journalPath,524288):{formatVersion:1,input,identity,steps:{}};
  if(journal.identity!==identity)fail('IDEMPOTENCY_CONFLICT','Capture retry key names different content');
  if(journal.result){settleCaptureLock(root,target,identity);return {...journal.result,replayed:true};}
  const release=captureLock(root,target,{operationDigest:identity,reconcile:true});
  try{
    const save=()=>replacePrivate(journalPath,canonical(journal)+'\n');
    const before=readCaptureHead(root,target);
    if(!journal.initialized){
      const context=await domain('context.get',{contextId:input.contextId});if(context.revision!==input.expectedRevision)fail('REVISION_CONFLICT','Capture publication basis changed','refresh');
      if(manifest.generation!==(before?.generation??0)+1||manifest.previousDigest!==before?.digest)fail('REVISION_CONFLICT','Capture generation does not extend its current disposition','refresh');
      journal.before=before??null;journal.initialized=true;save();
    }
    async function step(name,method,build){
      const old=journal.steps[name];if(old?.result)return old.result;
      const request=old?.request??await build();if(!old){journal.steps[name]={request};save();}
      const result=await domain(method,request);journal.steps[name].result=result;save();return result;
    }
    const schema=captureSchema();let expectedRevision=input.expectedRevision;
    if(!journal.schemaPresent){
      try{await domain('schema.get',{contextId:input.contextId,schema});journal.schemaPresent=true;save();}
      catch(e){if(e.code!=='NOT_FOUND')throw e;await step('schema','schema.publish',async()=>({contextId:input.contextId,expectedRevision,idempotencyKey:input.idempotencyKey+':schema',schema,document:catalog.surfaceSchemas.CaptureManifest}));expectedRevision++;}
    }
    if(journal.steps.schema?.result)expectedRevision=input.expectedRevision+1;
    const record={id:manifest.id,kind:'atom',schema,value:manifest},ref={systemId:target.systemId,contextId:target.contextId,id:manifest.id};
    await step('record','graph.transact',async()=>({contextId:input.contextId,expectedRevision,idempotencyKey:input.idempotencyKey+':record',changes:[{kind:'record.put',record},{kind:'assertion.put',assertion:{id:randomUUID(),record:ref,evidence:manifest.evidence}}]}));
    const item=await graphRecord(domain,target.contextId,manifest.id);if(canonical(item.record.value)!==canonical(record))fail('IDENTITY_CONFLICT','Capture immutable admission readback differs');
    const current=readCaptureHead(root,target),value={manifest,digest:digest(manifest),record:ref};
    if(canonical(current??null)!==canonical(journal.before)&&current?.digest!==value.digest)fail('REVISION_CONFLICT','Capture pointer advanced; preserve the admitted earlier operation','reconcile');
    const generationPath=join(dir,manifest.generation+'-'+value.digest.slice(7)+'.json');
    if(optionalStat(generationPath)){if(canonical(readPrivateJson(generationPath,maximumManifestBytes+4096))!==canonical(value))fail('IDENTITY_CONFLICT','Capture generation publication differs');}
    else publishPrivate(generationPath,canonical(value)+'\n');
    replacePrivate(join(dir,'current.json'),canonical({formatVersion:1,target,generation:manifest.generation,digest:value.digest,record:ref})+'\n');
    journal.result={target,generation:manifest.generation,digest:value.digest,record:ref,replayed:false};save();return journal.result;
  }finally{release();}
}

/** Selection is about runnable generations, never deletion or a complete dependency proof. */
export function selectCaptureRuns(manifests){
  const groups=new Map(),kept=new Set();
  for(const m of manifests){validateCaptureManifest(m);const key=canonical([m.run.projectId??m.target.contextId,m.run.worktree??null,m.run.category]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);}
  for(const group of groups.values()){
    const active=group.filter(x=>x.run.state==='active'||x.run.current),selected=active.length?active:group.filter(x=>x.run.state==='completed').sort((a,b)=>b.run.order-a.run.order||a.run.id.localeCompare(b.run.id)).slice(0,2);
    for(const m of [...selected,...group.filter(x=>x.run.pins.length)])kept.add(m.run.id);
  }
  const byId=new Map(manifests.map(m=>[m.run.id,m]));if(byId.size!==manifests.length)fail('INVALID_ARGUMENT','Select one current manifest per run');
  for(const id of kept)for(const dependency of byId.get(id).run.dependencies){if(!byId.has(dependency))fail('NOT_FOUND','Required run dependency is outside the selected frontier: '+dependency);kept.add(dependency);}
  return [...kept].sort();
}
