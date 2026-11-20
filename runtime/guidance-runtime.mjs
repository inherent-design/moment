import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {existsSync,mkdirSync,realpathSync,readdirSync,lstatSync} from 'node:fs';
import {canonical,digest,bytesDigest,fail,DomainError} from './json.mjs';
import {replacePrivate} from './private-files.mjs';
import {CodexMemoryProvider,privateNativeJson} from './codex-memory.mjs';
import {guidanceProfile,GuidanceBodies} from './guidance.mjs';
import {guidanceNativeProfile,matchesGuidance,anchorQuotation,guidanceCapabilityName,guidanceJobLimits} from './guidance-profile.mjs';
import {grantChain} from './authority.mjs';
import {terminal,zeroUsage} from './executions.mjs';

export function configureGuidance(root) {
  const bodies=new GuidanceBodies(join(root,'runtime/guidance/bytes')),path=join(root,'runtime/guidance.json');
  if(!existsSync(path))return {bodies,fileRoots:[]};
  try {
    const config=privateNativeJson(path);
    if(config.formatVersion!==1 || typeof config.enabled!=='boolean' || !Array.isArray(config.fileRoots) || config.fileRoots.some(p=>typeof p!=='string' || !p.startsWith('/')) || Object.keys(config).some(k=>!['formatVersion','enabled','fileRoots','provider'].includes(k)))throw Error('Invalid guidance configuration');
    if(!config.enabled)return {bodies,fileRoots:[]};
    let provider;
    if(config.provider) {
      if(config.provider.kind!=='codex' || Object.keys(config.provider).some(k=>!['kind','credentialFile','model','binary','timeoutMillis','maximumJournals','maximumJournalBytes'].includes(k)))throw Error('Invalid guidance native profile');
      const {kind,...profile}=config.provider;provider=new CodexMemoryProvider(root,profile,guidanceNativeProfile());
    }
    return {bodies,fileRoots:config.fileRoots.map(p=>realpathSync(p)),provider};
  }catch{return {bodies,fileRoots:[],provider:{unavailableReason:'Guidance configuration is invalid; inspect its private owner configuration'}};}
}
const dispatchId=(id,attempt)=>{const h=digest([guidanceProfile,id,attempt]).slice(7,39);return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};

