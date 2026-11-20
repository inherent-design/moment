import {mkdirSync,lstatSync,readdirSync,openSync,closeSync,readSync,fstatSync,constants,realpathSync,statSync} from 'node:fs';
import {join,isAbsolute,resolve,sep} from 'node:path';
import {canonical,digest,bytesDigest,fail,DomainError} from './json.mjs';
import {publishPrivate} from './private-files.mjs';
import {sealCursor,openCursor} from './cursors.mjs';
import {select,tokens} from './pointers.mjs';

export const guidanceProfile='moment-guidance/1';
export const within=(root,path)=>path===root || path.startsWith(root+sep);
const identity=hash=>{const v=hash.slice(7,39);return `${v.slice(0,8)}-${v.slice(8,12)}-${v.slice(12,16)}-${v.slice(16,20)}-${v.slice(20)}`;};
const utf8=bytes=>{try{return new TextDecoder('utf8',{fatal:true}).decode(bytes);}catch{fail('INVALID_ARGUMENT','Selected source is not valid UTF-8');}};

/** Private immutable component bytes, not the proposed public artifact service. */
export class GuidanceBodies {
  constructor(directory,{maximumBytes=33554432,maximumBodyBytes=262144,maximumBodies=8192}={}) {
    this.directory=directory;this.maximumBytes=maximumBytes;this.maximumBodyBytes=maximumBodyBytes;this.maximumBodies=maximumBodies;
    mkdirSync(directory,{recursive:true,mode:0o700});const stat=lstatSync(directory);
    if(!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==process.getuid() || stat.mode&0o077)fail('IDENTITY_CONFLICT','Guidance bytes need a private owned directory');
  }
  path(hash) {if(!/^sha256:[0-9a-f]{64}$/.test(hash))fail('INVALID_ARGUMENT','Invalid component digest');return join(this.directory,hash.slice(7));}
  get(hash) {
    const fd=openSync(this.path(hash),constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const stat=fstatSync(fd);if(!stat.isFile() || stat.uid!==process.getuid() || stat.mode&0o077 || stat.size>this.maximumBodyBytes)fail('IDENTITY_CONFLICT','Guidance bytes have invalid custody or size');
      const bytes=Buffer.alloc(this.maximumBodyBytes+1);let length=0,n;
      while(length<bytes.length && (n=readSync(fd,bytes,length,bytes.length-length,null)))length+=n;
      const body=bytes.subarray(0,length);if(bytesDigest(body)!==hash)fail('IDENTITY_CONFLICT','Guidance bytes do not match their admitted identity');return body;
    }finally{closeSync(fd);}
  }
  put(bytes) {
    const body=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes),hash=bytesDigest(body);
    if(body.length>this.maximumBodyBytes)fail('LIMIT_EXCEEDED','Guidance body exceeds its component bound');
    try{this.get(hash);return hash;}catch(error){if(error.code!=='ENOENT')throw error;}
    let total=0,count=0;for(const name of readdirSync(this.directory)) {
      if(!/^[0-9a-f]{64}$/.test(name))fail('IDENTITY_CONFLICT','Unexpected component file; inspect retained bytes');
      const stat=lstatSync(join(this.directory,name));if(!stat.isFile() || stat.isSymbolicLink() || stat.uid!==process.getuid() || stat.mode&0o077)fail('IDENTITY_CONFLICT','Invalid retained component custody');total+=stat.size;count++;
    }
    if(total+body.length>this.maximumBytes || count>=this.maximumBodies)fail('LIMIT_EXCEEDED','Guidance byte retention is full; preserve referenced and recovery bytes before pruning');
    try{publishPrivate(this.path(hash),body);}catch(error){if(error.code!=='EEXIST')throw error;this.get(hash);}return hash;
  }
}

