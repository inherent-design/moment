import { randomUUID } from 'node:crypto';
import { canonical, fail, DomainError } from './json.mjs';
import { sealCursor,openCursor } from './cursors.mjs';
import * as core from './semantic-core.mjs';

/** Private visibility requirements are stored with the event, never returned on the wire. */
export function mutationEvents(kernel,method,input,snapshot,batch,firstId,causeIds=[]) {
  const grouped=new Map();
  const add=(ref,requirements=[])=>{
    if (!ref) return;
    if (!grouped.has(ref.id)) grouped.set(ref.id,{ ref,alternatives:new Map() });
    const required=[...new Map([ref,...requirements].map(item=>[canonical(item),item])).values()];
    grouped.get(ref.id).alternatives.set(canonical(required),required);
  };
  for (const change of batch.changes) {
    if (change.kind==='record.put') add(kernel.ref(input.contextId,change.record.id),change.record.kind==='relation'?Object.values(change.record.roles).flat():[]);
    else {
      const assertion=change.kind==='assertion.put'?change.assertion:snapshot.assertions.find(item=>item.assertion.value.id===change.assertionId)?.assertion.value;
      if (assertion) add(assertion.record,assertion.evidence.sources);
    }
  }
  for (const change of batch.controlChanges) if (change.value?.ref) add(change.value.ref);
  if (method==='grant.revoke') add(input.grant);
  if (input.scheduleId) add(snapshot.controlState.schedules?.[input.scheduleId]?.ref);
  for (const id of input.messageIds ?? []) add(snapshot.controlState.messages?.[id]?.ref);
  if (!grouped.size) add(kernel.ref(input.contextId,input.contextId));
  return [...grouped.values()].map((item,index)=>({ id:index===0?firstId:randomUUID(),contextId:input.contextId,type:method+'.committed',subjectRefs:[item.ref],visibilityAlternatives:[...item.alternatives.values()],causeIds,payload:null }));
}

export class Events {
  constructor(kernel) { this.k=kernel; }
  canRef(snapshot,ref,principal,access) {
    const route=core.eventRefRoute(core.sameScope(ref,{systemId:snapshot.context.systemId,contextId:snapshot.context.id}),!!snapshot.controlState.messages?.[ref.id],access.canRead(ref),!!snapshot.controlState.incidents?.[ref.id],!!snapshot.controlState.executions?.[ref.id],!!snapshot.controlState.schedules?.[ref.id]&&!!this.k.scheduler);
    if(route==='RefMailbox')return this.k.awareness.visible(snapshot,snapshot.controlState.messages[ref.id],principal,access);
    if(route==='RefAllowed')return true;
    if(route==='RefIncident')return access.canIncident(ref.id);
    if(route==='RefExecution') {
      try { this.k.executions.get(snapshot,ref.id,principal,access);return true; }
      catch (error) { if (!(error instanceof DomainError)) throw error;return false; }
    }
    if(route==='RefSchedule')return this.k.scheduler.canRead(snapshot,ref.id,principal,access);
    return false;
  }
  visible(snapshot,event,principal,access) {
    return core.eventVisible(access.operator,event,snapshot.context.id,id=>this.k.store.event(snapshot.context.id,id),ref=>this.canRef(snapshot,ref,principal,access));
  }
  public(event) {
    const { visibilityRefs,visibilityAlternatives,...result }=event;return result;
  }
  read(snapshot,input,principal,access) {
    let sequence=0;
    const scope={ scope:'events.read',principalId:principal,authority:access.scopeKey,contextId:input.contextId,ceiling:input.atRevision ?? null };
    if (input.after) {
      const cursor=openCursor(input.after,this.k.cursorKey);
      if (Object.entries(scope).some(([key,value])=>cursor[key]!==value) || !Number.isSafeInteger(cursor.sequence) || cursor.sequence<0) fail('INVALID_ARGUMENT','Event cursor does not match its authority or read scope');
      sequence=cursor.sequence;
    }
    const items=[];let scanned=0,atEnd=false;
    for (;;) {
      const requested=core.eventScanRequest(items.length,input.limit,scanned);if(!requested)break;
      const events=this.k.store.events(input.contextId,sequence,requested);
      if (!events.length) { atEnd=true;break; }
      for (const event of events) {
        if (core.reactionSource(event,snapshot.context.revision)==='ReactionSourceMissing') { atEnd=true;break; }
        sequence=event.sequence;scanned++;
        if (this.visible(snapshot,event,principal,access)) items.push(this.public(event));
        if (items.length===input.limit) break;
      }
      if (atEnd) break;
    }
    return { items,snapshotRevision:snapshot.context.revision,nextCursor:sealCursor({ ...scope,sequence },this.k.cursorKey) };
  }
  async wait(input,principal,grant,signal) {
    const initial=this.k.call('events.read',input,principal,grant);
    if (!initial.ok || initial.value.items.length || input.waitMillis===0) return initial;
    let next={ ...input,waitMillis:0 };const deadline=performance.now()+input.waitMillis;
    for (let round=0;round<64;round++) {
      let changed,abort,timer;
      const notification=new Promise(resolve=>{
        changed=event=>{ if (event.contextId===input.contextId) resolve(); };
        abort=()=>resolve();
        this.k.store.notifications.on('commit',changed);
        signal?.addEventListener('abort',abort,{ once:true });
        timer=setTimeout(resolve,Math.max(0,deadline-performance.now()));
      });
      try {
        if (signal?.aborted) fail('OUTCOME_UNKNOWN','Event wait was cancelled','same_request');
        const result=this.k.call('events.read',next,principal,grant);
        if (!result.ok || result.value.items.length || performance.now()>=deadline || input.waitMillis===0 || input.atRevision!==undefined) return result;
        next={ ...next,after:result.value.nextCursor };
        const cursor=openCursor(next.after,this.k.cursorKey);
        if (cursor.sequence<this.k.store.sequence(input.contextId)) continue;
        await notification;
      } finally {
        clearTimeout(timer);this.k.store.notifications.off('commit',changed);signal?.removeEventListener('abort',abort);
      }
    }
    return this.k.call('events.read',next,principal,grant);
  }
}