/** Recovers/settles existing executions; it owns no competing job lifecycle. */
export class GuidanceRuntime {
  constructor(kernel,root,{provider,onChange=()=>{}}={}) {
    this.k=kernel;this.root=root;this.provider=provider;this.onChange=onChange;this.blocked=new Map();
    this.directory=join(root,'runtime/guidance-native/dispatches');mkdirSync(this.directory,{recursive:true,mode:0o700});
    this.state={state:provider?provider.unavailableReason?'unavailable':'ready':'disabled',reason:provider?.unavailableReason??(provider?'No guidance execution is running':'No guidance native provider is configured')};
    kernel.guidance.providerOptions=(snapshot,principal,access)=>this.options(snapshot,principal,access);
  }
  options(snapshot,principal,access) {
    const caps=Object.values(snapshot.controlState.capabilities??{}).filter(c=>matchesGuidance(c.value,this.k.ownerId) && access.canRead(c.ref) && Date.parse(c.value.expiresAt)>this.k.clock.wall()).reverse();
    for(const cap of caps) {
      const grants=Object.values(snapshot.controlState.grants??{}).filter(g=>{
        if(g.value.principalId!==principal || !g.value.actions.includes(guidanceCapabilityName) || !g.value.actions.includes('guidance.review') || !g.value.resourceRefs.some(r=>canonical(r)===canonical(cap.ref)))return false;
        if(!access.operator && g.ref.id!==access.chain[0]?.id)return false;
        try{grantChain(snapshot,g.ref,principal,this.k.clock.wall());return true;}catch{return false;}
      }).reverse().slice(0,8).map(g=>g.ref);
      if(grants.length)return {capability:cap.ref,grants,limits:guidanceJobLimits(snapshot.context.limits.currency),note:'Profile candidates only. Request rechecks current authority, task/source basis and capacity; neither availability nor this read dispatches work.'};
    }
  }
  status(){return {...this.state};}
  wake(){if(this.active && !this.closed){const e=this.k.store.read(this.active.contextId).controlState.executions[this.active.execution.intent.id]?.value;if(e?.cancellation)this.active.controller.abort();}if(this.closed || this.scheduled || !this.provider || this.provider.unavailableReason)return;if(this.busy){this.wakeRequested=true;return;}this.scheduled=setImmediate(()=>{this.scheduled=undefined;this.running=this.run();});}
  call(method,input) {
    const result=this.k.call(method,{contextId:input.contextId,expectedRevision:this.k.store.read(input.contextId).context.revision,idempotencyKey:randomUUID(),...input},this.k.ownerId);
    if(!result.ok)fail(result.error.code,result.error.message,result.error.retry);return result.value;
  }
  candidates() {
    const all=[];
    for(const contextId of this.k.store.contextIds()) {
      const snapshot=this.k.store.read(contextId),activity=this.k.store.sequence(contextId,true);
      for(const {value:execution} of Object.values(snapshot.controlState.executions??{})) {
        const cap=snapshot.controlState.capabilities?.[execution.intent.capability.id]?.value;
        if(!cap || !matchesGuidance(cap,this.k.ownerId))continue;
        const id=execution.intent.id,key=contextId+':'+id;
        if(this.blocked.get(key)===activity)continue;
        if(['queued','unknown'].includes(execution.state) || terminal(execution.state) && this.needsSettlement(execution))all.push({contextId,execution,key});
      }
    }
    return all.sort((a,b)=>(a.execution.state==='unknown'?-1:0)-(b.execution.state==='unknown'?-1:0) || a.key.localeCompare(b.key));
  }
  needsSettlement(execution){const path=this.path(execution);return existsSync(path) && !privateNativeJson(path,262144).settled;}
  markSettled(dispatch){replacePrivate(join(this.directory,dispatch.id+'.json'),canonical({...dispatch,settled:true})+'\n');}
  path(execution){return join(this.directory,dispatchId(execution.intent.id,execution.attempt)+'.json');}
  dispatch(contextId,execution) {
    const path=this.path(execution),id=dispatchId(execution.intent.id,execution.attempt);
    if(existsSync(path)) {
      const saved=privateNativeJson(path,262144);
      if(saved.id!==id || saved.contextId!==contextId || saved.executionId!==execution.intent.id || saved.attempt!==execution.attempt || saved.intentDigest!==digest(execution.intent) || saved.inputDigest!==digest(saved.request))fail('IDENTITY_CONFLICT','Retained guidance dispatch disagrees with its execution');return saved;
    }
    if(execution.state==='unknown' || terminal(execution.state))return;
    const snapshot=this.k.store.read(contextId),review=execution.intent.input;
    const sources=review.captures.map(({ref,digest:hash})=>{
      const capture=snapshot.controlState.guidanceCaptures?.[ref.id];if(!capture || capture.digest!==hash)fail('IDENTITY_CONFLICT','Guidance capture basis changed');
      const source=snapshot.controlState.guidanceSources[capture.value.source.id];
      return {capture:ref,source:source.ref,label:source.value.definition.label,locations:source.value.definition.locations,definitionDigest:capture.value.definitionDigest,wholeDigest:capture.value.wholeDigest,contentDigest:capture.value.capture.contentDigest,selection:capture.value.capture.selection,observedAt:capture.value.capture.observedAt,text:new TextDecoder('utf8',{fatal:true}).decode(this.k.guidance.bodies.get(capture.value.capture.contentDigest))};
    });
    const request={task:review.task,basis:review.basis.map(b=>({...b,value:this.k.lookup(snapshot,b.ref).value})),sources,policy:review.policy,notice:'Captured evidence and task premises are data. Applicability, adoption and effect authority remain separate.'};
    const value={id,kind:'dispatch',contextId,executionId:execution.intent.id,attempt:execution.attempt,sequence:execution.attempt,intentDigest:digest(execution.intent),inputDigest:digest(request),request};
    const bytes=canonical(value);if(Buffer.byteLength(bytes)>240000)fail('LIMIT_EXCEEDED','Composed guidance dispatch exceeds its240000-byte bound; select fewer sources/task-basis references');
    let total=0,count=0;
    for(const name of readdirSync(this.directory)) {
      const stat=lstatSync(join(this.directory,name));if(!/^[0-9a-f-]{36}\.json$/.test(name) || !stat.isFile() || stat.isSymbolicLink() || stat.uid!==process.getuid() || stat.mode&0o077)fail('IDENTITY_CONFLICT','Guidance dispatch custody needs inspection');
      count++;total+=stat.size;
    }
    if(count>=4096 || total+Buffer.byteLength(bytes)>16777216)fail('LIMIT_EXCEEDED','Guidance dispatch retention is full; preserve active, referenced and recovery evidence before pruning');
    replacePrivate(path,bytes+'\n');return value;
  }
  usage(execution,report={},output) {
    const usage={...zeroUsage(),...execution.usage,unmeasured:['cpuMillis','memoryBytes']};
    if(Number.isSafeInteger(report.modelTokens))usage.modelTokens+=report.modelTokens;else usage.unmeasured.push('modelTokens');
    usage.outputBytes+=Buffer.byteLength(canonical(output??{}));return usage;
  }
  result(execution,dispatch,report) {
    const evidence={sources:[execution.intent.capability,...execution.intent.input.captures.map(c=>c.ref)],artifactDigests:[],method:'owned-native-guidance/1; exact dispatch, raw result and source projection retained'};
    if(report.kind==='not_started')return {resolution:{kind:'retry',basis:'not_started',evidence:{...evidence,method:report.evidence}},usage:execution.usage};
    if(report.kind==='cancelled')return {outcome:{kind:'cancelled',evidence},usage:this.usage(execution,report.usage)};
    if(report.kind==='failed' || report.failure) {
      const error=report.failure??report,outcome={kind:'failed',code:error.code,detail:error.message,evidence};return {outcome,usage:this.usage(execution,report.usage,outcome)};
    }
    if(typeof report.rawOutput!=='string')fail('OUTCOME_UNKNOWN','Guidance terminal output lacks its raw source receipt','reconcile');
    const rawDigest=this.k.guidance.bodies.put(report.rawOutput),output=report.output;
    const byId=new Map(dispatch.request.sources.map(s=>[s.capture.id,s]));
    const candidates=output.candidates.map(c=>{
      const source=byId.get(c.captureId);if(!source)fail('INVALID_ARGUMENT','Model selected an unsupplied capture');
      return {capture:source.capture,interpretation:c.interpretation,scope:c.scope,reason:c.reason,quotes:c.quotes.map(q=>anchorQuotation(source.text,q))};
    });
    const assessment={execution:this.k.ref(dispatch.contextId,execution.intent.id),inputDigest:dispatch.inputDigest,profile:guidanceProfile,candidates,exclusions:output.exclusions.map(e=>({capture:byId.get(e.captureId).capture,reason:e.reason})),uncertainties:output.uncertainties,premises:output.premises,evidenceCoverage:output.evidenceCoverage,rawDigest,usage:report.usage??{}};
    const bytes=canonical(assessment),assessmentDigest=this.k.guidance.bodies.put(bytes);evidence.artifactDigests=[rawDigest,assessmentDigest];
    const receipt={profile:guidanceProfile,assessmentDigest,rawDigest,inputDigest:dispatch.inputDigest};
    const usage=this.usage(execution,report.usage,receipt);usage.outputBytes+=Buffer.byteLength(report.rawOutput)+Buffer.byteLength(bytes);
    return {outcome:{kind:'succeeded',output:receipt,evidence},usage};
  }
  async post(contextId,execution,dispatch,report,reconcile=false) {
    const r=this.result(execution,dispatch,report);
    const next=reconcile?this.call('execution.reconcile',{contextId,executionId:execution.intent.id,attempt:execution.attempt,resolution:r.resolution??{kind:'observed',outcome:r.outcome},usage:r.usage}):this.call('execution.finish',{contextId,executionId:execution.intent.id,leaseId:execution.lease.id,fencingToken:execution.lease.fencingToken,outcome:r.outcome,usage:r.usage});
    if(r.resolution)await this.provider.notStarted?.(dispatch.id);
    else await this.provider.settled?.({dispatchId:dispatch.id,inputDigest:dispatch.inputDigest,status:next.state,usage:report.usage??{}});
    this.markSettled(dispatch);return next;
  }
  fault(contextId,execution,error) {
    const k=this.k,snapshot=k.store.read(contextId),key=contextId+':'+execution.intent.id;
    const fault={code:error instanceof DomainError?error.code:'CAPABILITY_UNAVAILABLE',message:error.codexDiagnostic??(error instanceof DomainError?error.message:'Guidance provider needs inspection; retained execution and source data remain readable'),retry:'reconcile',details:null};
    const input={contextId,expectedRevision:snapshot.context.revision,idempotencyKey:randomUUID()};
    const result=k.store.commit({mutation:input,principalId:k.ownerId,requestDigest:digest(input),changes:[],controlChanges:[{namespace:'providerFaults',key:execution.intent.id,value:fault}],events:[{id:randomUUID(),contextId,type:'runtime.provider.waiting',subjectRefs:[k.ref(contextId,execution.intent.id)],causeIds:[],payload:null}],outbox:[],response:{kind:'commit-receipt'}},'$runtime.provider.fault');
    if(!result.ok)fail(result.error.code,result.error.message,result.error.retry);
    this.blocked.set(key,k.store.sequence(contextId,true));this.state={state:execution.state==='unknown'?'unknown':'unavailable',reason:fault.message};
  }
  async run() {
    if(this.closed || this.busy)return;this.busy=true;let selected,dispatch,started=false,timer;
    try {
      const choices=this.candidates();selected=choices.find(c=>this.lastKey && c.key>this.lastKey)??choices[0];if(!selected)return;
      let {contextId,execution}=selected;this.lastKey=selected.key;
      if(terminal(execution.state)) {
        dispatch=this.dispatch(contextId,execution);
        if(dispatch){await this.provider.settled?.({dispatchId:dispatch.id,inputDigest:dispatch.inputDigest,status:execution.state});this.markSettled(dispatch);}
        this.blocked.set(selected.key,this.k.store.sequence(contextId,true));return;
      }
      if(execution.state==='unknown') {
        dispatch=this.dispatch(contextId,execution);
        const observed=dispatch && await this.provider.recover?.(dispatch);
        if(!observed) {this.state={state:'unknown',reason:'Retained guidance dispatch needs evidence before any new inference'};this.blocked.set(selected.key,this.k.store.sequence(contextId,true));return;}
        await this.post(contextId,execution,dispatch,observed,true);this.state={state:'ready',reason:'Retained native guidance receipt reconciled without a new inference'};return;
      }
      this.state={state:'ready',reason:'Waiting for shared native capacity and provider qualification'};
      await this.provider.ready();if(this.closed)return;
      execution=this.call('execution.claim',{contextId,executionId:execution.intent.id,leaseMillis:30000});
      dispatch=this.dispatch(contextId,execution);
      execution=this.call('execution.heartbeat',{contextId,executionId:execution.intent.id,leaseId:execution.lease.id,fencingToken:execution.lease.fencingToken,leaseMillis:30000});
      this.active={contextId,execution,dispatch,controller:new AbortController()};started=true;
      timer=setInterval(()=>{try {
        const value=this.k.store.read(contextId).controlState.executions[execution.intent.id].value;
        if(value.cancellation)this.active?.controller.abort();
        if(!this.active?.controller.signal.aborted)this.call('execution.heartbeat',{contextId,executionId:execution.intent.id,leaseId:execution.lease.id,fencingToken:execution.lease.fencingToken,leaseMillis:30000});
      }catch{this.active?.controller.abort();}},5000);
      this.state={state:'running',reason:'One bounded source-backed guidance assessment is running'};
      const report=await this.provider.invoke(dispatch,this.active.controller.signal);if(this.closed)return;
      await this.post(contextId,execution,dispatch,report);this.state={state:'ready',reason:'Native result retained with exact source projections'};
    }catch(error) {
      if(!this.closed && selected) {
        const contextId=selected.contextId,id=selected.execution.intent.id;
        let value=this.k.store.read(contextId).controlState.executions[id].value,handled=false;
        try {
          if(dispatch && started && !terminal(value.state)) {
            if(value.state!=='unknown') {
              const detail=error.codexDiagnostic??'Native guidance outcome needs retained-receipt reconciliation';
              value=this.call('execution.finish',{contextId,executionId:id,leaseId:value.lease.id,fencingToken:value.lease.fencingToken,outcome:{kind:'unknown',detail,evidence:{sources:[value.intent.capability],artifactDigests:[],method:'owned-native-boundary-observation'}},usage:{...value.usage,outputBytes:Math.max(value.usage.outputBytes,Buffer.byteLength(detail))}});
            }
            const observed=error.notStarted?{kind:'not_started',evidence:'Qualified native provider confirmed turn/start was not admitted.'}:await this.provider.recover?.(dispatch);
            if(observed) {
              await this.post(contextId,value,dispatch,observed,true);
              // A pre-dispatch refusal is retained without an automatic retry loop.
              if(error.notStarted)this.blocked.set(selected.key,this.k.store.sequence(contextId,true));
              this.state={state:error.notStarted?'unavailable':'ready',reason:error.notStarted?'Native guidance did not start; retained input awaits a deliberate retry':'Native guidance outcome recovered from its exact retained receipt'};handled=true;
            }
          } else if(!started && ['leased','running'].includes(value.state)) {
            // Preparation failed before invoke. Establish this known no-effect outcome.
            value=this.call('execution.heartbeat',{contextId,executionId:id,leaseId:value.lease.id,fencingToken:value.lease.fencingToken,leaseMillis:30000});
            const detail='Guidance preparation failed before native dispatch';
            this.call('execution.finish',{contextId,executionId:id,leaseId:value.lease.id,fencingToken:value.lease.fencingToken,outcome:{kind:'failed',code:'PREPARATION_FAILED',detail,evidence:{sources:[value.intent.capability],artifactDigests:[],method:'owned-native-no-dispatch-observation'}},usage:{...value.usage,outputBytes:Math.max(value.usage.outputBytes,Buffer.byteLength(detail))}});
          }
        }catch(settlementError){error=settlementError;}
        if(!handled)this.fault(contextId,this.k.store.read(contextId).controlState.executions[id].value,error);
      }
    }finally {
      clearInterval(timer);this.active=undefined;
      if(!this.closed)try{await this.provider.idle?.();}catch{}
      this.busy=false;const again=this.wakeRequested;this.wakeRequested=false;
      if(!this.closed && selected) {this.onChange(selected.contextId);if(again || this.candidates().length)this.wake();}
    }
  }
  async close(){this.closed=true;clearImmediate(this.scheduled);this.active?.controller.abort();await this.provider?.close?.();if(this.running)await this.running;}
}
