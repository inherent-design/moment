import { spawn } from 'node:child_process';
import { openSync,closeSync,fstatSync,lstatSync,readFileSync,writeFileSync,fsyncSync,mkdirSync,realpathSync,watch,constants,linkSync,unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { freemem } from 'node:os';
import { canonical,digest,bytesDigest,fail } from '../json.mjs';
import { parseJson } from '../wire.mjs';
import { boundLimits,sameRef } from '../authority.mjs';
import { workerPath,workerDigest,descriptor,descriptorDigest,verifierBytes,verifierReservation,workerArguments,receiptDocument,assertVerifierLocation,profileName } from './bytes-definition.mjs';
import { compileDocument } from '../validation.mjs';
const validReceipt=compileDocument(receiptDocument);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const key=execution=>execution.intent.capability.contextId+'/'+execution.intent.id+'/'+execution.attempt;
function directory(path,create) {
  if (create) try { mkdirSync(path,{ mode:0o700 }); } catch(error) { if (error.code!=='EEXIST') throw error; }
  const stat=lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==process.getuid() || (stat.mode&0o077)) fail('FORBIDDEN','Verifier directory must be private and user-owned');
}
function read(path,maximum=16384) {
  let fd;
  try {
    fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=fstatSync(fd);
    if (!stat.isFile() || stat.uid!==process.getuid() || (stat.mode&0o077) || stat.nlink!==1 || stat.size>maximum) fail('FORBIDDEN','Verifier file is not an admitted private regular file');
    return readFileSync(fd);
  } catch(error) { if (error.code==='ENOENT') return undefined;throw error; }
  finally { if (fd!==undefined) closeSync(fd); }
}
function write(path,value) {
  const fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try { writeFileSync(fd,value);fsyncSync(fd); } finally { closeSync(fd); }
}
function sync(path) { const fd=openSync(path,constants.O_RDONLY);try { fsyncSync(fd); } finally { closeSync(fd); } }
function optionalStat(path) { try { return lstatSync(path); } catch(error) { if (error.code==='ENOENT') return;throw error; } }
function normalizePublication(path) {
  const final=optionalStat(join(path,'receipt.json')),ready=optionalStat(join(path,'receipt.ready'));
  if (final?.nlink===2 && ready && final.ino===ready.ino && final.dev===ready.dev && final.isFile() && ready.isFile() && final.uid===process.getuid() && !(final.mode&0o077)) { unlinkSync(join(path,'receipt.ready'));sync(path); }
}
function publish(path,expected) {
  const ready=join(path,'receipt.ready'),final=join(path,'receipt.json');
  if (!read(final)) {
    const fd=openSync(ready,constants.O_RDONLY|constants.O_NOFOLLOW);
    try { if (!readFileSync(fd).equals(expected)) fail('IDENTITY_CONFLICT','Staged verifier receipt changed before publication');fsyncSync(fd); } finally { closeSync(fd); }
    try { linkSync(ready,final); } catch(error) { if (error.code!=='EEXIST') throw error; }
    normalizePublication(path);sync(path);
  }
  const actual=read(final);if (!actual?.equals(expected)) fail('IDENTITY_CONFLICT','Published verifier receipt differs from its validated bytes');return actual;
}
function evidence(hash,method) { return { sources:[],artifactDigests:[hash],method }; }

