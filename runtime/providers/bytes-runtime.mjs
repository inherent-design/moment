import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { canonical,digest,fail,DomainError } from '../json.mjs';
import { createClient } from '../client.mjs';
import { readCredential } from '../credentials.mjs';
import { realpathSync } from 'node:fs';
import { terminal } from '../executions.mjs';
import { BytesVerifier } from './bytes-host.mjs';
import { descriptor,descriptorDigest,workerDigest,profileName,verifierFeatures,recommendedLimits,matchesVerifier,inputSchema,inputDocument,outputSchema,outputDocument,receiptSchema,receiptDocument,assertVerifierLocation } from './bytes-definition.mjs';
const cacheKey=(contextId,id)=>contextId+':'+id;

/** Explicit owner operation. Publication and policy activation use ordinary admitted API calls. */
export async function installVerifier(root,contextId) {
  assertVerifierLocation(realpathSync(root));
  const credentialFile=join(root,'runtime','owner.json'),owner=readCredential(credentialFile),client=createClient(root,{ credentialFile });
  const call=async(method,input)=>{ const result=await client.call(method,input);if (!result.ok) fail(result.error.code,result.error.message,result.error.retry);return result.value; };
  const write=async(method,input)=>{
    for (let count=0;count<8;count++) {
      const ctx=await call('context.get',{ contextId }),result=await client.call(method,{ contextId,expectedRevision:ctx.revision,idempotencyKey:randomUUID(),...input });
      if (result.ok) return result.value;if (result.error.code!=='REVISION_CONFLICT') fail(result.error.code,result.error.message,result.error.retry);
    }
    fail('REVISION_CONFLICT','Verifier setup needs a fresh context snapshot','refresh');
  };
  const context=await call('context.get',{ contextId }),old=await call('control.get',{ contextId,ref:context.policy });
  const limits=recommendedLimits(context.limits.currency);
  for (const name of ['cpuMillis','memoryBytes','outputBytes','concurrentExecutions']) if (context.limits[name]<limits[name] || old.value.limits[name]<limits[name]) fail('LIMIT_EXCEEDED','Context envelope is below the installed verifier profile minimum');
  for (const [schema,document] of [[inputSchema,inputDocument],[outputSchema,outputDocument],[receiptSchema,receiptDocument]]) await write('schema.publish',{ schema,document });
  const evidence={ sources:[],artifactDigests:[workerDigest,descriptorDigest],method:'installed-local-bytes-verifier/v1' };
  const cap=await write('capability.advertise',{ capability:{ id:randomUUID(),providerId:owner.principalId,name:profileName,version:'1',inputSchema,outputSchema,features:verifierFeatures,platform:descriptor.platform,isolation:'process',reconciliation:'lookup',evidence,expiresAt:new Date(Date.now()+86400000).toISOString() } });
  const current=await call('context.get',{ contextId }),policy=(await call('control.get',{ contextId,ref:current.policy })).value;
  const when={ kind:'equal',left:{ kind:'binding',name:'principalId' },right:{ kind:'literal',value:owner.principalId } };
  if (!policy.rules.some(rule=>rule.effect==='permit' && rule.actions.includes(profileName) && canonical(rule.when)===canonical(when))) {
    const candidate=await write('policy.publish',{ policy:{ ...policy,id:randomUUID(),parent:current.policy,rules:[...policy.rules,{ id:'installed-verifier-'+cap.ref.id,effect:'permit',actions:[profileName],when }] } });
    await write('policy.activate',{ policy:candidate.ref,evidence });
  }
  const envelope={ ...limits,...(policy.limits.deadline?{ deadline:policy.limits.deadline }:{}) };
  const grant=await write('grant.issue',{ grant:{ id:randomUUID(),principalId:owner.principalId,actions:['execution.request',profileName],incidentIds:'all',resourceRefs:[cap.ref],delegable:false,limits:{ ...policy.limits,modelTokens:0,apiSpendMicrounits:0 } } });
  return { capability:cap.ref,grant:grant.ref,limits:envelope,inputSchema,outputSchema,descriptorDigest };
}

