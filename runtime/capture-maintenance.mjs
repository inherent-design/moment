import {spawn} from 'node:child_process';
import {existsSync,statfsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,digest,bytesDigest,fail,DomainError} from './json.mjs';
import {readPrivateJson,readPrivateBytes,publishPrivate,replacePrivate} from './private-files.mjs';
import {validateSurface} from './bindings.mjs';
import {parseJson} from './wire.mjs';
import {captureDirectory,captureLock,settleCaptureLock,payloadPath,retainedCapture,selectCaptureRuns} from './captures.mjs';

const maximumOperationBytes=1073741824;
const protectedKinds=new Set(['authored','world','state','recovery','private']);
function alive(pid){if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
function currentFiles(policyFile,custodyFile){
  const policyBytes=readPrivateBytes(policyFile),custodyBytes=readPrivateBytes(custodyFile),policy=parseJson(policyBytes.toString('utf8')),custody=parseJson(custodyBytes.toString('utf8'));
  validateSurface('CaptureMaintenancePolicy',policy);validateSurface('CaptureCustody',custody);
  if(policy.formatVersion!==1||!policy.enabled||!custody.confirmed||custody.unknownWriters.length||!alive(custody.ownerPid)||!custody.participants.length)fail('FORBIDDEN','Capture policy or coordinated live owner custody is unavailable');
  for(const [name,value,max] of [['maximumFiles',policy.maximumFiles,64],['maximumBytes',policy.maximumBytes,maximumOperationBytes]])if(!Number.isSafeInteger(value)||value<1||value>max)fail('INVALID_ARGUMENT','Invalid capture policy '+name);
  const policyDigest=bytesDigest(policyBytes),custodyDigest=bytesDigest(custodyBytes);
  if(custody.policyDigest!==policyDigest)fail('IDENTITY_CONFLICT','Capture custody names a different policy representation');
  return {policy,custody,policyDigest,custodyDigest};
}
function included(scope,target){return scope.some(x=>canonical(x)===canonical(target));}
function protectedPath(path){return path.split('/').some(x=>['state','recipient-state','recovery','runtime','retention','storage-minimization','world','worlds','saves','backups','lods'].includes(x.toLowerCase()));}
const nativePath=fileURLToPath(new URL('./capture-native.py',import.meta.url));

/** A finite owned subprocess; never an inference worker or primary process. */
export function nativeCapture(operation,input,{python='/usr/bin/python3',adapter=nativePath,onSpawn=()=>{},timeoutMillis=30000}={}){
  if(process.platform!=='darwin')return Promise.reject(new DomainError('CAPABILITY_UNAVAILABLE','Native exact-sharing adapter requires qualified Darwin APIs'));
  if(Buffer.byteLength(canonical(input))>520000)return Promise.reject(new DomainError('LIMIT_EXCEEDED','Native capture input exceeds its bounded frame'));
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-I',adapter,operation],{env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
    let output='',diagnostic='',finished=false,expired=false;
    const timer=setTimeout(()=>{expired=true;child.kill('SIGKILL');},timeoutMillis);
    child.stdout.on('data',b=>{output+=b;if(Buffer.byteLength(output)>524288){expired=true;child.kill('SIGKILL');}});
    child.stderr.on('data',b=>{if(diagnostic.length<8192)diagnostic+=b.toString().slice(0,8192-diagnostic.length);});
    const done=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(value);};
    child.once('error',()=>done(new DomainError('CAPABILITY_UNAVAILABLE','Selected native capture adapter could not start')));
    child.once('close',()=>{
      if(expired)return done(new DomainError('OUTCOME_UNKNOWN','Owned capture adapter stopped without a complete observation; retain the exact plan/journal','reconcile'));
      try{const result=parseJson(output);if(!result.ok)return done(new DomainError(result.error.code,result.error.message,result.error.retry));done(null,result.value);}
      catch{return done(new DomainError('OUTCOME_UNKNOWN','Capture adapter output is unavailable; preserve its exact journal','reconcile'));}
    });
    child.stdin.on('error',()=>{});onSpawn(child);child.stdin.end(canonical({formatVersion:1,...input}));
  });
}