export function selectSource(bytes,selection) {
  const text=utf8(bytes);let selected,transformation='utf8';
  if(selection.kind==='whole')selected=bytes;
  else if(selection.kind==='utf8-range') {
    if(selection.offset+selection.byteLength>bytes.length)fail('INVALID_ARGUMENT','Source range exceeds its whole representation');
    utf8(bytes.subarray(0,selection.offset));utf8(bytes.subarray(selection.offset,selection.offset+selection.byteLength));
    selected=bytes.subarray(selection.offset,selection.offset+selection.byteLength);
  } else if(selection.kind==='lines') {
    const lines=text.match(/[^\n]*\n|[^\n]+$/g)??[];
    if(selection.first<1 || selection.last<selection.first || selection.last>lines.length)fail('INVALID_ARGUMENT','Source line range is unavailable');
    selected=Buffer.from(lines.slice(selection.first-1,selection.last).join(''));
  } else if(selection.kind==='json-pointer') {
    tokens(selection.pointer);let value;try{value=JSON.parse(text);}catch{fail('INVALID_ARGUMENT','JSON selection requires a valid JSON whole representation');}
    const found=select(value,selection.pointer);if(!found.found)fail('INVALID_ARGUMENT','Source JSON pointer is unavailable');
    transformation=typeof found.value==='string'?'json-string':'canonical-json';selected=Buffer.from(typeof found.value==='string'?found.value:canonical(found.value));
  } else fail('INVALID_ARGUMENT','Source selection is unsupported');
  return {bytes:Buffer.from(selected),transformation};
}

