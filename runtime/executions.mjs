import { randomUUID } from 'node:crypto';
import { canonical, digest, fail, DomainError } from './json.mjs';
import { sameRef, boundLimits, grantChain } from './authority.mjs';
import { validateVerifier } from './providers/bytes-definition.mjs';

import { executionMethods } from './operations.mjs';
export { executionMethods } from './operations.mjs';
export const terminal=state=>['succeeded','failed','cancelled'].includes(state);
const cumulative=['cpuMillis','outputBytes','modelTokens','apiSpendMicrounits'];
export const zeroUsage=()=>({ cpuMillis:0,memoryBytes:0,outputBytes:0,modelTokens:0,apiSpendMicrounits:0 });

/** Trusted kernel component. All public calls still pass current method admission. */
export class Executions {
  constructor(kernel) { this.k=kernel; }
  evidence(snapshot,evidence,access,required=false) {
    if (required && !evidence.sources.length) fail('INVALID_ARGUMENT','Reconciliation requires attributable source evidence');
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
    if (Object.keys(snapshot.controlState.capabilities ?? {}).length>=4096) fail('LIMIT_EXCEEDED','Capability retention capacity reached');
    if (capability.providerId!==principal) fail('FORBIDDEN','Capability must belong to its authenticated provider');
    if (methodNames.includes(capability.name)) fail('INVALID_ARGUMENT','Capability name collides with a protocol method');
    if (Date.parse(capability.expiresAt)<=this.k.clock.wall()) fail('CAPABILITY_UNAVAILABLE','Cannot publish an expired capability');
    for (const ref of [capability.inputSchema,capability.outputSchema]) {
      const schema=this.k.schema(snapshot,ref);if (!access.canRead(schema.ref)) fail('NOT_FOUND','Capability schema is inaccessible');
    }
    this.evidence(snapshot,capability.evidence,access);
    return this.k.stored(snapshot.context.id,capability,snapshot.context.revision+1,principal);
  }
  match(snapshot,current,input,principal,access,boundGrant) {
    if (!access.operator && !sameRef(input.grant,boundGrant)) fail('FORBIDDEN','Only the bound grant may be matched');
    this.k.local(input.grant,input.contextId);
    const stored=current.controlState.grants?.[input.grant.id];if (!stored) fail('NOT_FOUND','Grant not found');
    const chain=grantChain(current,input.grant,stored.value.principalId,this.k.clock.wall());
    const req=input.requirement;
    const matches=Object.values(snapshot.controlState.capabilities ?? {}).filter(item=>access.canRead(item.ref) && item.value.name===req.name).map(item=>{
      const cap=item.value,unmet=[];
      if (!req.versions.includes(cap.version)) unmet.push('version');
      for (const name of ['inputSchema','outputSchema']) if (canonical(cap[name])!==canonical(req[name])) unmet.push(name);
      if (req.features.some(feature=>!cap.features.includes(feature))) unmet.push('features');
      if (!req.acceptableIsolation.includes(cap.isolation)) unmet.push('isolation');
      if (Date.parse(cap.expiresAt)<=this.k.clock.wall()) unmet.push('expired');
      if (chain.some(grant=>!grant.actions.includes(cap.name) || !grant.resourceRefs.some(ref=>sameRef(ref,item.ref)))) unmet.push('grant');
      let eligibility='eligible';
      if (input.incidentId===undefined && chain.some(grant=>grant.incidentIds!=='all')) { if (!unmet.length) eligibility='unknown';unmet.push('incident_required'); }
      if (!unmet.length) {
        try { this.k.authorize(current,cap.name,stored.value.principalId,{ incidentId:input.incidentId,resourceRefs:[item.ref] },input.grant); }
        catch (error) { if (!(error instanceof DomainError)) throw error;unmet.push(error.code==='POLICY_INDETERMINATE'?'policy_unknown':'policy');eligibility=error.code==='POLICY_INDETERMINATE'?'unknown':'ineligible'; }
      }
      if (unmet.length && eligibility!=='unknown') eligibility='ineligible';
      return { capability:item,unmet,eligibility };
    });
    const rank={ eligible:0,unknown:1,ineligible:2 };
    return matches.sort((a,b)=>rank[a.eligibility]-rank[b.eligibility] || a.unmet.length-b.unmet.length || (a.capability.ref.id<b.capability.ref.id?-1:1)).slice(0,input.limit);
  }
  authority(snapshot,intent,requester) {
    const cap=this.capability(snapshot,intent.capability).value;
    if (Date.parse(cap.expiresAt)<=this.k.clock.wall()) fail('CAPABILITY_UNAVAILABLE','Capability advertisement expired');
    if (snapshot.context.state!=='open') fail('FORBIDDEN','Context is closed');
    const incident=snapshot.controlState.incidents?.[intent.incidentId];
    if (!incident || ['completed','cancelled'].includes(incident.value.status)) fail('FORBIDDEN','Incident is not accepting execution');
    const access=this.k.authorize(snapshot,'execution.request',requester,{ incidentId:intent.incidentId,resourceRefs:[intent.capability] },intent.grant);
    this.k.authorize(snapshot,cap.name,requester,{ incidentId:intent.incidentId,resourceRefs:[intent.capability] },intent.grant);
    boundLimits(intent.limits,snapshot.context.limits);boundLimits(intent.limits,this.k.lookup(snapshot,snapshot.context.policy).value.limits);
    for (const grant of access.chain) boundLimits(intent.limits,grant.limits);
    if (intent.limits.concurrentExecutions!==1) fail('INVALID_ARGUMENT','One execution reserves exactly one concurrency slot');
    if (intent.limits.deadline && Date.parse(intent.limits.deadline)<=this.k.clock.wall()) fail('LIMIT_EXCEEDED','Execution deadline passed');
    if (!this.k.compiled(this.k.schema(snapshot,cap.inputSchema))(intent.input)) fail('INVALID_ARGUMENT','Execution input does not satisfy the capability schema');
    validateVerifier(cap,this.k.ownerId,intent);
    this.capacity(snapshot,{ limits:{ ...zeroUsage(),concurrentExecutions:0 } },access.chain);
    return { cap,access };
  }
  totals(snapshot,grantId) {
    const result={ ...zeroUsage(),concurrentExecutions:0 };
    for (const [id,stored] of Object.entries(snapshot.controlState.executions ?? {})) {
      if (grantId && !snapshot.controlState.executionOrigins[id].grantIds.includes(grantId)) continue;
      const value=stored.value,active=!terminal(value.state);
      for (const key of cumulative) {
        const sum=result[key]+(active?Math.max(value.intent.limits[key],value.usage[key]):value.usage[key]);
        result[key]=Number.isSafeInteger(sum)?sum:Infinity;
      }
      const memory=result.memoryBytes+(active?Math.max(value.intent.limits.memoryBytes,value.usage.memoryBytes):0);
      result.memoryBytes=Number.isSafeInteger(memory)?memory:Infinity;
      result.concurrentExecutions+=active?1:0;
    }
    return result;
  }
  capacity(snapshot,intent,chain) {
    if (Object.values(snapshot.controlState.executions ?? {}).some(item=>item.value.limitViolations?.length)) fail('LIMIT_EXCEEDED','Observed resource overrun blocks further context dispatch');
    for (const [grantId,limits] of [[undefined,snapshot.context.limits],[undefined,this.k.lookup(snapshot,snapshot.context.policy).value.limits],...chain.map(grant=>[grant.id,grant.limits])]) {
      const totals=this.totals(snapshot,grantId);
      for (const key of [...cumulative,'memoryBytes','concurrentExecutions']) if (totals[key]>limits[key]-intent.limits[key]) fail('LIMIT_EXCEEDED','Aggregate execution reservation exceeds its envelope');
    }
  }
  prepare(snapshot,intent,actor,access,requester=actor) {
    this.k.ensureNewId(snapshot,intent.id);
    if (Object.keys(snapshot.controlState.executions ?? {}).length>=4096) fail('LIMIT_EXCEEDED','Execution retention capacity reached');
    if (!access.canIncident(intent.incidentId) || !access.canRead(intent.capability)) fail('NOT_FOUND','Execution scope is inaccessible');
    if (!access.operator && (actor===requester ? !sameRef(intent.grant,this.k.ref(snapshot.context.id,access.chain[0].id)) : !access.canRead(intent.grant))) fail('FORBIDDEN','Execution requires its bound grant or explicit review access');
    const { cap,access:requestAccess }=this.authority(snapshot,intent,requester);
    this.capacity(snapshot,intent,requestAccess.chain);
    return { execution:{ intent,state:'queued',attempt:0,usage:zeroUsage() },origin:{ principalId:requester,grantIds:requestAccess.chain.map(grant=>grant.id),providerId:cap.providerId } };
  }
  get(snapshot,id,principal,access) {
    const stored=snapshot.controlState.executions?.[id],origin=snapshot.controlState.executionOrigins?.[id];
    if (!stored || !origin || !access.canIncident(stored.value.intent.incidentId)) fail('NOT_FOUND','Execution not found');
    const own=origin.principalId===principal && access.chain.some(grant=>grant.id===origin.grantIds[0]);
    const provider=origin.providerId===principal && access.canRead(stored.value.intent.capability);
    if (!access.operator && !own && !provider && !access.canRead(stored.ref)) fail('NOT_FOUND','Execution not found');
    return stored;
  }
  expired(value,meta) {
    return value.lease && (!meta || meta.bootId!==this.k.clock.bootId || this.k.clock.monotonic()>=meta.monotonicDeadline || this.k.clock.wall()>=Date.parse(value.lease.expiresAt));
  }
  lease(snapshot,value,principal,input) {
    if (!value.lease || value.lease.holderId!==principal || value.lease.id!==input.leaseId || value.lease.fencingToken!==input.fencingToken || this.expired(value,snapshot.controlState.executionLeases?.[value.intent.id])) fail('LEASE_STALE','Execution lease is stale','reconcile');
  }
  usage(value,usage,outcome,observed=false) {
    for (const key of Object.keys(usage)) if (usage[key]<value.usage[key] || (!observed && usage[key]>value.intent.limits[key])) fail('LIMIT_EXCEEDED','Cumulative execution usage is outside its reservation');
    const bytes=outcome?.kind==='succeeded'?Buffer.byteLength(canonical(outcome.output)):outcome?.detail?Buffer.byteLength(outcome.detail):0;
    if (usage.outputBytes<bytes) fail('INVALID_ARGUMENT','Reported output usage does not cover the outcome');
  }
  outcome(snapshot,value,outcome,usage,access) {
    this.evidence(snapshot,outcome.evidence,access);
    this.usage(value,usage,outcome,true);
    if (outcome.kind==='succeeded') {
      const cap=this.capability(snapshot,value.intent.capability).value;
      if (!this.k.compiled(this.k.schema(snapshot,cap.outputSchema))(outcome.output)) fail('INVALID_ARGUMENT','Outcome does not satisfy capability output schema');
    }
    value.state=outcome.kind;value.outcome=outcome;value.usage=usage;delete value.lease;
    const violations=Object.keys(usage).filter(key=>usage[key]>value.intent.limits[key]);
    if (violations.length) value.limitViolations=violations;
  }
  update(snapshot,method,input,principal,access) {
    const stored=this.get(snapshot,input.executionId,principal,access),value=structuredClone(stored.value);
    const origin=snapshot.controlState.executionOrigins[value.intent.id],cap=this.capability(snapshot,value.intent.capability).value;
    let leaseMeta=snapshot.controlState.executionLeases?.[value.intent.id] ?? null;
    if (method==='execution.cancel') this.cancel(value,input.reason,principal);
    else if (method==='execution.claim') {
      if (cap.providerId!==principal) fail('FORBIDDEN','Only the advertised provider can claim execution');
      if (value.state!=='queued') fail('LEASE_STALE','Execution is not claimable','reconcile');
      this.authority(snapshot,value.intent,origin.principalId);
      if (value.attempt>=Number.MAX_SAFE_INTEGER) fail('LIMIT_EXCEEDED','Execution fencing token exhausted');
      value.attempt++;value.state='leased';
      const deadline=this.leaseDeadline(snapshot,value,input.leaseMillis,cap);
      value.lease={ id:randomUUID(),holderId:principal,fencingToken:value.attempt,expiresAt:new Date(deadline).toISOString() };
      leaseMeta={ bootId:this.k.clock.bootId,monotonicDeadline:this.k.clock.monotonic()+deadline-this.k.clock.wall() };
    } else if (method==='execution.heartbeat') {
      this.lease(snapshot,value,principal,input);
      if (!['leased','running','cancel_requested'].includes(value.state)) fail('LEASE_STALE','Execution is not active','reconcile');
      if (value.state!=='cancel_requested') { this.authority(snapshot,value.intent,origin.principalId);value.state='running'; }
      const deadline=this.leaseDeadline(snapshot,value,input.leaseMillis,cap);
      value.lease.expiresAt=new Date(deadline).toISOString();leaseMeta={ bootId:this.k.clock.bootId,monotonicDeadline:this.k.clock.monotonic()+deadline-this.k.clock.wall() };
    } else if (method==='execution.finish') {
      this.lease(snapshot,value,principal,input);
      if (!['leased','running','cancel_requested'].includes(value.state)) fail('LEASE_STALE','Execution is not active','reconcile');
      if (value.state==='leased' && ['succeeded','failed'].includes(input.outcome.kind)) fail('INVALID_ARGUMENT','Dispatch heartbeat is required before reporting an effect');
      this.outcome(snapshot,value,input.outcome,input.usage,access);leaseMeta=null;
    } else if (method==='execution.reconcile') {
      if (input.attempt!==value.attempt) fail('LEASE_STALE','Reconciliation names a different attempt','reconcile');
      if (value.state!=='unknown') fail('INVALID_ARGUMENT','Only unknown executions can be reconciled');
      if (principal!==cap.providerId && !access.operator && !access.canRead(stored.ref)) fail('FORBIDDEN','Reconciliation requires provider or explicit execution access');
      const resolution=input.resolution,evidence=resolution.kind==='retry'?resolution.evidence:resolution.outcome.evidence;
      this.evidence(snapshot,evidence,access,true);
      if (resolution.kind==='observed') this.outcome(snapshot,value,resolution.outcome,input.usage,access);
      else {
        if (value.cancellation) fail('FORBIDDEN','Cancelled execution intent cannot be retried');
        if (resolution.basis==='idempotent' && cap.reconciliation!=='idempotent') fail('FORBIDDEN','Provider does not declare idempotent replay');
        this.authority(snapshot,value.intent,origin.principalId);this.usage(value,input.usage);
        value.state='queued';value.usage=input.usage;delete value.outcome;delete value.lease;
      }
      leaseMeta=null;
    } else fail('INVALID_ARGUMENT','Unknown execution operation');
    return { value,leaseMeta };
  }
  authorityExpiries(snapshot,value) {
    return snapshot.controlState.executionOrigins[value.intent.id].grantIds.map(id=>snapshot.controlState.grants[id].value.expiresAt).filter(Boolean).map(instant=>Date.parse(instant));
  }
  leaseDeadline(snapshot,value,millis,cap) {
    const deadline=Math.min(this.k.clock.wall()+millis,Date.parse(cap.expiresAt),value.intent.limits.deadline?Date.parse(value.intent.limits.deadline):Infinity,...this.authorityExpiries(snapshot,value));
    if (deadline<=this.k.clock.wall()) fail('LEASE_STALE','No remaining lease interval','reconcile');
    return deadline;
  }
  cancel(value,reason,principal) {
    if (terminal(value.state)) return;
    value.cancellation ??= { requestedBy:principal,requestedAt:new Date(this.k.clock.wall()).toISOString(),reason };
    if (value.state==='unknown') return;
    if (value.state==='queued') { value.state='cancelled';value.outcome={ kind:'cancelled',evidence:{ sources:[],artifactDigests:[],method:reason } }; }
    else value.state='cancel_requested';
  }
  cancelMatching(snapshot,predicate,reason,principal,control) {
    for (const [id,stored] of Object.entries(snapshot.controlState.executions ?? {})) if (predicate(stored.value,snapshot.controlState.executionOrigins[id])) {
      const value=structuredClone(stored.value);this.cancel(value,reason,principal);
      if (canonical(value)!==canonical(stored.value)) control('executions',id,this.k.stored(snapshot.context.id,value,snapshot.context.revision+1,principal,id));
    }
  }
  maintain(contextId) {
    const k=this.k,snapshot=k.store.read(contextId),changes=[];
    for (const [id,stored] of Object.entries(snapshot.controlState.executions ?? {})) {
      const value=structuredClone(stored.value);
      if (this.expired(value,snapshot.controlState.executionLeases?.[id])) {
        value.state='unknown';value.outcome={ kind:'unknown',detail:'Lease expired or its owning runtime restarted',evidence:{ sources:[],artifactDigests:[],method:'runtime-lease-observation' } };delete value.lease;
      } else if (value.intent.limits.deadline && Date.parse(value.intent.limits.deadline)<=k.clock.wall()) this.cancel(value,'Execution deadline observed',k.ownerId);
      else if (value.state==='queued' && (Date.parse(this.capability(snapshot,value.intent.capability).value.expiresAt)<=k.clock.wall() || this.authorityExpiries(snapshot,value).some(time=>time<=k.clock.wall()))) this.cancel(value,'Undispatched capability or grant expired',k.ownerId);
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
    const k=this.k;let delay=Infinity;
    for (const id of k.store.contextIds()) {
      const snapshot=k.store.read(id);
      for (const stored of Object.values(snapshot.controlState.executions ?? {})) {
        const value=stored.value;
        if (value.lease) {
          const meta=snapshot.controlState.executionLeases?.[value.intent.id];
          delay=Math.min(delay,!meta || meta.bootId!==k.clock.bootId?0:Math.min(Date.parse(value.lease.expiresAt)-k.clock.wall(),meta.monotonicDeadline-k.clock.monotonic()));
        }
        if (value.state==='queued') {
          const deadlines=[Date.parse(this.capability(snapshot,value.intent.capability).value.expiresAt),...this.authorityExpiries(snapshot,value),...(value.intent.limits.deadline?[Date.parse(value.intent.limits.deadline)]:[])];
          delay=Math.min(delay,...deadlines.map(time=>time-k.clock.wall()));
        }
      }
    }
    return delay===Infinity?null:Math.max(0,delay);
  }
}