export async function planCaptureMaintenance(root,input,domain,backend=nativeCapture){
  validateSurface('CaptureMaintenanceRequest',input);
  const {policy,custody,policyDigest,custodyDigest}=currentFiles(input.policyFile,input.custodyFile);
  if(!included(policy.scope,input.target)||!included(custody.scope,input.target))fail('FORBIDDEN','Capture target is outside the coordinated policy scope');
  if(!input.pairs.length||input.pairs.length>policy.maximumFiles||new Set(input.pairs.map(x=>x.targetId)).size!==input.pairs.length)fail('LIMIT_EXCEEDED','Select bounded distinct target payloads');
  const context=await domain('context.get',{contextId:input.target.contextId});await domain('incident.get',{contextId:input.target.contextId,incidentId:input.target.incidentId});
  const retained=await retainedCapture(root,input.target,domain);if(!retained||retained.head.digest!==input.manifestDigest)fail('REVISION_CONFLICT','Selected capture disposition changed or is unavailable','refresh');
  const manifest=retained.manifest,roots=[join(root,'incidents',input.target.incidentId,'captures')],protectedPaths=[...manifest.payloads.filter(x=>protectedKinds.has(x.kind)||x.pins.length).map(x=>payloadPath(root,input.target,x.path)),...custody.exclusions.map(x=>payloadPath(root,input.target,x))],items=[],deferred=[];
  const selectedTargetIds=new Set(input.pairs.map(x=>x.targetId));
  if(input.pairs.some(x=>selectedTargetIds.has(x.sourceId)))fail('INVALID_ARGUMENT','A retained survivor cannot also be replaced in the same plan');
  let bytes=0;
  for(const pair of input.pairs){
    const source=manifest.payloads.find(x=>x.id===pair.sourceId),target=manifest.payloads.find(x=>x.id===pair.targetId);
    if(!source||!target)fail('NOT_FOUND','Selected capture payload identity is unavailable');
    const reject=reason=>deferred.push({id:pair.targetId,reason});
    if(source.id===target.id||!policy.kinds.includes(source.kind)||!policy.kinds.includes(target.kind)||protectedKinds.has(source.kind)||protectedKinds.has(target.kind)||source.pins.length||target.pins.length||protectedPath(source.path)||protectedPath(target.path)){reject('Protected, pinned or unsupported capture class');continue;}
    if(!['present','exact-shared'].includes(source.availability.kind)||!['present','exact-shared'].includes(target.availability.kind)){reject('Exact local survivor/target representation is not present');continue;}
    if(source.digest!==target.digest||source.bytes!==target.bytes){reject('Original byte identities differ');continue;}
    if(bytes+target.bytes>policy.maximumBytes){reject('Operation byte budget');continue;}
    const paths=[payloadPath(root,input.target,source.path),payloadPath(root,input.target,target.path)];
    try{
      const [a,b]=await backend('inspect',{paths,roots,protectedPaths,maximumBytes:policy.maximumBytes});
      if(a.sha256!==source.digest.slice(7)||b.sha256!==target.digest.slice(7)||a.size!==source.bytes||b.size!==target.bytes)fail('IDENTITY_CONFLICT','Current bytes differ from the retained payload identity');
      if(['mode','uid','gid','flags'].some(k=>a[k]!==b[k])||canonical(a.attrs)!==canonical(b.attrs)){reject('Preservation metadata differs');continue;}
      // Native executable/signature preservation has not been qualified for this first adapter.
      if((a.mode|b.mode)&0o111){reject('Executable preservation requires a separately qualified adapter');continue;}
      items.push({source:paths[0],target:paths[1],sourceId:source.id,targetId:target.id,source_before:a,before:b});bytes+=target.bytes;
    }catch(e){if(e.code==='OUTCOME_UNKNOWN')throw e;reject(e.message);}
  }
  const plan={formatVersion:1,id:input.id,operation:'exact-share',target:input.target,contextRevision:context.revision,manifestDigest:retained.head.digest,policyFile:resolve(input.policyFile),policyDigest,custodyFile:resolve(input.custodyFile),custodyDigest,roots,items,protectedPaths,deferred,retainedRunIds:selectCaptureRuns([manifest]),duplicateAllocatedUpperBound:items.reduce((n,x)=>n+x.before.allocated,0),limitations:['Selected incident/frontier only; no claim of complete reverse-reference discovery.','Writer custody is cooperative and confirmed by the operator, not a security boundary.','Preserves paths, bytes and qualified metadata; inode/ctime change.','Allocated upper bounds and observed free-space changes do not measure exclusive APFS extents.','Exact byte sharing only; no raw retirement, orphan pruning or world/state effects.']};
  validateSurface('CaptureMaintenancePlan',plan);return plan;
}

