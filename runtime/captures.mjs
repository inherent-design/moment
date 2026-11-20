import * as core from './semantic-core.mjs';
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

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function privateRecord(value,required,optional,label){
  if(!plain(value)||required.some(key=>!Object.hasOwn(value,key)))fail('IDENTITY_CONFLICT','Incomplete capture '+label);
  if(Object.keys(value).some(key=>![...required,...optional].includes(key)))fail('UNSUPPORTED_VERSION','Unsupported capture '+label+' fields; preserve its exact state');
}
function storedVersion(value,label){if(!core.storageVersionOne(value?.formatVersion))fail('UNSUPPORTED_VERSION','Unsupported capture '+label+' version; preserve its exact state');}
function captureHead(head,target){
  storedVersion(head,'pointer');privateRecord(head,['formatVersion','target','generation','digest','record'],[],'pointer');captureTarget(head.target);
  if(!core.sameValue(head.target,target)||!Number.isSafeInteger(head.generation)||head.generation<1||!hash.test(head.digest)||!plain(head.record)||Object.keys(head.record).sort().join(',')!=='contextId,id,systemId'||!uuid.test(head.record.id)||head.record.systemId!==target.systemId||head.record.contextId!==target.contextId)fail('IDENTITY_CONFLICT','Capture disposition pointer is invalid');
  return head;
}
function storedLock(value){
  storedVersion(value,'scope lock');privateRecord(value,['formatVersion','id','pid','target'],['operationDigest'],'scope lock');captureTarget(value.target);
  if(!uuid.test(value.id)||!Number.isSafeInteger(value.pid)||value.pid<1||value.pid>0x7fffffff||value.operationDigest!==undefined&&!hash.test(value.operationDigest))fail('IDENTITY_CONFLICT','Capture scope custody format is invalid');
  return value;
}
const retired=pid=>{try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}};
function publicationJournal(value,input,identity){
  storedVersion(value,'publication journal');privateRecord(value,['formatVersion','input','identity','steps','initialized','before'],['schemaPresent','result'],'publication journal');
  if(value.identity!==identity||!core.sameValue(value.input,input))fail('IDEMPOTENCY_CONFLICT','Capture retry key names different content');
  if(value.initialized!==true||value.schemaPresent!==undefined&&value.schemaPresent!==true)fail('IDENTITY_CONFLICT','Capture publication preparation is invalid');
  if(value.before!==null)captureHead(value.before,input.manifest.target);
  privateRecord(value.steps,[],['schema','record'],'publication steps');
  const schema=captureSchema(),manifest=input.manifest,ref={systemId:manifest.target.systemId,contextId:input.contextId,id:manifest.id};
  for(const [name,step] of Object.entries(value.steps)){
    privateRecord(step,['request'],['result'],'publication step');let expected;
    if(name==='schema')expected={contextId:input.contextId,expectedRevision:input.expectedRevision,idempotencyKey:input.idempotencyKey+':schema',schema,document:catalog.surfaceSchemas.CaptureManifest};
    else{
      const id=step.request?.changes?.[1]?.assertion?.id;if(typeof id!=='string'||!uuid.test(id))fail('IDENTITY_CONFLICT','Capture publication support identity is invalid');
      expected={contextId:input.contextId,expectedRevision:value.steps.schema?.result?core.counterNext(input.expectedRevision):input.expectedRevision,idempotencyKey:input.idempotencyKey+':record',changes:[{kind:'record.put',record:{id:manifest.id,kind:'atom',schema,value:manifest}},{kind:'assertion.put',assertion:{id,record:ref,evidence:manifest.evidence}}]};
    }
    if(!core.sameValue(step.request,expected))fail('IDENTITY_CONFLICT','Retained capture publication request differs from its exact input');
  }
  if(value.result){validateSurface('CapturePublicationResult',value.result);if(value.result.replayed!==false||value.result.generation!==manifest.generation||value.result.digest!==digest(manifest)||!core.sameValue(value.result.target,manifest.target)||!core.sameValue(value.result.record,ref))fail('IDENTITY_CONFLICT','Retained capture publication result differs');}
  return value;
}
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
  if(!core.captureManifestHeader(manifest)||manifest.previousDigest!==undefined&&!hash.test(manifest.previousDigest))fail('INVALID_ARGUMENT','Capture generation and previous digest disagree');
  if(manifest.payloads.length>128||manifest.claims.length>128)fail('LIMIT_EXCEEDED','Capture manifest exceeds128 payload/claim entries');
  string(manifest.run.id,'run ID',128);string(manifest.run.category,'category',256);
  const ids=new Set(),paths=new Set(),claims=new Set(manifest.claims.map(c=>c.id));
  if(claims.size!==manifest.claims.length)fail('INVALID_ARGUMENT','Duplicate capture claim ID');
  for(const p of manifest.payloads){
    string(p.id,'payload ID',128);string(p.path,'payload path');integer(p.bytes,'payload bytes');
    if(ids.has(p.id)||paths.has(p.path)||!hash.test(p.digest))fail('INVALID_ARGUMENT','Duplicate or invalid capture payload identity');
    ids.add(p.id);paths.add(p.path);
    if(!p.path.startsWith('captures/')||p.path.startsWith('captures/retention/')||p.path.includes('\\')||p.path.split('/').some(x=>!x||x==='.'||x==='..'))fail('INVALID_ARGUMENT','Unsafe capture payload path');
    if(!core.captureDeclaration(p))fail('INVALID_ARGUMENT','Capture representation needs distinct recovery and attributable evidence');
  }
  for(const p of manifest.payloads){
    if(!core.textSubset(p.dependencies,[...ids])||!core.textSubset(p.requiredBy,[...claims]))fail('INVALID_ARGUMENT','Capture dependency/claim identity is unavailable');
  }
  for(const claim of manifest.claims){string(claim.id,'claim ID',128);if(!core.textSubset(claim.payloadIds,[...ids]))fail('INVALID_ARGUMENT','Claim references an unknown payload');}
  // A claim may preserve a historical observation with an explicit limitation,
  // but retirement must never masquerade as directly accessible evidence.
  for(const p of manifest.payloads)if(!core.captureProtectedAvailability(p.kind,p.availability.kind))fail('FORBIDDEN','Protected capture payloads cannot be minimized by this protocol');
  return manifest;
}
export function readCaptureHead(root,target){
  const dir=captureDirectory(root,target),path=join(dir,'current.json');if(!optionalStat(path))return;
  return captureHead(readPrivateJson(path,8192),target);
}
/** Cooperative scope exclusion. A local lock is never an assertion about external writers. */
export function captureLock(root,target,{operationDigest,reconcile=false}={}){
  const dir=captureDirectory(root,target,{create:true}),path=join(dir,'scope.lock'),value={formatVersion:1,pid:process.pid,id:randomUUID(),target,...(operationDigest?{operationDigest}:{})};
  if(optionalStat(path)&&reconcile&&operationDigest){const old=storedLock(readPrivateJson(path,8192));if(core.captureLockReclaim(old,target,operationDigest,retired(old.pid)))unlinkSync(path);}
  try{publishPrivate(path,canonical(value)+'\n');}
  catch(e){if(e.code!=='EEXIST')throw e;fail('IDENTITY_CONFLICT','Another or interrupted capture operation owns this scope; reconcile only its exact bound request after observed owner retirement');}
  return()=>{const actual=storedLock(readPrivateJson(path,8192));if(canonical(actual)!==canonical(value))fail('IDENTITY_CONFLICT','Capture scope lock changed; preserve it');unlinkSync(path);};
}
/** Settle only this completed operation's retired cooperative controller lock.
 * Reconciliation still requires serialized operator custody; this is no OS lease. */
