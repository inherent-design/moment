import { randomUUID } from 'node:crypto';
import { canonical,digest,fail,DomainError } from './json.mjs';
import { boundLimits } from './authority.mjs';
import { inputSchemas } from './validation.mjs';
import { terminal,zeroUsage } from './executions.mjs';
const resources=['concurrentExecutions','cpuMillis','memoryBytes','outputBytes','modelTokens','apiSpendMicrounits'];
const fault=error=>({ code:error.code,message:error.message,retry:error.retry,details:null });

/** Durable trigger bookkeeping grants no authority to the resulting operation. */
export class Scheduler {
  constructor(kernel) { this.k=kernel; }
  canRead(snapshot,id,principal,access) {
    const stored=snapshot.controlState.schedules?.[id],origin=snapshot.controlState.scheduleOrigins?.[id];
    return Boolean(stored && access.canIncident(stored.value.incidentId) && (access.operator || access.canRead(stored.ref) || (origin.principalId===principal && access.chain.some(grant=>grant.id===origin.grant?.id))));
  }
  get(snapshot,id,principal,access) {
    if (!this.canRead(snapshot,id,principal,access)) fail('NOT_FOUND','Schedule not found');
    const state=snapshot.controlState.scheduleStates[id];
    return { schedule:snapshot.controlState.schedules[id],state:state.state,pendingOccurrenceIds:state.pending.map(item=>item.id),activeExecutionIds:state.activeExecutionIds.filter(executionId=>!terminal(snapshot.controlState.executions[executionId].value.state) && this.k.events.canRef(snapshot,this.k.ref(snapshot.context.id,executionId),principal,access)),...(state.lastFault?{ lastFault:state.lastFault }:{}) };
  }
  admit(snapshot,schedule,principal,grant) {
    const k=this.k;
    const access=k.authorize(snapshot,'schedule.put',principal,{ incidentId:schedule.incidentId },grant);
    k.authorize(snapshot,'reaction.evaluate',principal,{ incidentId:schedule.incidentId },grant);
    if (['event','after'].includes(schedule.wake.kind)) k.authorize(snapshot,'events.read',principal,{ incidentId:schedule.incidentId },grant);
    k.local(schedule.rule,snapshot.context.id);
    const stored=snapshot.controlState.rules?.[schedule.rule.id];
    if (!stored || !access.canRead(stored.ref)) fail('NOT_FOUND','Scheduled rule is inaccessible');
    if (!inputSchemas[stored.value.operation]?.required.includes('expectedRevision')) fail('INVALID_ARGUMENT','A schedule requires an installed context mutation');
    boundLimits(stored.value.limits,snapshot.context.limits);boundLimits(stored.value.limits,k.lookup(snapshot,snapshot.context.policy).value.limits);
    for (const item of access.chain) boundLimits(stored.value.limits,item.limits);
    return { access,rule:stored.value };
  }
  due(snapshot,schedule,principal,access) {
    if (schedule.wake.kind==='at') return Date.parse(schedule.wake.instant);
    if (schedule.wake.kind!=='after') return undefined;
    const event=this.k.store.event(snapshot.context.id,schedule.wake.eventId);
    if (!event || !this.k.events.visible(snapshot,event,principal,access)) fail('NOT_FOUND','Temporal anchor event is inaccessible');
    const value=Date.parse(event.recordedAt)+schedule.wake.durationMillis;
    if (!Number.isSafeInteger(value) || value>Date.parse('9999-12-31T23:59:59.999Z')) fail('INVALID_ARGUMENT','Temporal anchor exceeds the supported calendar');
    return value;
  }
  selected(snapshot,selector,principal,access,event) {
    const ids=event?.subjectRefs.map(ref=>ref.id);
    const restricted=ids?{ ...selector,ids:selector.ids?selector.ids.filter(id=>ids.includes(id)):ids }:selector;
    return this.k.query(snapshot,{ contextId:snapshot.context.id,selector:restricted,limit:1 },principal,access).items.length>0;
  }
  prepare(snapshot,schedule,principal,access,grant) {
    this.k.ensureNewId(snapshot,schedule.id);
    if (Object.keys(snapshot.controlState.schedules ?? {}).length>=128) fail('LIMIT_EXCEEDED','Schedule retention capacity reached');
    const incident=snapshot.controlState.incidents?.[schedule.incidentId];
    if (!incident || !access.canIncident(schedule.incidentId) || ['completed','cancelled'].includes(incident.value.status)) fail('NOT_FOUND','Incident is not accepting schedules');
    this.admit(snapshot,schedule,principal,grant);
    if (['at','after'].includes(schedule.wake.kind) && schedule.recurrence!=='once') fail('INVALID_ARGUMENT','A timer needs a new anchor after completion');
    if (schedule.wake.kind==='capacity' && !resources.includes(schedule.wake.resource)) fail('INVALID_ARGUMENT','Unknown capacity resource');
    const due=this.due(snapshot,schedule,principal,access),sequence=this.k.store.sequence(snapshot.context.id,true);
    return { stored:this.k.stored(snapshot.context.id,schedule,snapshot.context.revision+1,principal),origin:{ principalId:principal,...(grant?{ grant }:{}) },state:{ state:'active',lastSeq:sequence,pending:[],activeExecutionIds:[],edge:schedule.wake.kind==='event' && schedule.wake.mode==='edge'?this.selected(snapshot,schedule.wake.selector,principal,access):false,timerFired:false,blockedActivity:-1,...(due!==undefined?{ due }:{}) } };
  }
  internal(snapshot,changes,events,kind) {
    if (!changes.length) return;
    const mutation={ contextId:snapshot.context.id,expectedRevision:snapshot.context.revision,idempotencyKey:randomUUID() };
    const batch={ mutation,principalId:this.k.ownerId,requestDigest:digest(mutation),changes:[],controlChanges:changes,events,outbox:[],response:{ kind:'commit-receipt' } };
    const result=this.k.store.commit(batch,'$runtime.schedule.'+kind);
    if (!result.ok) fail(result.error.code,result.error.message,result.error.retry);
  }
  event(contextId,id,type,causeIds=[]) {
    return { id:randomUUID(),contextId,type:'runtime.schedule.'+type,subjectRefs:[this.k.ref(contextId,id)],causeIds,payload:null };
  }
  dependsOn(contextId,event,scheduleId) {
    const queue=[event],seen=new Set();let budget=128;
    while (queue.length) {
      const item=queue.pop();if (!item || --budget<0) return 'unknown';
      if (seen.has(item.id)) continue;seen.add(item.id);
      if (item.type==='runtime.schedule.triggered' && item.subjectRefs.some(ref=>ref.id===scheduleId)) return true;
      for (const id of item.causeIds) if (!seen.has(id)) queue.push(this.k.store.event(contextId,id));
    }
    return false;
  }
  available(snapshot,resource,access) {
    if (Object.values(snapshot.controlState.executions ?? {}).some(item=>item.value.limitViolations?.length)) return 0;
    const envelopes=[[undefined,snapshot.context.limits],[undefined,this.k.lookup(snapshot,snapshot.context.policy).value.limits],...access.chain.map(grant=>[grant.id,grant.limits])];
    return Math.max(0,Math.min(...envelopes.map(([id,limits])=>limits[resource]-this.k.executions.totals(snapshot,id)[resource])));
  }
  enqueue(snapshot,id,state,eventIds,events) {
    if (state.pending.length && snapshot.controlState.schedules[id].value.coalesce) {
      const last=state.pending.at(-1),combined=[...new Set([...last.eventIds,...eventIds])];
      if (combined.length>32) return false;
      last.eventIds=combined;return true;
    }
    if (state.pending.length>=128) return false;
    const event=this.event(snapshot.context.id,id,'triggered',eventIds);
    state.pending.push({ id:event.id,eventIds,order:this.k.store.sequence(snapshot.context.id)+events.length+1 });events.push(event);return true;
  }
  markFault(snapshot,id,state,error) {
    state.lastFault=fault(error);state.blockedActivity=this.k.store.sequence(snapshot.context.id,true);
  }
  scan(contextId) {
    const k=this.k,snapshot=k.store.read(contextId),activity=k.store.sequence(contextId,true),changes=[],events=[];
    for (const [id,stored] of Object.entries(snapshot.controlState.schedules ?? {})) {
      const previous=snapshot.controlState.scheduleStates[id];if (previous.state!=='active') continue;
      const state=structuredClone(previous),schedule=stored.value,origin=snapshot.controlState.scheduleOrigins[id];
      if (snapshot.context.state!=='open' || ['completed','cancelled'].includes(snapshot.controlState.incidents[schedule.incidentId]?.value.status)) { state.state='cancelled';state.pending=[]; }
      else if (state.blockedActivity!==activity) try {
        const { access }=this.admit(snapshot,schedule,origin.principalId,origin.grant);
        delete state.lastFault;state.blockedActivity=-1;
        state.activeExecutionIds=state.activeExecutionIds.filter(executionId=>!terminal(snapshot.controlState.executions[executionId].value.state));
        if (schedule.wake.kind==='event' && state.lastSeq<activity) {
          for (const event of k.store.events(contextId,state.lastSeq,256)) {
            if (event.sequence>activity) break;
            let fired=false,nextEdge=state.edge;
            if (!event.type.startsWith('runtime.schedule.') && schedule.wake.eventTypes.includes(event.type) && k.events.visible(snapshot,event,origin.principalId,access)) {
              const dependency=this.dependsOn(contextId,event,id);
              if (dependency==='unknown') fail('POLICY_INDETERMINATE','Causal ancestry is unresolved or exceeds its bound');
              if (!dependency) {
                const atEvent=k.store.read(contextId,event.revision);
                if (schedule.wake.mode==='each') fired=this.selected(atEvent,schedule.wake.selector,origin.principalId,access,event);
                else { nextEdge=this.selected(atEvent,schedule.wake.selector,origin.principalId,access);fired=nextEdge && !state.edge; }
              }
            }
            if (fired && !this.enqueue(snapshot,id,state,[event.id],events)) { state.lastFault={ code:'LIMIT_EXCEEDED',message:'Schedule pending capacity reached; source cursor retained',retry:'refresh',details:null };break; }
            state.lastSeq=event.sequence;state.edge=nextEdge;
            if (state.pending.length && schedule.recurrence==='once') { state.lastSeq=activity;break; }
          }
        } else if (['at','after'].includes(schedule.wake.kind) && !state.timerFired && state.due<=k.clock.wall()) {
          if (schedule.wake.kind==='after') this.due(snapshot,schedule,origin.principalId,access);
          this.enqueue(snapshot,id,state,schedule.wake.kind==='after'?[schedule.wake.eventId]:[],events);state.timerFired=true;
        } else if (schedule.wake.kind==='capacity') {
          const available=this.available(snapshot,schedule.wake.resource,access)>=schedule.wake.atLeast;
          if (available && !state.edge) this.enqueue(snapshot,id,state,[],events);
          state.edge=available;
        }
        if (schedule.wake.kind!=='event') state.lastSeq=activity;
      } catch(error) { if (!(error instanceof DomainError)) throw error;this.markFault(snapshot,id,state,error); }
      if (canonical(state)!==canonical(previous)) {
        changes.push({ namespace:'scheduleStates',key:id,value:state });events.push({ ...this.event(contextId,id,state.lastFault?'waiting':'scanned'),payload:state.lastFault?{ fault:state.lastFault }:null });
      }
    }
    this.internal(snapshot,changes,events,'scan');
  }
  completion(id,occurrence,rule) {
    return (batch,snapshot)=>{
      const previous=snapshot.controlState.scheduleStates[id];
      if (previous.state!=='active' || previous.pending[0]?.id!==occurrence.id) fail('REVISION_CONFLICT','Schedule occurrence changed','refresh');
      const sum={ ...zeroUsage(),concurrentExecutions:0,currency:rule.limits.currency,...(rule.limits.deadline?{ deadline:rule.limits.deadline }:{}) };
      for (const intent of batch.outbox) { boundLimits(intent.limits,rule.limits);for (const resource of resources) sum[resource]+=intent.limits[resource]; }
      boundLimits(sum,rule.limits);
      const schedule=snapshot.controlState.schedules[id].value;
      const state={ ...previous,state:schedule.recurrence==='once'?'completed':'active',pending:previous.pending.slice(1),activeExecutionIds:batch.outbox.map(intent=>intent.id),blockedActivity:-1 };delete state.lastFault;
      batch.controlChanges.push({ namespace:'scheduleStates',key:id,value:state },{ namespace:'schedulerMetadata',key:'lastIncident',value:schedule.incidentId });
      batch.events.push(this.event(snapshot.context.id,id,'completed',[occurrence.id,...occurrence.eventIds]));
    };
  }
  runOne(contextId) {
    const k=this.k,snapshot=k.store.read(contextId),activity=k.store.sequence(contextId,true),last=snapshot.controlState.schedulerMetadata?.lastIncident;
    const candidates=Object.entries(snapshot.controlState.schedules ?? {}).filter(([id])=>{ const state=snapshot.controlState.scheduleStates[id];return state.state==='active' && state.pending.length && !state.activeExecutionIds.length && state.blockedActivity!==activity; });
    candidates.sort(([aId],[bId])=>snapshot.controlState.scheduleStates[aId].pending[0].order-snapshot.controlState.scheduleStates[bId].pending[0].order);
    if (!candidates.length) return false;
    const incidents=[...new Set(candidates.map(([,stored])=>stored.value.incidentId))].sort();
    const selected=last?(incidents.find(id=>id>last) ?? incidents[0]):candidates[0][1].value.incidentId;
    const [id,stored]=candidates.find(([,item])=>item.value.incidentId===selected),state=snapshot.controlState.scheduleStates[id],occurrence=state.pending[0],origin=snapshot.controlState.scheduleOrigins[id];
    try {
      const { access,rule }=this.admit(snapshot,stored.value,origin.principalId,origin.grant);
      const evaluated=k.evaluateReaction(snapshot,{ contextId,rule:stored.value.rule,incidentId:stored.value.incidentId,eventIds:occurrence.eventIds.length?occurrence.eventIds:[occurrence.id] },origin.principalId,access,{ 'occurrence.id':occurrence.id,'occurrence.eventIds':occurrence.eventIds,'schedule.id':id });
      const complete=this.completion(id,occurrence,rule);
      if (!evaluated.eligible) {
        const batch={ controlChanges:[],outbox:[],events:[] };complete(batch,snapshot);this.internal(snapshot,batch.controlChanges,batch.events,'ineligible');return true;
      }
      const candidate=evaluated.candidateInput;
      if (candidate.contextId!==contextId) fail('FORBIDDEN','Scheduled operation cannot change context');
      const input={ ...candidate,expectedRevision:snapshot.context.revision,idempotencyKey:'schedule:'+occurrence.id };
      const result=k.call(rule.operation,input,origin.principalId,origin.grant,{ complete,causeIds:[occurrence.id,...occurrence.eventIds] });
      if (!result.ok) fail(result.error.code,result.error.message,result.error.retry);
    } catch(error) {
      if (!(error instanceof DomainError)) throw error;
      if (error.code==='REVISION_CONFLICT') return true;
      const current=k.store.read(contextId),next=structuredClone(current.controlState.scheduleStates[id]);this.markFault(current,id,next,error);
      this.internal(current,[{ namespace:'scheduleStates',key:id,value:next }],[{ ...this.event(contextId,id,'waiting',[occurrence.id]),payload:{ fault:next.lastFault } }],'fault');
    }
    return true;
  }
  advance(contextId,budget=8) {
    this.scan(contextId);
    for (let count=0;count<budget;count++) { if (!this.runOne(contextId)) break;this.scan(contextId); }
    return this.ready(contextId);
  }
  ready(contextId) {
    const snapshot=this.k.store.read(contextId),activity=this.k.store.sequence(contextId,true);
    return Object.values(snapshot.controlState.scheduleStates ?? {}).some(state=>state.state==='active' && state.blockedActivity!==activity && (state.lastSeq<activity || (state.pending.length && !state.activeExecutionIds.length)));
  }
  nextDelay() {
    let delay=Infinity;
    for (const id of this.k.store.contextIds()) {
      const snapshot=this.k.store.read(id),activity=this.k.store.sequence(id,true);
      for (const state of Object.values(snapshot.controlState.scheduleStates ?? {})) if (state.state==='active' && !state.timerFired && state.due!==undefined && state.blockedActivity!==activity) delay=Math.min(delay,state.due-this.k.clock.wall());
    }
    return delay===Infinity?null:Math.max(0,delay);
  }
}
