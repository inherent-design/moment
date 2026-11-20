import { randomUUID } from 'node:crypto';
import { canonical, digest, fail, DomainError } from './json.mjs';
import { boundLimits, grantChain } from './authority.mjs';
import { validateVerifier } from './providers/bytes-definition.mjs';
import {guidanceProfile} from './guidance.mjs';
import {matchesGuidance,guidanceCapabilityName} from './guidance-profile.mjs';
import * as core from './semantic-core.mjs';

import { executionMethods } from './operations.mjs';
export { executionMethods } from './operations.mjs';
export const terminal=core.executionTerminal;
const transition=(value,action,outcome)=>{
  const step=core.executionStep(value.state,action,outcome);
  if(step.kind==='NotClaimable')fail('LEASE_STALE','Execution is not claimable','reconcile');
  if(step.kind==='Inactive')fail('LEASE_STALE','Execution is not active','reconcile');
  if(step.kind==='DispatchRequired')fail('INVALID_ARGUMENT','Dispatch heartbeat is required before reporting an effect');
  if(step.kind==='NotUncertain')fail('INVALID_ARGUMENT','Only unknown executions can be reconciled');
  return step;
};
const cumulative=['cpuMillis','outputBytes','modelTokens','apiSpendMicrounits'];
export const zeroUsage=()=>({ cpuMillis:0,memoryBytes:0,outputBytes:0,modelTokens:0,apiSpendMicrounits:0 });