/** Source registration/observation and candidate admission share the kernel transaction. */
export class Guidance {
  constructor(kernel,{bodies,fileRoots=[],workerStatus=()=>({state:'disabled',reason:'No guidance provider is configured'})}={}) {
    this.k=kernel;this.bodies=bodies;this.fileRoots=fileRoots.map(root=>realpathSync(root));this.workerStatus=workerStatus;
  }
  source(snapshot,id,access) {
    const stored=snapshot.controlState.guidanceSources?.[id];if(!stored)fail('NOT_FOUND','Registered source not found');
    this.checkSource(snapshot,stored,access);return stored;
  }
  checkSource(snapshot,stored,access) {
    const d=stored.value.definition,refs=[stored.ref,...d.evidence.sources,...(d.locator.kind==='record'?[d.locator.ref]:[])];
    if(refs.some(ref=>!access.canRead(ref)))fail('NOT_FOUND','Source or its dependencies are inaccessible');
    for(const ref of refs.slice(1))this.k.lookup(snapshot,ref);
  }
  capture(snapshot,id,access) {
    const stored=snapshot.controlState.guidanceCaptures?.[id];if(!stored)fail('NOT_FOUND','Capture not found');
    this.source(snapshot,stored.value.source.id,access);
    for(const ref of stored.value.capture.evidence.sources)if(!access.canRead(ref))fail('NOT_FOUND','Capture dependencies are inaccessible');
    return stored;
  }
  requestAccess(snapshot,method,input,access) {
    if(method==='guidance.register') {
      if(!access.operator)fail('FORBIDDEN','Source registration and locator changes require the local operator');
      this.k.executions.evidence(snapshot,input.definition.evidence,access);
      if(input.definition.locator.kind==='record') {if(!snapshot.records.some(r=>r.ref.id===input.definition.locator.ref.id))fail('INVALID_ARGUMENT','The record adapter accepts semantic records; use native procedures for control-state captures');if(!access.canRead(input.definition.locator.ref))fail('NOT_FOUND','Source record inaccessible');this.k.lookup(snapshot,input.definition.locator.ref);}
    }
    if(method==='guidance.refresh')this.source(snapshot,input.sourceId,access);
    if(method==='guidance.review') {
      for(const id of input.sourceIds??[])this.source(snapshot,id,access);
      for(const ref of input.task.sourceRefs)this.k.awareness.detail(snapshot,ref,access);
    }
  }
  register(snapshot,input,principal,access,control) {
    const d=input.definition;
    if(d.locations.some(path=>!isAbsolute(path) || resolve(path)!==path) || d.locator.kind==='file' && (!isAbsolute(d.locator.path) || resolve(d.locator.path)!==d.locator.path))fail('INVALID_ARGUMENT','Source paths and associations must be normalized absolute paths');
    const previous=snapshot.controlState.guidanceSources?.[input.id];
    if(!previous) {this.k.ensureNewId(snapshot,input.id);if(Object.keys(snapshot.controlState.guidanceSources??{}).length>=256)fail('LIMIT_EXCEEDED','Source registry capacity reached');}
    const definitionDigest=digest(d),same=previous?.value.definitionDigest===definitionDigest;
    const value={id:input.id,definition:d,definitionDigest,active:input.active,...(previous?.value.lastCapture?{lastCapture:previous.value.lastCapture}:{}),...(same && previous.value.latest?{latest:previous.value.latest}:{})};
    const stored=this.k.stored(snapshot.context.id,value,snapshot.context.revision+1,principal);
    control('guidanceSources',input.id,stored);return stored;
  }
  readFile(path) {
    const real=realpathSync(path);
    if(real!==path)fail('IDENTITY_CONFLICT','Registered file resolved differently; revise its locator explicitly');
    if(!this.fileRoots.some(root=>within(root,real)))fail('FORBIDDEN','Registered file is outside configured capture roots');
    const selectedStat=statSync(real);const fd=openSync(real,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const before=fstatSync(fd);if(realpathSync(path)!==real || before.dev!==selectedStat.dev || before.ino!==selectedStat.ino)fail('IDENTITY_CONFLICT','Source path changed during open');if(!before.isFile())fail('INVALID_ARGUMENT','Source must be a regular file');
      if(before.size>this.bodies.maximumBodyBytes)fail('LIMIT_EXCEEDED','Whole source exceeds intake bound');
      const bytes=Buffer.alloc(this.bodies.maximumBodyBytes+1);let length=0,n;
      while(length<bytes.length && (n=readSync(fd,bytes,length,bytes.length-length,null)))length+=n;
      const after=fstatSync(fd),currentPath=statSync(path);if(realpathSync(path)!==real || after.dev!==currentPath.dev || after.ino!==currentPath.ino)fail('IDENTITY_CONFLICT','Source path changed during capture');
      if(length>this.bodies.maximumBodyBytes)fail('LIMIT_EXCEEDED','Whole source grew beyond intake bound');
      if(before.dev!==after.dev || before.ino!==after.ino || before.size!==after.size || before.mtimeMs!==after.mtimeMs)fail('IDENTITY_CONFLICT','Source changed during capture');
      return {bytes:bytes.subarray(0,length),origin:{kind:'file',path:real,device:String(after.dev),inode:String(after.ino),mtimeMillis:after.mtimeMs}};
    } finally{closeSync(fd);}
  }
  refresh(snapshot,input,principal,access,control) {
    const stored=this.source(snapshot,input.sourceId,access),source=stored.value,d=source.definition;
    if(!source.active)fail('FORBIDDEN','Withdrawn source is ineligible for new observations');
    if(!this.bodies)fail('CAPABILITY_UNAVAILABLE','Guidance byte storage is not configured');
    const observedAt=new Date(this.k.clock.wall()).toISOString();let latest;
    try {
      let whole,origin,locator=d.locator,representation='utf8';
      if(locator.kind==='file')({bytes:whole,origin}=this.readFile(locator.path));
      else {const record=this.k.lookup(snapshot,locator.ref);whole=Buffer.from(canonical(record.value));origin={kind:'record',ref:record.ref,digest:record.digest,revision:record.revision};locator={...locator,digest:record.digest};representation='canonical-json';}
      const selected=selectSource(whole,d.selection),wholeDigest=this.bodies.put(whole),contentDigest=this.bodies.put(selected.bytes);
      const value={source:stored.ref,definitionDigest:source.definitionDigest,wholeDigest,wholeByteLength:whole.length,transformation:d.selection.kind==='whole'?representation:selected.transformation,origin,capture:{locator,selection:d.selection,contentDigest,mediaType:(d.selection.kind==='json-pointer' && selected.transformation==='canonical-json' || d.selection.kind==='whole' && representation==='canonical-json')?'application/json':'text/plain; charset=utf-8',classification:d.classification,content:{kind:'stored-bytes',digest:contentDigest,byteLength:selected.bytes.length},observedAt,evidence:{...d.evidence,sources:[...d.evidence.sources,...(d.locator.kind==='record'?[d.locator.ref]:[])]}}};
      const id=identity(digest([stored.ref,source.definitionDigest,wholeDigest,contentDigest,origin.kind==='record'?origin:null]));
      let capture=snapshot.controlState.guidanceCaptures?.[id];
      if(!capture) {this.k.ensureNewId(snapshot,id);if(Object.keys(snapshot.controlState.guidanceCaptures??{}).length>=2048)fail('LIMIT_EXCEEDED','Guidance capture metadata retention reached');capture=this.k.stored(snapshot.context.id,value,snapshot.context.revision+1,principal,id);control('guidanceCaptures',id,capture);}
      latest={state:'ready',observedAt,detail:'Whole and selected content captured; applicability remains an agent judgment',capture:capture.ref};
    } catch(error) {
      if(error instanceof DomainError && !['FORBIDDEN','LIMIT_EXCEEDED','IDENTITY_CONFLICT','INVALID_ARGUMENT'].includes(error.code))throw error;
      const state=error.code==='ENOENT'?'missing':['EACCES','EPERM','FORBIDDEN'].includes(error.code)?'denied':error.code==='LIMIT_EXCEEDED'?'too_large':error.code==='IDENTITY_CONFLICT'?'changed':'unsupported';
      latest={state,observedAt,detail:error instanceof DomainError?error.message:'Source is unavailable through its selected adapter'};
    }
    const updated=this.k.stored(snapshot.context.id,{...source,latest,...(latest.capture?{lastCapture:latest.capture}:{})},snapshot.context.revision+1,principal,source.id);control('guidanceSources',source.id,updated);return updated;
  }
  selected(snapshot,input,access) {
    if(input.location!==undefined && (!isAbsolute(input.location) || resolve(input.location)!==input.location))fail('INVALID_ARGUMENT','Guidance location must be a normalized absolute path');
    return (input.sourceIds?input.sourceIds.map(id=>this.source(snapshot,id,access)):Object.values(snapshot.controlState.guidanceSources??{}).filter(s=>{try{this.checkSource(snapshot,s,access);return true;}catch(error){if(error instanceof DomainError)return false;throw error;}})).filter(s=>(input.sourceIds || s.value.active) && (!input.location || s.value.definition.locations.some(path=>within(path,input.location)))).sort((a,b)=>a.ref.id.localeCompare(b.ref.id));
  }
  review(snapshot,input,principal,access) {
    const sources=this.selected(snapshot,{sourceIds:input.sourceIds,location:input.task.location},access);
    if(!sources.length)fail('NOT_FOUND','No registered sources match this location; register or select sources first');
    if(sources.length>32)fail('LIMIT_EXCEEDED','Select at most32 sources for one assessment');
    let bytes=0;const captures=sources.map(source=>{
      if(!source.value.active || source.value.latest?.state!=='ready')fail('CAPABILITY_UNAVAILABLE','Assessment requires explicit ready source observations; refresh or select a smaller source set');
      const stored=this.capture(snapshot,source.value.latest.capture.id,access);bytes+=stored.value.capture.content.byteLength;return {ref:stored.ref,digest:stored.digest};
    });
    if(bytes>131072)fail('LIMIT_EXCEEDED','Selected evidence exceeds its131072-byte bound; select registered excerpts or fewer sources');
    const basis=input.task.sourceRefs.map(ref=>{const stored=this.k.lookup(snapshot,ref);return {ref,digest:stored.digest,revision:stored.revision};}),policy=this.k.lookup(snapshot,snapshot.context.policy);
    return {id:input.id,incidentId:input.incidentId,capability:input.capability,grant:input.grant,input:{task:input.task,captures,basis,policy:{ref:policy.ref,digest:policy.digest},profile:guidanceProfile},limits:input.limits};
  }
  inputAccess(snapshot,review,access) {
    for(const {ref,digest:hash} of review.captures) {const capture=this.capture(snapshot,ref.id,access);this.k.local(ref,snapshot.context.id);if(capture.digest!==hash)fail('IDENTITY_CONFLICT','Assessment capture basis changed');}
    for(const basis of review.basis)this.k.awareness.detail(snapshot,basis.ref,access);
  }
  stale(snapshot,review) {
    const reasons=[];
    for(const {ref} of review.captures) {const cap=snapshot.controlState.guidanceCaptures?.[ref.id],source=cap && snapshot.controlState.guidanceSources?.[cap.value.source.id];if(!source?.value.active || source.value.definitionDigest!==cap.value.definitionDigest || source.value.latest?.state!=='ready' || source.value.latest.capture.id!==ref.id)reasons.push('Source registration or latest observation changed: '+ref.id);}
    for(const basis of review.basis) {try{if(this.k.lookup(snapshot,basis.ref).digest!==basis.digest)reasons.push('Task basis changed: '+basis.ref.id);}catch{reasons.push('Task basis unavailable: '+basis.ref.id);}}
    if(digest(snapshot.context.policy)!==digest(review.policy.ref) || this.k.lookup(snapshot,snapshot.context.policy).digest!==review.policy.digest)reasons.push('Policy basis changed');return reasons;
  }
  read(snapshot,input,principal,access) {
    const maximumBytes=input.maximumBytes??16384,limit=input.limit??32;
    const selected=(input.captureIds || input.executionId) && !input.sourceIds && !input.location?[]:this.selected(snapshot,input,access);
    const scope={scope:'guidance.read',contextId:input.contextId,principalId:principal,authority:access.scopeKey,selector:digest({sourceIds:input.sourceIds??null,location:input.location??null})};
    let after='';
    if(input.cursor) {const cursor=openCursor(input.cursor,this.k.cursorKey);if(Object.entries(scope).some(([k,v])=>cursor[k]!==v) || typeof cursor.after!=='string')fail('INVALID_ARGUMENT','Guidance cursor does not match its current authority and selector');after=cursor.after;}
    const page=selected.filter(s=>s.ref.id>after);
    const packet={snapshotRevision:snapshot.context.revision,sources:[],captures:[],staleReasons:[],omitted:[],coverage:{matchedSources:selected.length,returnedSources:0,note:'Registry/last-observation coverage only; pages recheck current visibility. Read does not refresh or invoke inference. Select omitted IDs/ranges or follow nextCursor.'},worker:this.workerStatus()};
    const profile=this.providerOptions?.(snapshot,principal,access);if(profile)packet.profile=profile;
    const size=()=>Buffer.byteLength(canonical(packet));let processed=0;
    for(const source of page.slice(0,limit)) {
      packet.sources.push(source);
      // Reserve space for each capture's omission and the next-page token.
      if(size()+400*packet.sources.length+1024>maximumBytes) {
        packet.sources.pop();
        if(!packet.sources.length){packet.omitted.push({ref:source.ref,reason:'metadata_budget',recovery:'guidance.read with sourceIds and a larger maximumBytes'});after=source.ref.id;processed++;}
        break;
      }
      after=source.ref.id;processed++;
    }
    if(processed<page.length)packet.nextCursor=sealCursor({...scope,after},this.k.cursorKey);
    packet.coverage.returnedSources=packet.sources.length;
    let ids=input.captureIds??packet.sources.filter(s=>s.value.latest?.capture || s.value.lastCapture).map(s=>(s.value.latest?.capture??s.value.lastCapture).id);
    if(input.executionId) {
      const execution=this.k.executions.get(snapshot,input.executionId,principal,access).value;
      if(execution.intent.input.profile!==guidanceProfile)fail('INVALID_ARGUMENT','Execution is not a guidance assessment');
      this.inputAccess(snapshot,execution.intent.input,access);packet.execution=execution;packet.staleReasons=this.stale(snapshot,execution.intent.input);packet.freshness=packet.staleReasons.length?'stale':'current-observation';
      ids=[...new Set([...ids,...execution.intent.input.captures.map(c=>c.ref.id)])];
      if(execution.outcome?.kind==='succeeded') {
        try{packet.assessment=JSON.parse(utf8(this.bodies.get(execution.outcome.output.assessmentDigest)));}
        catch{packet.omitted.push({ref:this.k.ref(snapshot.context.id,input.executionId),reason:'assessment_unavailable',recovery:'Preserve the execution receipt and inspect retained component/native bytes'});}
      }
      if(size()>maximumBytes-256) {delete packet.assessment;delete packet.execution;packet.omitted.push({ref:this.k.ref(snapshot.context.id,input.executionId),reason:'result_budget',recovery:'guidance.read with executionId and a larger maximumBytes'});}
    }
    ids=[...new Set(ids)];
    const omitted=new Map();
    for(const id of ids) {
      // Validate every explicit dependency before considering a byte omission.
      try{this.capture(snapshot,id,access);}catch(error){if(!input.captureIds && !input.executionId && error instanceof DomainError && error.code==='NOT_FOUND'){packet.omitted.push({ref:this.k.ref(snapshot.context.id,id),reason:'history_inaccessible',recovery:'Use the current source metadata; historical dependencies require current access'});continue;}throw error;}
      const omission={ref:this.k.ref(snapshot.context.id,id),reason:'capture_budget',recovery:'guidance.read with selected captureIds and a larger maximumBytes'};
      omitted.set(id,omission);packet.omitted.push(omission);
    }
    if(size()>maximumBytes)fail('LIMIT_EXCEEDED','Selected response metadata exceeds its budget; select fewer IDs or raise maximumBytes');
    for(const id of ids.slice(0,32)) {
      const omission=omitted.get(id);if(!omission)continue;
      const stored=this.capture(snapshot,id,access),source=snapshot.controlState.guidanceSources[stored.value.source.id].value;
      const item={stored,freshness:source.active && source.latest?.state==='ready' && source.latest.capture.id===id && source.definitionDigest===stored.value.definitionDigest?'current-observation':'historical'};
      packet.omitted.splice(packet.omitted.indexOf(omission),1);packet.captures.push(item);
      if(size()>maximumBytes) {packet.captures.pop();packet.omitted.push(omission);continue;}
      try {
        const representation=input.representation??'selected',bytes=this.bodies.get(representation==='whole'?stored.value.wholeDigest:stored.value.capture.contentDigest);
        item.text=utf8(input.bodyRange?selectSource(bytes,{kind:'utf8-range',...input.bodyRange}).bytes:bytes);item.representation=representation;if(input.bodyRange)item.range=input.bodyRange;
      }catch(error){if(error instanceof DomainError && error.code==='INVALID_ARGUMENT')throw error;omission.reason='body_unavailable';omission.recovery='Preserve capture identity; inspect component bytes or explicitly refresh its source';packet.omitted.push(omission);}
      if(size()>maximumBytes) {delete item.text;delete item.range;delete item.representation;if(!packet.omitted.includes(omission)){omission.reason='body_budget';packet.omitted.push(omission);}}
      if(size()>maximumBytes) {packet.captures.pop();if(!packet.omitted.includes(omission))packet.omitted.push(omission);}
    }
    return packet;
  }
}