export function settleCaptureLock(root,target,operationDigest){
  const path=join(captureDirectory(root,target),'scope.lock');if(!optionalStat(path))return;
  const old=storedLock(readPrivateJson(path,8192));if(core.captureLockReclaim(old,target,operationDigest,retired(old.pid)))captureLock(root,target,{operationDigest,reconcile:true})();
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
  const fits=()=>core.resourceLessOrEqual(Buffer.byteLength(canonical(packet)),budget);
  if(!fits())fail('LIMIT_EXCEEDED','Capture metadata and omitted identities exceed the response budget');
  packet.manifest=manifest;packet.omittedFields=[];
  if(!fits()){delete packet.manifest;packet.omittedFields=['/manifest'];}
  for(const p of payloads){
    const actual=optionalStat(payloadPath(root,target,p.path));
    if(actual&&!actual.isFile())fail('IDENTITY_CONFLICT','Capture payload is not a regular file');
    const archive=p.availability.kind==='packed'&&!actual?optionalStat(payloadPath(root,target,p.availability.path)):undefined,observation=core.captureObservation(p.availability.kind,!!actual,!!archive?.isFile());
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
  const journal=optionalStat(journalPath)?publicationJournal(readPrivateJson(journalPath,524288),input,identity):{formatVersion:1,input,identity,steps:{}};
  if(journal.identity!==identity)fail('IDEMPOTENCY_CONFLICT','Capture retry key names different content');
  if(journal.result){settleCaptureLock(root,target,identity);return {...journal.result,replayed:true};}
  const release=captureLock(root,target,{operationDigest:identity,reconcile:true});
  try{
    const save=()=>replacePrivate(journalPath,canonical(journal)+'\n');
    const before=readCaptureHead(root,target);
    if(!journal.initialized){
      const context=await domain('context.get',{contextId:input.contextId});if(context.revision!==input.expectedRevision)fail('REVISION_CONFLICT','Capture publication basis changed','refresh');
      const next=core.captureGeneration(manifest,before);if(next==='CaptureGenerationExhausted')fail('LIMIT_EXCEEDED','Capture generation is exhausted');if(next!=='CaptureGenerationReady')fail('REVISION_CONFLICT','Capture generation does not extend its current disposition','refresh');
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
      catch(e){if(e.code!=='NOT_FOUND')throw e;await step('schema','schema.publish',async()=>({contextId:input.contextId,expectedRevision,idempotencyKey:input.idempotencyKey+':schema',schema,document:catalog.surfaceSchemas.CaptureManifest}));expectedRevision=core.counterNext(expectedRevision);}
    }
    if(journal.steps.schema?.result)expectedRevision=core.counterNext(input.expectedRevision);
    const record={id:manifest.id,kind:'atom',schema,value:manifest},ref={systemId:target.systemId,contextId:target.contextId,id:manifest.id};
    await step('record','graph.transact',async()=>({contextId:input.contextId,expectedRevision,idempotencyKey:input.idempotencyKey+':record',changes:[{kind:'record.put',record},{kind:'assertion.put',assertion:{id:randomUUID(),record:ref,evidence:manifest.evidence}}]}));
    const item=await graphRecord(domain,target.contextId,manifest.id);if(canonical(item.record.value)!==canonical(record))fail('IDENTITY_CONFLICT','Capture immutable admission readback differs');
    const current=readCaptureHead(root,target),value={manifest,digest:digest(manifest),record:ref};
    if(!core.capturePointer(current,journal.before,value.digest))fail('REVISION_CONFLICT','Capture pointer advanced; preserve the admitted earlier operation','reconcile');
    const generationPath=join(dir,manifest.generation+'-'+value.digest.slice(7)+'.json');
    if(optionalStat(generationPath)){if(canonical(readPrivateJson(generationPath,maximumManifestBytes+4096))!==canonical(value))fail('IDENTITY_CONFLICT','Capture generation publication differs');}
    else publishPrivate(generationPath,canonical(value)+'\n');
    replacePrivate(join(dir,'current.json'),canonical({formatVersion:1,target,generation:manifest.generation,digest:value.digest,record:ref})+'\n');
    journal.result={target,generation:manifest.generation,digest:value.digest,record:ref,replayed:false};save();return journal.result;
  }finally{release();}
}

/** Selection is about runnable generations, never deletion or a complete dependency proof. */
export function selectCaptureRuns(manifests){
  for(const manifest of manifests)validateCaptureManifest(manifest);return core.captureRuns(manifests);
}