/** One fixed verifier worker per local daemon; queue reservations remain in the kernel. */
export class VerifierRuntime {
  constructor(kernel,root,{ onChange=()=>{} }={}) {
    this.k=kernel;this.onChange=contextId=>{ try { onChange(contextId); } catch { process.stderr.write('Verifier notification failed; receipt remains retained.\n'); } };this.host=new BytesVerifier(root,{ providerId:kernel.ownerId,onChange:this.onChange });
    this.active=new Map();this.blocked=new Map();this.lastContext=undefined;this.closed=false;
  }
  call(method,input) {
    const k=this.k;
    const result=k.call(method,{ contextId:input.contextId,expectedRevision:k.store.read(input.contextId).context.revision,idempotencyKey:randomUUID(),...input },k.ownerId);
    if (!result.ok) fail(result.error.code,result.error.message,result.error.retry);return result.value;
  }
  source(contextId,execution,observed) {
    const k=this.k,snapshot=k.store.read(contextId),idHash=digest([execution.intent.id,execution.attempt,observed.hash]).slice(7,39),id=[idHash.slice(0,8),idHash.slice(8,12),idHash.slice(12,16),idHash.slice(16,20),idHash.slice(20)].join('-');
    const ref=k.ref(contextId,id),record={ kind:'atom',id,schema:receiptSchema,value:observed.source },existing=snapshot.records.find(item=>item.ref.id===id);
    if (existing && existing.digest!==digest(record)) fail('IDENTITY_CONFLICT','Provider evidence identity has conflicting content');
    if (existing && snapshot.assertions.some(item=>item.status==='asserted' && item.assertion.recordedBy===k.ownerId && item.assertion.value.record.id===id && item.assertion.value.evidence.artifactDigests.includes(observed.hash))) return ref;
    try {
      this.call('graph.transact',{ contextId,changes:[{ kind:'record.put',record },{ kind:'assertion.put',assertion:{ id:randomUUID(),record:ref,evidence:{ sources:[execution.intent.capability],artifactDigests:[observed.hash],method:'verified-local-provider-receipt' } } }] });return ref;
    } catch(error) {
      if (!(error instanceof DomainError) || error.code!=='FORBIDDEN') throw error;
      // Finalization can outlive graph-write authority; the descriptor and retained byte digest remain attributable sources.
      return execution.intent.capability;
    }
  }
  proof(contextId,execution,observed,evidence) { return { ...evidence,sources:[this.source(contextId,execution,observed)] }; }
  post(contextId,execution,report,reconcile=false) {
    const observed=this.host.lookup(execution),outcome=report.resolution?.kind==='observed'?report.resolution.outcome:report.outcome;
    if (reconcile && outcome?.kind==='unknown' && execution.outcome?.kind==='unknown' && canonical(execution.usage)===canonical(report.usage) && execution.outcome.evidence.artifactDigests.includes(observed.hash)) return;
    const evidence=this.proof(contextId,execution,observed,outcome?.evidence ?? report.resolution.evidence);
    if (reconcile) {
      const resolution=report.resolution.kind==='observed'?{ kind:'observed',outcome:{ ...outcome,evidence } }:{ ...report.resolution,evidence };
      this.call('execution.reconcile',{ contextId,executionId:execution.intent.id,attempt:report.attempt,resolution,usage:report.usage });
    } else {
      this.call('execution.finish',{ contextId,executionId:execution.intent.id,leaseId:execution.lease.id,fencingToken:execution.lease.fencingToken,outcome:{ ...outcome,evidence },usage:report.usage });
    }
    if (outcome && terminal(outcome.kind)) this.host.retire(execution);
  }
  fault(contextId,execution,error) {
    const k=this.k,entry=cacheKey(contextId,execution.intent.id);
    try {
      const snapshot=k.store.read(contextId),activity=k.store.sequence(contextId,true);
      if (this.blocked.get(entry)===activity) return;
      const detail={ code:error instanceof DomainError?error.code:'INTERNAL',message:error instanceof DomainError?error.message:'Local verifier needs inspection',retry:'reconcile',details:null };
      const mutation={ contextId,expectedRevision:snapshot.context.revision,idempotencyKey:randomUUID() };
      const result=k.store.commit({ mutation,principalId:k.ownerId,requestDigest:digest(mutation),changes:[],controlChanges:[{ namespace:'providerFaults',key:execution.intent.id,value:detail }],outbox:[],response:{ kind:'commit-receipt' },events:[{ id:randomUUID(),contextId,type:'runtime.provider.waiting',subjectRefs:[k.ref(contextId,execution.intent.id)],causeIds:[],payload:{ fault:detail } }] },'$runtime.provider.fault');
      if (!result.ok) fail(result.error.code,result.error.message,result.error.retry);this.blocked.set(entry,k.store.sequence(contextId,true));
    } catch {
      try { this.blocked.set(entry,k.store.sequence(contextId,true)); } catch {}
      process.stderr.write('Verifier finalization needs inspection; provider files remain retained.\n');
    }
  }
  eligibleContexts() {
    return this.k.store.contextIds().filter(id=>{
      const snapshot=this.k.store.read(id),activity=this.k.store.sequence(id,true);
      return Object.values(snapshot.controlState.executions ?? {}).some(item=>item.value.state==='queued' && this.blocked.get(cacheKey(id,item.value.intent.id))!==activity && matchesVerifier(snapshot.controlState.capabilities[item.value.intent.capability.id].value,this.k.ownerId));
    }).sort();
  }
  pump(contextId) {
    if (this.closed) return;
    const k=this.k,snapshot=k.store.read(contextId),activity=k.store.sequence(contextId,true);
    for (const intent of k.store.outbox(contextId)) {
      const stored=snapshot.controlState.executions?.[intent.id];if (!stored) continue;
      const execution=stored.value,id=execution.intent.id,entry=cacheKey(contextId,id);
      if (!matchesVerifier(snapshot.controlState.capabilities[execution.intent.capability.id].value,k.ownerId)) continue;
      if (execution.cancellation && this.active.has(entry)) { this.host.cancel(execution).catch(()=>{});continue; }
      if (this.active.has(entry) || this.blocked.get(entry)===activity) continue;
      if (execution.state==='unknown') {
        this.active.set(entry,null);
        const promise=this.host.reconcile(execution).then(report=>{ if (!this.closed) this.post(contextId,execution,report,true); }).catch(error=>{ if (!this.closed) this.fault(contextId,execution,error); }).finally(()=>{ this.active.delete(entry); });
        this.active.set(entry,promise);continue;
      }
      if (execution.state!=='queued' || this.host.active.size) continue;
      const contexts=this.eligibleContexts(),selected=this.lastContext?(contexts.find(id=>id>this.lastContext) ?? contexts[0]):contexts[0];
      if (contextId!==selected) continue;this.lastContext=contextId;this.active.set(entry,null);
      try {
        const leased=this.call('execution.claim',{ contextId,executionId:id,leaseMillis:15000 }),lease={ leaseId:leased.lease.id,fencingToken:leased.lease.fencingToken };
        const running=this.call('execution.heartbeat',{ contextId,executionId:id,...lease,leaseMillis:15000 });
        const current=k.store.read(contextId),grant=k.lookup(current,running.intent.grant);
        const promise=this.host.execute({ execution:running,grant,policy:current.context.policy }).then(report=>{ if (!this.closed) this.post(contextId,running,report); }).catch(error=>{ if (!this.closed) this.fault(contextId,running,error); }).finally(()=>{
          this.active.delete(entry);if (!this.closed) try { for (const ctx of k.store.contextIds()) this.onChange(ctx); } catch { process.stderr.write('Verifier continuation awaits store recovery.\n'); }
        });this.active.set(entry,promise);
      } catch(error) { this.active.delete(entry);this.fault(contextId,execution,error); }
    }
  }
  async close() { this.closed=true;await this.host.close();await Promise.allSettled([...this.active.values()].filter(Boolean)); }
}