export async function applyCaptureMaintenance(root,plan,domain,{backend=nativeCapture,reconcile=false}={}){
  validateSurface('CaptureMaintenancePlan',plan);
  const identity=digest(plan),dir=captureDirectory(root,plan.target,{create:true}),receiptPath=join(dir,'maintenance-'+identity.slice(7)+'.receipt.json'),journalPath=join(dir,'maintenance-'+identity.slice(7)+'.journal.json');
  await domain('incident.get',{contextId:plan.target.contextId,incidentId:plan.target.incidentId});
  if(existsSync(receiptPath)){const old=readPrivateJson(receiptPath,524288);if(old.planDigest!==identity)fail('IDENTITY_CONFLICT','Capture receipt names a different plan');if(reconcile)settleCaptureLock(root,plan.target,identity);return old;}
  const statePath=join(dir,'maintenance-'+identity.slice(7)+'.plan.json');
  if(existsSync(statePath)){if(canonical(readPrivateJson(statePath,524288))!==canonical(plan))fail('IDENTITY_CONFLICT','Retained maintenance plan differs');}
  else publishPrivate(statePath,canonical(plan)+'\n');
  const release=captureLock(root,plan.target,{operationDigest:identity,reconcile});
  const check=async()=>{
    const {policy,custody,policyDigest,custodyDigest}=currentFiles(plan.policyFile,plan.custodyFile);
    if(policyDigest!==plan.policyDigest||custodyDigest!==plan.custodyDigest||!included(policy.scope,plan.target)||!included(custody.scope,plan.target))fail('REVISION_CONFLICT','Capture policy/custody changed since preview','refresh');
    const context=await domain('context.get',{contextId:plan.target.contextId});if(context.revision!==plan.contextRevision)fail('REVISION_CONFLICT','Capture authority/context changed since preview','refresh');
    const current=await retainedCapture(root,plan.target,domain);if(!current||current.head.digest!==plan.manifestDigest)fail('REVISION_CONFLICT','Capture disposition changed since preview','refresh');
    if(plan.items.length>policy.maximumFiles||plan.items.reduce((n,x)=>n+x.before.size,0)>policy.maximumBytes)fail('LIMIT_EXCEEDED','Frozen plan exceeds current operation bounds');
    const expectedProtected=[...current.manifest.payloads.filter(x=>protectedKinds.has(x.kind)||x.pins.length).map(x=>payloadPath(root,plan.target,x.path)),...custody.exclusions.map(x=>payloadPath(root,plan.target,x))];if(canonical(expectedProtected)!==canonical(plan.protectedPaths))fail('FORBIDDEN','Protected capture frontier differs');
    if(!plan.items.length||new Set(plan.items.map(x=>x.targetId)).size!==plan.items.length||plan.items.some(x=>plan.items.some(y=>y.targetId===x.sourceId)))fail('INVALID_ARGUMENT','Select distinct replacements and unchanged survivors');
    // Reconstruct the allowlist from the current manifest; a hand-edited plan cannot add paths.
    const rootPath=join(root,'incidents',plan.target.incidentId,'captures');if(canonical(plan.roots)!==canonical([rootPath]))fail('INVALID_ARGUMENT','Capture plan roots differ');
    for(const item of plan.items){const source=current.manifest.payloads.find(x=>x.id===item.sourceId),target=current.manifest.payloads.find(x=>x.id===item.targetId);if(!source||!target||item.source!==payloadPath(root,plan.target,source.path)||item.target!==payloadPath(root,plan.target,target.path)||source.digest!==target.digest||item.before.sha256!==target.digest.slice(7)||item.source_before.sha256!==source.digest.slice(7)||item.before.size!==target.bytes||item.source_before.size!==source.bytes||!policy.kinds.includes(source.kind)||!policy.kinds.includes(target.kind)||protectedKinds.has(source.kind)||protectedKinds.has(target.kind)||source.pins.length||target.pins.length||protectedPath(source.path)||protectedPath(target.path))fail('FORBIDDEN','Plan is not eligible under its current payload manifest');}
    return policy;
  };
  const free=()=>{const fs=statfsSync(root);return fs.bavail*fs.bsize;},before=free();
  try{
    let completed=0;
    for(let index=0;index<plan.items.length;index++){
      const policy=await check();await backend('apply-one',{plan,planDigest:identity,index,journalPath,scopeLock:join(dir,'scope.lock'),controllerPid:process.pid,maximumBytes:policy.maximumBytes,reconcile});completed++;
    }
    const receipt={formatVersion:1,planDigest:identity,target:plan.target,state:'complete',completedItems:completed,files:plan.items.length,logicalPathsRemoved:0,logicalBytesRemoved:0,observedFreeBytesBefore:before,observedFreeBytesAfter:free(),finishedAt:new Date().toISOString(),limitations:plan.limitations,journalPath};
    validateSurface('CaptureMaintenanceReceipt',receipt);publishPrivate(receiptPath,canonical(receipt)+'\n');return receipt;
  }finally{release();}
}
