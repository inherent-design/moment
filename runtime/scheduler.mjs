import { randomUUID } from 'node:crypto';
import { canonical,digest,fail,DomainError } from './json.mjs';
import { boundLimits } from './authority.mjs';
import { inputSchemas } from './validation.mjs';
import { terminal } from './executions.mjs';
import * as core from './semantic-core.mjs';
const fault=error=>({ code:error.code,message:error.message,retry:error.retry,details:null });

/** Durable trigger bookkeeping grants no authority to the resulting operation. */
export class Scheduler {
  constructor(kernel) { this.k=kernel; }
  canRead(snapshot,id,principal,access) {
    const stored=snapshot.controlState.schedules?.[id],origin=snapshot.controlState.scheduleOrigins?.[id];
    return core.scheduleVisible(stored,origin,principal,access);
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
    if (core.scheduleNeedsEvents(schedule.wake.kind)) k.authorize(snapshot,'events.read',principal,{ incidentId:schedule.incidentId },grant);
    k.local(schedule.rule,snapshot.context.id);
    const stored=snapshot.controlState.rules?.[schedule.rule.id];
    if (!stored || !access.canRead(stored.ref)) fail('NOT_FOUND','Scheduled rule is inaccessible');
    if (!core.scheduleMutation(inputSchemas[stored.value.operation]?.required)) fail('INVALID_ARGUMENT','A schedule requires an installed context mutation');
    boundLimits(stored.value.limits,snapshot.context.limits);boundLimits(stored.value.limits,k.lookup(snapshot,snapshot.context.policy).value.limits);
    for (const item of access.chain) boundLimits(stored.value.limits,item.limits);
    return { access,rule:stored.value };
  }
  due(snapshot,schedule,principal,access) {
    if (schedule.wake.kind==='at') return Date.parse(schedule.wake.instant);
    if (schedule.wake.kind!=='after') return undefined;
    const event=this.k.store.event(snapshot.context.id,schedule.wake.eventId);
    if (!event || !this.k.events.visible(snapshot,event,principal,access)) fail('NOT_FOUND','Temporal anchor event is inaccessible');
    return core.calendarAfter(Date.parse(event.recordedAt),schedule.wake.durationMillis);
  }
  selected(snapshot,selector,principal,access,event) {
    const ids=core.scheduleSelection(selector.ids,event?.subjectRefs.map(ref=>ref.id));
    const restricted=ids===undefined?selector:{...selector,ids};
    return this.k.query(snapshot,{ contextId:snapshot.context.id,selector:restricted,limit:1 },principal,access).items.length>0;
  }
  prepare(snapshot,schedule,principal,access,grant) {
    this.k.ensureNewId(snapshot,schedule.id);
    if (!core.scheduleRoom(Object.keys(snapshot.controlState.schedules ?? {}).length)) fail('LIMIT_EXCEEDED','Schedule retention capacity reached');
    const incident=snapshot.controlState.incidents?.[schedule.incidentId];
    if (!incident || !access.canIncident(schedule.incidentId) || core.incidentTerminal(incident.value.status)) fail('NOT_FOUND','Incident is not accepting schedules');
    this.admit(snapshot,schedule,principal,grant);
    const admission=core.scheduleWakeAdmission(schedule);
    if (admission==='SchTimerRearm') fail('INVALID_ARGUMENT','A timer needs a new anchor after completion');
    if (admission==='SchUnknownResource') fail('INVALID_ARGUMENT','Unknown capacity resource');
    const due=this.due(snapshot,schedule,principal,access),sequence=this.k.store.sequence(snapshot.context.id,true);
    return { stored:this.k.stored(snapshot.context.id,schedule,snapshot.context.revision+1,principal),origin:{ principalId:principal,...(grant?{ grant }:{}) },state:{ state:'active',lastSeq:sequence,pending:[],activeExecutionIds:[],edge:core.scheduleBaseline(schedule.wake)?this.selected(snapshot,schedule.wake.selector,principal,access):false,timerFired:false,blockedActivity:-1,...(due!==undefined?{ due }:{}) } };
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
    return core.scheduleDepends(event,id=>this.k.store.event(contextId,id),contextId,this.k.ref(contextId,scheduleId));
  }
  available(snapshot,resource,access) {
    if (core.resourceBlocked(Object.values(snapshot.controlState.executions??{}).map(item=>item.value))) return 0;
    const envelopes=[[undefined,snapshot.context.limits],[undefined,this.k.lookup(snapshot,snapshot.context.policy).value.limits],...access.chain.map(grant=>[grant.id,grant.limits])];
    return core.resourceAvailable(envelopes.map(([id,limits])=>({ceiling:limits[resource],used:this.k.executions.totals(snapshot,id)[resource]})));
  }
  enqueue(snapshot,id,state,eventIds,events) {
    const next=core.scheduleQueue(state,snapshot.controlState.schedules[id].value.coalesce,eventIds);
    if(next.kind==='SchQueueFull')return false;
    if(next.kind==='SchMerge'){state.pending.at(-1).eventIds=next.sources;return true;}
    const order=core.scheduleOrder(this.k.store.sequence(snapshot.context.id),events.length),event=this.event(snapshot.context.id,id,'triggered',next.sources);
    state.pending.push({id:event.id,eventIds:next.sources,order});events.push(event);return true;
  }
  markFault(snapshot,id,state,error) {
    state.lastFault=fault(error);state.blockedActivity=this.k.store.sequence(snapshot.context.id,true);
  }
  markFull(state,activity) {
    state.lastFault={code:'LIMIT_EXCEEDED',message:'Schedule pending capacity reached; source cursor retained',retry:'refresh',details:null};state.backpressureActivity=activity;
  }
  scan(contextId) {
    const k=this.k,snapshot=k.store.read(contextId),activity=k.store.sequence(contextId,true),changes=[],events=[];
    for (const [id,stored] of Object.entries(snapshot.controlState.schedules ?? {})) {
      const previous=snapshot.controlState.scheduleStates[id],incident=snapshot.controlState.incidents[stored.value.incidentId];
      const admission=core.scheduleScan(previous,snapshot.context.state,!!incident&&core.incidentTerminal(incident.value.status),activity);
      if(admission==='SchSkip')continue;
      const state=structuredClone(previous),schedule=stored.value,origin=snapshot.controlState.scheduleOrigins[id];
      if(admission==='SchCancel'){state.state='cancelled';state.pending=[];}
      else try {
        const { access }=this.admit(snapshot,schedule,origin.principalId,origin.grant);
        delete state.lastFault;delete state.backpressureActivity;state.blockedActivity=-1;
        state.activeExecutionIds=state.activeExecutionIds.filter(executionId=>!terminal(snapshot.controlState.executions[executionId].value.state));
        const mode=core.scheduleMode(schedule.wake,state,activity,core.observeClock(k.clock).wall);
        if(mode.$==='SchEvents'){
          for(const event of k.store.events(contextId,state.lastSeq,mode.limit)){
            const gate=core.scheduleEventGate(state,event,activity,schedule.wake.eventTypes);
            if(gate==='SchFutureEvent')break;if(gate==='SchStaleEvent')continue;
            let fired=false,nextEdge=state.edge;
            if(gate==='SchInspectEvent'&&k.events.visible(snapshot,event,origin.principalId,access)){
              const dependency=this.dependsOn(contextId,event,id);
              if (dependency==='unknown') fail('POLICY_INDETERMINATE','Causal ancestry is unresolved or exceeds its bound');
              if (!dependency) {
                const atEvent=k.store.read(contextId,event.revision);
                const selected=this.selected(atEvent,schedule.wake.selector,origin.principalId,access,schedule.wake.mode==='each'?event:undefined);
                const observed=core.scheduleObservation(schedule.wake.mode,state.edge,selected);fired=observed.fire;nextEdge=observed.edge;
              }
            }
            const enqueued=fired?this.enqueue(snapshot,id,state,[event.id],events):false;
            const next=core.scheduleAdvance(state,event.sequence,activity,nextEdge,fired,enqueued,schedule.recurrence);
            state.lastSeq=next.cursor;state.edge=next.edge;
            if(next.full)this.markFull(state,activity);if(next.stop)break;
          }
        }else if(mode.$==='SchTimer'){
          if (schedule.wake.kind==='after') this.due(snapshot,schedule,origin.principalId,access);
          const accepted=this.enqueue(snapshot,id,state,schedule.wake.kind==='after'?[schedule.wake.eventId]:[],events);
          if(accepted)state.timerFired=true;else this.markFull(state,activity);
        }else if(mode.$==='SchCheckCapacity'){
          const available=core.resourceLessOrEqual(schedule.wake.atLeast,this.available(snapshot,schedule.wake.resource,access));
          const observed=core.scheduleObservation('edge',state.edge,available),accepted=observed.fire?this.enqueue(snapshot,id,state,[],events):false;
          if(observed.fire&&!accepted)this.markFull(state,activity);
          state.edge=core.scheduleCapacityEdge(state.edge,available,accepted);
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
      if(!core.scheduleMatches(previous,occurrence.id))fail('REVISION_CONFLICT','Schedule occurrence changed','refresh');
      for(const intent of batch.outbox)boundLimits(intent.limits,rule.limits);
      if(!core.resourceEnvelope(batch.outbox.map(intent=>intent.limits),rule.limits))fail('FORBIDDEN','Requested budget exceeds its envelope');
      const schedule=snapshot.controlState.schedules[id].value;
      const state={...previous,state:core.scheduleCompleted(schedule.recurrence),pending:previous.pending.slice(1),activeExecutionIds:batch.outbox.map(intent=>intent.id),blockedActivity:-1};delete state.lastFault;delete state.backpressureActivity;
      batch.controlChanges.push({ namespace:'scheduleStates',key:id,value:state },{ namespace:'schedulerMetadata',key:'lastIncident',value:schedule.incidentId });
      batch.events.push(this.event(snapshot.context.id,id,'completed',[occurrence.id,...occurrence.eventIds]));
    };
  }
  runOne(contextId) {
    const k=this.k,snapshot=k.store.read(contextId),activity=k.store.sequence(contextId,true),last=snapshot.controlState.schedulerMetadata?.lastIncident;
    const selected=core.scheduleChoose(Object.entries(snapshot.controlState.schedules??{}),snapshot.controlState.scheduleStates??{},activity,last);
    if(!selected)return false;
    const [id,stored]=selected,state=snapshot.controlState.scheduleStates[id],occurrence=state.pending[0],origin=snapshot.controlState.scheduleOrigins[id];
    try {
      const { access,rule }=this.admit(snapshot,stored.value,origin.principalId,origin.grant);
      const evaluated=k.evaluateReaction(snapshot,{ contextId,rule:stored.value.rule,incidentId:stored.value.incidentId,eventIds:occurrence.eventIds.length?occurrence.eventIds:[occurrence.id] },origin.principalId,access,{ 'occurrence.id':occurrence.id,'occurrence.eventIds':occurrence.eventIds,'schedule.id':id });
      const complete=this.completion(id,occurrence,rule);
      if (!evaluated.eligible) {
        const batch={ controlChanges:[],outbox:[],events:[] };complete(batch,snapshot);this.internal(snapshot,batch.controlChanges,batch.events,'ineligible');return true;
      }
      const candidate=evaluated.candidateInput;
      if(!core.sameText(candidate.contextId,contextId))fail('FORBIDDEN','Scheduled operation cannot change context');
      const input={ ...candidate,expectedRevision:snapshot.context.revision,idempotencyKey:'schedule:'+occurrence.id };
      const result=k.call(rule.operation,input,origin.principalId,origin.grant,{ complete,causeIds:[occurrence.id,...occurrence.eventIds] });
      if (!result.ok) fail(result.error.code,result.error.message,result.error.retry);
    } catch(error) {
      if (!(error instanceof DomainError)) throw error;
      if(core.scheduleRetryFault(error.code))return true;
      const current=k.store.read(contextId),previous=current.controlState.scheduleStates[id];
      if(core.mutationBasis(current.context.revision,snapshot.context.revision,current.context.state,'schedule.put')!=='MutationAllowed')return true;
      if(!previous||!core.scheduleMatches(previous,occurrence.id))return true;
      const next=structuredClone(previous);this.markFault(current,id,next,error);
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
    return Object.entries(snapshot.controlState.scheduleStates??{}).some(([id,state])=>core.scheduleReady(state,activity,snapshot.controlState.schedules[id].value.coalesce));
  }
  nextDelay() {
    const now=core.observeClock(this.k.clock).wall,delays=[];
    for (const id of this.k.store.contextIds()) {
      const snapshot=this.k.store.read(id),activity=this.k.store.sequence(id,true);
      for(const state of Object.values(snapshot.controlState.scheduleStates??{}))if(core.scheduleWatch(state,activity))delays.push(state.due-now);
    }
    return core.timeDelay(delays);
  }
}