/** Fixed-code process adapter. Node API guards are not an OS sandbox for hostile code. */
export class BytesVerifier {
  constructor(root,{ providerId,onChange=()=>{} }={}) {
    if (!uuid.test(providerId ?? '')) fail('INVALID_ARGUMENT','An explicit verifier provider identity is required');
    this.providerId=providerId;this.root=realpathSync(root);this.onChange=contextId=>{ try { onChange(contextId); } catch { process.stderr.write('Verifier receipt notification failed; its files remain retained.\n'); } };this.active=new Map();this.watches=new Map();this.closed=false;
    directory(join(this.root,'runtime'),false);
    this.base=join(this.root,'runtime','verifier');directory(this.base,true);
  }
  async inspect() {
    return { platform:descriptor.platform,measurements:[{ resource:'availableMemory',value:freemem(),unit:'bytes',observedAt:new Date().toISOString(),source:'node:os.freemem' }] };
  }
  job(execution,create=false) {
    assertVerifierLocation(this.base);
    const contextId=execution.intent.capability.contextId;
    if (!uuid.test(contextId) || !uuid.test(execution.intent.id) || !Number.isSafeInteger(execution.attempt) || execution.attempt<1) fail('INVALID_ARGUMENT','Invalid verifier job identity');
    let path=this.base;
    for (const part of [contextId,execution.intent.id,String(execution.attempt)]) { path=join(path,part);directory(path,create); }
    return path;
  }
  observe(execution) {
    let path;
    try { path=this.job(execution); } catch(error) { if (error.code==='ENOENT') return { kind:'not_started' };throw error; }
    normalizePublication(path);
    const acknowledged=read(join(path,'receipt.json')),raw=acknowledged ?? read(join(path,'receipt.ready'));
    if (raw) {
      const receipt=parseJson(raw.toString('utf8'));
      if (!validReceipt(receipt)) fail('INVALID_ARGUMENT','Verifier receipt does not satisfy its installed schema');
      if (receipt.formatVersion!==1 || receipt.executionId!==execution.intent.id || receipt.contextId!==execution.intent.capability.contextId || receipt.attempt!==execution.attempt || receipt.fencingToken!==execution.attempt || receipt.intentDigest!==digest(execution.intent) || receipt.descriptorDigest!==descriptorDigest || receipt.measurement?.nodeVersion!==process.version || receipt.expectedDigest!==execution.intent.input.expectedDigest) fail('IDENTITY_CONFLICT','Verifier receipt does not match this attempt and descriptor');
      const bytes=verifierBytes(execution.intent.input),observed=bytesDigest(bytes);
      if (receipt.result?.observedDigest!==observed || receipt.result.byteLength!==bytes.length || receipt.result.matches!==(observed===execution.intent.input.expectedDigest) || receipt.outcome?.kind!==(receipt.result.matches?'succeeded':'failed')) fail('IDENTITY_CONFLICT','Verifier receipt disagrees with the staged input');
      if (receipt.outcome.kind==='succeeded' && canonical(receipt.outcome.output)!==canonical(receipt.result)) fail('IDENTITY_CONFLICT','Verifier outcome differs from its measured result');
      for (const name of ['cpuMillis','memoryBytes','outputBytes','modelTokens','apiSpendMicrounits']) if (!Number.isSafeInteger(receipt.usage?.[name]) || receipt.usage[name]<0 || !Number.isSafeInteger(receipt.baselineUsage?.[name]) || receipt.baselineUsage[name]<0) fail('INVALID_ARGUMENT','Verifier receipt has invalid measured usage');
      if (receipt.usage.modelTokens || receipt.usage.apiSpendMicrounits) fail('IDENTITY_CONFLICT','Verifier receipt claims unsupported billed work');
      const usage={};
      for (const name of ['cpuMillis','memoryBytes','outputBytes','modelTokens','apiSpendMicrounits']) usage[name]=name==='memoryBytes'?Math.max(receipt.baselineUsage[name],receipt.usage[name]):receipt.baselineUsage[name]+receipt.usage[name];
      if (!acknowledged) publish(path,raw);
      else { const fd=openSync(join(path,'receipt.json'),constants.O_RDONLY|constants.O_NOFOLLOW);try { fsyncSync(fd); } finally { closeSync(fd); }sync(path); }
      const hash=bytesDigest(raw),outcome={ ...receipt.outcome,evidence:evidence(hash,'local-bytes-receipt/v1') };
      return { kind:'receipt',path,source:receipt,hash,report:{ attempt:execution.attempt,outcome,usage } };
    }
    if (!read(join(path,'dispatch.json'))) return { kind:'not_started',path };
    const status=read(join(path,'status.json'));
    return { kind:'unknown',path,...(status?{ status:parseJson(status.toString('utf8')) }:{}) };
  }
  lookup(execution) {
    const observed=this.observe(execution);
    if (observed.kind==='receipt') return observed;
    const source={ formatVersion:1,kind:'verifier-lookup',executionId:execution.intent.id,contextId:execution.intent.capability.contextId,attempt:execution.attempt,intentDigest:digest(execution.intent),descriptorDigest,observation:observed.kind,...(observed.status?{ status:observed.status }:{}) };
    return { ...observed,source,hash:digest(source) };
  }
  follow(execution) {
    const id=key(execution);if (this.watches.has(id)) return;
    if (this.watches.size>=64) fail('LIMIT_EXCEEDED','Verifier receipt watch capacity reached');
    let path;try { path=this.job(execution); } catch(error) { if (error.code==='ENOENT') return;throw error; }
    const watcher=watch(path,()=>this.onChange(execution.intent.capability.contextId));
    watcher.on('error',()=>{ watcher.close();this.watches.delete(id); });this.watches.set(id,watcher);
  }
  unfollow(execution) { const id=key(execution);this.watches.get(id)?.close();this.watches.delete(id); }
  retire(execution) {
    this.unfollow(execution);const path=this.job(execution);
    for (const name of ['input.bin','request.json']) { if (read(join(path,name),name==='input.bin'?262144:16384)) unlinkSync(join(path,name)); }
    sync(path);
  }
  async execute({ execution,grant,policy }) {
    if (this.closed || execution.state!=='running' || !execution.lease || execution.lease.holderId!==this.providerId || canonical(grant.ref)!==canonical(execution.intent.grant) || policy.contextId!==execution.intent.capability.contextId) fail('FORBIDDEN','Verifier needs an admitted running execution and exact grant');
    if (execution.lease.fencingToken!==execution.attempt || policy.systemId!==execution.intent.capability.systemId || !grant.value.actions.includes(profileName) || !grant.value.actions.includes('execution.request') || !grant.value.resourceRefs.some(ref=>sameRef(ref,execution.intent.capability)) || (grant.value.incidentIds!=='all' && !grant.value.incidentIds.includes(execution.intent.incidentId))) fail('FORBIDDEN','Verifier dispatch is outside its grant and fencing envelope');
    boundLimits(execution.intent.limits,grant.value.limits);
    const fresh=()=>{ if (Date.now()>=Date.parse(execution.lease.expiresAt) || (grant.value.expiresAt && Date.now()>=Date.parse(grant.value.expiresAt))) fail('LEASE_STALE','Verifier lease or grant expired before dispatch','reconcile'); };
    fresh();
    verifierReservation(execution.intent);
    const prior=this.observe(execution);if (prior.kind==='receipt') return prior.report;
    if (prior.kind==='unknown') return this.unknown(execution,'A retained dispatch has no complete receipt');
    if (bytesDigest(readFileSync(workerPath))!==workerDigest) fail('CAPABILITY_UNAVAILABLE','Verifier source changed; restart and publish a fresh descriptor');
    const id=key(execution);if (this.active.has(id)) return this.active.get(id).promise;
    const path=this.job(execution,true),request={ executionId:execution.intent.id,contextId:execution.intent.capability.contextId,attempt:execution.attempt,fencingToken:execution.lease.fencingToken,intentDigest:digest(execution.intent),descriptorDigest,expectedDigest:execution.intent.input.expectedDigest,baselineUsage:execution.usage };
    const bytes=verifierBytes(execution.intent.input);
    write(join(path,'input.bin'),bytes);write(join(path,'request.json'),canonical(request));
    this.follow(execution);
    fresh();
    write(join(path,'dispatch.json'),canonical({ ...request,recordedAt:new Date().toISOString() }));sync(path);
    fresh();
    const child=spawn(process.execPath,workerArguments(path),{ cwd:path,env:{ LANG:'C',TZ:'UTC' },stdio:['ignore','pipe','pipe'] });
    let outputBytes=0,stopReason,spawnError;const diagnostics=[];
    const stop=reason=>{ stopReason=reason;child.kill('SIGKILL'); };
    for (const stream of [child.stdout,child.stderr]) stream.on('data',bytes=>{ const remaining=Math.max(0,16384-outputBytes);if (remaining) diagnostics.push(bytes.subarray(0,remaining));outputBytes+=bytes.length;if (outputBytes>16384) stop('diagnostic bound exceeded'); });
    child.once('error',error=>{ spawnError=error.code ?? 'SPAWN_ERROR'; });
    const duration=Math.max(1,Math.min(descriptor.wallTimeoutMillis,Date.parse(execution.lease.expiresAt)-Date.now()));
    const timeout=setTimeout(()=>stop('wall timeout observed'),duration);
    const promise=new Promise((resolve,reject)=>child.once('close',(exitCode,signal)=>{
      clearTimeout(timeout);this.active.delete(id);
      try {
        if (diagnostics.length) write(join(path,'process.log'),Buffer.concat(diagnostics));
        write(join(path,'status.json'),canonical({ exitCode,signal,outputBytes,...(stopReason?{ stopReason }:{}),...(spawnError?{ spawnError }:{}),recordedAt:new Date().toISOString() }));sync(path);
        const result=this.observe(execution);
        resolve(result.kind==='receipt'?result.report:this.unknown(execution,'Worker exited without a complete receipt'));
      } catch(error) { reject(error); }
      this.onChange(execution.intent.capability.contextId);
    }));
    this.active.set(id,{ child,promise,stop });return promise;
  }
  unknown(execution,detail) {
    const source=this.lookup(execution);
    return { attempt:execution.attempt,outcome:{ kind:'unknown',detail,evidence:evidence(source.hash,'local-bytes-lookup/v1') },usage:{ ...execution.usage,outputBytes:Math.max(execution.usage.outputBytes,Buffer.byteLength(detail)) } };
  }
  async reconcile(execution) {
    const observed=this.lookup(execution),proof=evidence(observed.hash,'local-bytes-lookup/v1');
    if (observed.kind==='receipt') return { attempt:execution.attempt,resolution:{ kind:'observed',outcome:observed.report.outcome },usage:observed.report.usage };
    if (observed.kind==='not_started') return { attempt:execution.attempt,resolution:execution.cancellation?{ kind:'observed',outcome:{ kind:'cancelled',evidence:proof } }:{ kind:'retry',basis:'not_started',evidence:proof },usage:execution.usage };
    this.follow(execution);const report=this.unknown(execution,'Retained dispatch is awaiting a provider receipt');
    return { attempt:report.attempt,resolution:{ kind:'observed',outcome:report.outcome },usage:report.usage };
  }
  async cancel(execution) {
    const active=this.active.get(key(execution));if (active) { active.stop('cancellation observed');return active.promise; }
    const observed=this.lookup(execution);return observed.kind==='receipt'?observed.report:this.unknown(execution,'Cancellation has no complete provider receipt');
  }
  async close() {
    this.closed=true;for (const watcher of this.watches.values()) watcher.close();this.watches.clear();
    const pending=[...this.active.values()];for (const item of pending) item.stop('provider shutdown');await Promise.allSettled(pending.map(item=>item.promise));
  }
}