/** Trusted kernel component. All public calls still pass current method admission. */
export class Executions {
  constructor(kernel) { this.k=kernel; }
  evidence(snapshot,evidence,access,required=false) {
    if(!core.executionEvidence(required,evidence.sources))fail('INVALID_ARGUMENT','Reconciliation requires attributable source evidence');
    for (const ref of evidence.sources) { if (!access.canRead(ref)) fail('NOT_FOUND','Execution evidence is inaccessible');this.k.lookup(snapshot,ref); }
  }
  capability(snapshot,ref) {
    this.k.local(ref,snapshot.context.id);
    const stored=snapshot.controlState.capabilities?.[ref.id];
    if (!stored) fail('NOT_FOUND','Capability not found');
    return stored;
  }
  publish(snapshot,capability,principal,access,methodNames) {
    this.k.ensureNewId(snapshot,capability.id);
    const publication=core.capabilityPublish(capability,this.k.ref(snapshot.context.id,capability.id),principal,methodNames,Object.keys(snapshot.controlState.capabilities??{}).length,this.k.clock.wall());
    if(publication==='CapRetentionFull')fail('LIMIT_EXCEEDED','Capability retention capacity reached');
    if(publication==='CapWrongProvider')fail('FORBIDDEN','Capability must belong to its authenticated provider');
    if(publication==='CapReservedName')fail('INVALID_ARGUMENT','Capability name collides with a protocol method');
    if(publication==='CapExpired')fail('CAPABILITY_UNAVAILABLE','Cannot publish an expired capability');
    for (const ref of [capability.inputSchema,capability.outputSchema]) {
      const schema=this.k.schema(snapshot,ref);if (!access.canRead(schema.ref)) fail('NOT_FOUND','Capability schema is inaccessible');
    }
    this.evidence(snapshot,capability.evidence,access);
    return this.k.stored(snapshot.context.id,capability,snapshot.context.revision+1,principal);
  }
  match(snapshot,current,input,principal,access,boundGrant) {
    if(!core.capabilityBoundGrant(access.operator,input.grant,boundGrant))fail('FORBIDDEN','Only the bound grant may be matched');
    this.k.local(input.grant,input.contextId);
    const stored=current.controlState.grants?.[input.grant.id];if (!stored) fail('NOT_FOUND','Grant not found');
    const chain=grantChain(current,input.grant,stored.value.principalId,this.k.clock.wall());
    const req=input.requirement;
    const matches=Object.values(snapshot.controlState.capabilities??{}).filter(item=>core.capabilitySelected(item,req.name,access.canRead(item.ref))).map(item=>{
      const basis=core.capabilityBasis(item,req,chain,input.incidentId,this.k.clock.wall());let policy='missing';
      if(basis.$==='CapNeedsPolicy'){
        try{this.k.authorize(current,item.value.name,stored.value.principalId,{incidentId:input.incidentId,resourceRefs:[item.ref]},input.grant);policy='allowed';}
        catch(error){if(!(error instanceof DomainError))throw error;policy=error.code==='POLICY_INDETERMINATE'?'unknown':'denied';}
      }
      return {capability:item,...core.capabilityFinish(basis,policy)};
    });
    return matches.sort(core.capabilityCompare).slice(0,input.limit);
  }
  authority(snapshot,intent,requester) {
    const cap=this.capability(snapshot,intent.capability).value;
    const incident=snapshot.controlState.incidents?.[intent.incidentId];
    const admission=core.executionAdmission(cap,this.k.clock.wall(),snapshot.context.state,incident?.value);
    if(admission==='CapExecutionExpired')fail('CAPABILITY_UNAVAILABLE','Capability advertisement expired');
    if(admission==='CapExecutionClosed')fail('FORBIDDEN','Context is closed');
    if(admission==='CapExecutionIncident')fail('FORBIDDEN','Incident is not accepting execution');
    const access=this.k.authorize(snapshot,'execution.request',requester,{ incidentId:intent.incidentId,resourceRefs:[intent.capability] },intent.grant);
    this.k.authorize(snapshot,cap.name,requester,{ incidentId:intent.incidentId,resourceRefs:[intent.capability] },intent.grant);
    boundLimits(intent.limits,snapshot.context.limits);boundLimits(intent.limits,this.k.lookup(snapshot,snapshot.context.policy).value.limits);
    for (const grant of access.chain) boundLimits(intent.limits,grant.limits);
    if (!core.resourceSingleSlot(intent.limits.concurrentExecutions)) fail('INVALID_ARGUMENT','One execution reserves exactly one concurrency slot');
    if(!core.executionDeadline(intent.limits.deadline,this.k.clock.wall()))fail('LIMIT_EXCEEDED','Execution deadline passed');
    if (!this.k.compiled(this.k.schema(snapshot,cap.inputSchema))(intent.input)) fail('INVALID_ARGUMENT','Execution input does not satisfy the capability schema');
    validateVerifier(cap,this.k.ownerId,intent);
    if(cap.name===guidanceCapabilityName) {
      if(!matchesGuidance(cap,this.k.ownerId) || intent.input.profile!==guidanceProfile)fail('CAPABILITY_UNAVAILABLE','Guidance provider contract does not match the installed profile');
      this.k.authorize(snapshot,'guidance.review',requester,{incidentId:intent.incidentId,resourceRefs:[intent.capability]},intent.grant);
      this.k.guidance.inputAccess(snapshot,intent.input,access);
      if(this.k.guidance.stale(snapshot,intent.input).length)fail('REVISION_CONFLICT','Guidance source/task/policy basis changed; read and explicitly request a new assessment','refresh');
    }
    this.capacity(snapshot,{ limits:{ ...zeroUsage(),concurrentExecutions:0 } },access.chain);
    return { cap,access };
  }
  totals(snapshot,grantId) {
    return core.resourceTotals(Object.entries(snapshot.controlState.executions??{}).map(([id,stored])=>({value:stored.value,origin:snapshot.controlState.executionOrigins[id]})),grantId);
  }
  capacity(snapshot,intent,chain) {
    if (core.resourceBlocked(Object.values(snapshot.controlState.executions??{}).map(item=>item.value))) fail('LIMIT_EXCEEDED','Observed resource overrun blocks further context dispatch');
    for (const [grantId,limits] of [[undefined,snapshot.context.limits],[undefined,this.k.lookup(snapshot,snapshot.context.policy).value.limits],...chain.map(grant=>[grant.id,grant.limits])]) {
      const totals=this.totals(snapshot,grantId);
      if(!core.resourceCapacity(totals,intent.limits,limits))fail('LIMIT_EXCEEDED','Aggregate execution reservation exceeds its envelope');
    }
  }
  prepare(snapshot,intent,actor,access,requester=actor) {
    this.k.ensureNewId(snapshot,intent.id);
    if(!core.executionRoom(Object.keys(snapshot.controlState.executions??{}).length))fail('LIMIT_EXCEEDED','Execution retention capacity reached');
    const preparation=core.executionPrepare(intent,actor,requester,access,access.chain[0]?this.k.ref(snapshot.context.id,access.chain[0].id):undefined);
    if(preparation==='CapPrepareScope')fail('NOT_FOUND','Execution scope is inaccessible');
    if(preparation==='CapPrepareGrant')fail('FORBIDDEN','Execution requires its bound grant or explicit review access');
    const { cap,access:requestAccess }=this.authority(snapshot,intent,requester);
    this.capacity(snapshot,intent,requestAccess.chain);
    return { execution:{ intent,state:'queued',attempt:0,usage:zeroUsage() },origin:{ principalId:requester,grantIds:requestAccess.chain.map(grant=>grant.id),providerId:cap.providerId } };
  }
  get(snapshot,id,principal,access) {
    const stored=snapshot.controlState.executions?.[id],origin=snapshot.controlState.executionOrigins?.[id];
    if(!core.executionVisible(stored,origin,principal,access))fail('NOT_FOUND','Execution not found');
    if(stored.value.intent.input?.profile===guidanceProfile)this.k.guidance.inputAccess(snapshot,stored.value.intent.input,access);
    return stored;
  }
  lease(snapshot,value,principal,input) {
    const observed=core.observeClock(this.k.clock);
    if(!core.leaseValid(value.lease,snapshot.controlState.executionLeases?.[value.intent.id],observed,principal,input))fail('LEASE_STALE','Execution lease is stale','reconcile');
    return observed;
  }
  usage(value,usage,outcome,observed=false) {
    if(!core.resourceUsage(value.usage,usage,value.intent.limits,observed))fail('LIMIT_EXCEEDED','Cumulative execution usage is outside its reservation');
    const bytes=outcome?.kind==='succeeded'?Buffer.byteLength(canonical(outcome.output)):outcome?.detail?Buffer.byteLength(outcome.detail):0;
    if(!core.resourceLessOrEqual(bytes,usage.outputBytes))fail('INVALID_ARGUMENT','Reported output usage does not cover the outcome');
  }
  outcome(snapshot,value,outcome,usage,access,state) {
    this.evidence(snapshot,outcome.evidence,access);
    this.usage(value,usage,outcome,true);
    if (outcome.kind==='succeeded') {
      const cap=this.capability(snapshot,value.intent.capability).value;
      if (!this.k.compiled(this.k.schema(snapshot,cap.outputSchema))(outcome.output)) fail('INVALID_ARGUMENT','Outcome does not satisfy capability output schema');
    }
    value.state=state;value.outcome=outcome;value.usage=usage;delete value.lease;
    const violations=[...cumulative,'memoryBytes'].filter(key=>!core.resourceLessOrEqual(usage[key],value.intent.limits[key]));
    if (violations.length) value.limitViolations=violations;
  }
  update(snapshot,method,input,principal,access) {
    const stored=this.get(snapshot,input.executionId,principal,access),value=structuredClone(stored.value);
    const origin=snapshot.controlState.executionOrigins[value.intent.id],cap=this.capability(snapshot,value.intent.capability).value;
    let leaseMeta=snapshot.controlState.executionLeases?.[value.intent.id] ?? null;
    if (method==='execution.cancel') this.cancel(value,input.reason,principal);
    else if (method==='execution.claim') {
      if (!core.sameText(cap.providerId,principal)) fail('FORBIDDEN','Only the advertised provider can claim execution');
      const next=transition(value,'claim');
      if(next.authority)this.authority(snapshot,value.intent,origin.principalId);
      value.attempt=core.fenceNext(value.attempt);value.state=next.state;
      const window=this.leaseWindow(snapshot,value,input.leaseMillis,cap);
      value.lease={id:randomUUID(),holderId:principal,fencingToken:value.attempt,expiresAt:window.expiresAt};leaseMeta=window.meta;
    } else if (method==='execution.heartbeat') {
      const observed=this.lease(snapshot,value,principal,input);
      const next=transition(value,'heartbeat');
      if(next.authority)this.authority(snapshot,value.intent,origin.principalId);value.state=next.state;
      const window=this.leaseWindow(snapshot,value,input.leaseMillis,cap,observed);
      value.lease.expiresAt=window.expiresAt;leaseMeta=window.meta;
    } else if (method==='execution.finish') {
      this.lease(snapshot,value,principal,input);
      const next=transition(value,'finish',input.outcome.kind);
      this.outcome(snapshot,value,input.outcome,input.usage,access,next.state);leaseMeta=null;
    } else if (method==='execution.reconcile') {
      if (!core.fenceEqual(input.attempt,value.attempt)) fail('LEASE_STALE','Reconciliation names a different attempt','reconcile');
      const next=transition(value,input.resolution.kind==='retry'?'retry':'observed',input.resolution.outcome?.kind);
      if(!core.executionReconcile(principal,cap.providerId,access.operator,access.canRead(stored.ref)))fail('FORBIDDEN','Reconciliation requires provider or explicit execution access');
      const resolution=input.resolution,evidence=resolution.kind==='retry'?resolution.evidence:resolution.outcome.evidence;
      this.evidence(snapshot,evidence,access,true);
      if (resolution.kind==='observed') this.outcome(snapshot,value,resolution.outcome,input.usage,access,next.state);
      else {
        const admission=core.retryAdmission(value.cancellation,resolution.basis,cap.reconciliation);
        if(admission==='RetryCancelled')fail('FORBIDDEN','Cancelled execution intent cannot be retried');
        if(admission==='RetryUnsupported')fail('FORBIDDEN','Provider does not declare idempotent replay');
        if(next.authority)this.authority(snapshot,value.intent,origin.principalId);this.usage(value,input.usage);
        value.state=next.state;value.usage=input.usage;delete value.outcome;delete value.lease;
      }
      leaseMeta=null;
    } else fail('INVALID_ARGUMENT','Unknown execution operation');
    return { value,leaseMeta };
  }
  authorityExpiries(snapshot,value) {
    return snapshot.controlState.executionOrigins[value.intent.id].grantIds.map(id=>snapshot.controlState.grants[id].value.expiresAt).filter(Boolean).map(instant=>Date.parse(instant));
  }
  leaseWindow(snapshot,value,millis,cap,observed=core.observeClock(this.k.clock)) {
    return core.leaseWindow(observed,millis,[Date.parse(cap.expiresAt),...(value.intent.limits.deadline?[Date.parse(value.intent.limits.deadline)]:[]),...this.authorityExpiries(snapshot,value)]);
  }
  cancel(value,reason,principal) {
    const next=transition(value,'cancel');if(!next.cancellation)return;
    value.cancellation ??= { requestedBy:principal,requestedAt:new Date(this.k.clock.wall()).toISOString(),reason };
    value.state=next.state;
    if(next.immediate)value.outcome={ kind:'cancelled',evidence:{ sources:[],artifactDigests:[],method:reason } };
  }
  cancelMatching(snapshot,predicate,reason,principal,control) {
    for (const [id,stored] of Object.entries(snapshot.controlState.executions ?? {})) if (predicate(stored.value,snapshot.controlState.executionOrigins[id])) {
      const value=structuredClone(stored.value);this.cancel(value,reason,principal);
      if (canonical(value)!==canonical(stored.value)) control('executions',id,this.k.stored(snapshot.context.id,value,snapshot.context.revision+1,principal,id));
    }
  }
  maintain(contextId) {
    const k=this.k,snapshot=k.store.read(contextId),changes=[],observed=core.observeClock(k.clock);
    for (const [id,stored] of Object.entries(snapshot.controlState.executions ?? {})) {
      const value=structuredClone(stored.value);
      const queued=core.executionQueued(value.state),decision=core.executionMaintenance(value,snapshot.controlState.executionLeases?.[id],observed,queued?Date.parse(this.capability(snapshot,value.intent.capability).value.expiresAt):0,queued?this.authorityExpiries(snapshot,value):[]);
      if (decision==='ClockLost') {
        value.state=transition(value,'lost').state;value.outcome={ kind:'unknown',detail:'Lease expired or its owning runtime restarted',evidence:{ sources:[],artifactDigests:[],method:'runtime-lease-observation' } };delete value.lease;
      } else if (decision==='ClockCancelDeadline') this.cancel(value,'Execution deadline observed',k.ownerId);
      else if (decision==='ClockCancelAuthority') this.cancel(value,'Undispatched capability or grant expired',k.ownerId);
      if (canonical(value)!==canonical(stored.value)) {
        changes.push({ namespace:'executions',key:id,value:k.stored(contextId,value,snapshot.context.revision+1,k.ownerId,id) });
        if (!value.lease) changes.push({ namespace:'executionLeases',key:id,value:null });
      }
    }
    if (!changes.length) return;
    const mutation={ contextId,expectedRevision:snapshot.context.revision,idempotencyKey:`${k.clock.bootId}:${snapshot.context.revision}` };
    const batch={ mutation,principalId:k.ownerId,requestDigest:digest(mutation),changes:[],controlChanges:changes,outbox:[],response:{ kind:'commit-receipt' },events:changes.filter(item=>item.namespace==='executions').map(item=>({ id:randomUUID(),contextId,type:'execution.recovered',subjectRefs:[k.ref(contextId,item.key)],causeIds:[],payload:null })) };
    const committed=k.store.commit(batch,'$runtime.execution.maintenance');
    if (!committed.ok && committed.error.code!=='REVISION_CONFLICT') fail(committed.error.code,committed.error.message,committed.error.retry);
  }
  maintainAll() { for (const id of this.k.store.contextIds()) this.maintain(id); }
  nextDelay() {
    const k=this.k,observed=core.observeClock(k.clock),delays=[];
    for (const id of k.store.contextIds()) {
      const snapshot=k.store.read(id);
      for (const stored of Object.values(snapshot.controlState.executions ?? {})) {
        const value=stored.value;
        if (value.lease && !terminal(value.state)) {
          const meta=snapshot.controlState.executionLeases?.[value.intent.id];
          if(!core.leaseFrame(meta,observed))delays.push(0);else delays.push(Date.parse(value.lease.expiresAt)-observed.wall,meta.monotonicDeadline-observed.monotonic);
        }
        if (core.executionQueued(value.state)) {
          const deadlines=[Date.parse(this.capability(snapshot,value.intent.capability).value.expiresAt),...this.authorityExpiries(snapshot,value)];
          delays.push(...deadlines.map(time=>time-observed.wall));
        }
        if(core.executionWaitsDeadline(value.state,value.cancellation)&&value.intent.limits.deadline)delays.push(Date.parse(value.intent.limits.deadline)-observed.wall);
      }
    }
    return core.timeDelay(delays);
  }
}
