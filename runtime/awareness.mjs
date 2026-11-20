import { canonical,digest,fail,DomainError } from './json.mjs';
import { sealCursor,openCursor } from './cursors.mjs';
import { promptSchema } from './builtins.mjs';
import * as core from './semantic-core.mjs';

/** Bounded mailboxes and deterministic prompts; neither invokes a model nor accepts work. */
export class Awareness {
  constructor(kernel) { this.k=kernel; }
  detail(snapshot,ref,access) {
    if (!access.canRead(ref)) fail('NOT_FOUND','Detail is not accessible');
    const stored=this.k.lookup(snapshot,ref);
    if(snapshot.controlState.guidanceSources?.[ref.id])this.k.guidance.source(snapshot,ref.id,access);
    if(snapshot.controlState.guidanceCaptures?.[ref.id])this.k.guidance.capture(snapshot,ref.id,access);
    const decision=core.awarenessDetail(stored,!!snapshot.controlState.messages?.[ref.id],!!snapshot.controlState.incidents?.[ref.id],access.canIncident(ref.id),access);
    const reason={DetailMailbox:'Use the recipient mailbox for message bodies',DetailRelation:'Relation detail is not accessible',DetailIncident:'Incident detail is not accessible',DetailDependencies:'Detail dependencies are not accessible'}[decision];
    if(reason)fail('NOT_FOUND',reason);
    return stored;
  }
  visible(snapshot,stored,principal,access) {
    if (!core.messageVisible(stored,principal,!!stored&&access.canIncident(stored.value.incidentId))) return false;
    try { this.incidentAccess(snapshot,principal,stored.value.incidentId,access.chain[0]?this.k.ref(snapshot.context.id,access.chain[0].id):undefined);for (const ref of stored.value.detailRefs) this.detail(snapshot,ref,access);return true; }
    catch(error) { if (!(error instanceof DomainError)) throw error;return false; }
  }
  incidentAccess(snapshot,principal,incidentId,grant) {
    if (!snapshot.controlState.incidents?.[incidentId]) fail('NOT_FOUND','Incident not found');
    return this.k.authorize(snapshot,'incident.get',principal,{ incidentId },grant);
  }
  recipient(snapshot,principal,incidentId) {
    const k=this.k;
    const candidates=core.recipientCandidates(snapshot,principal,k.ownerId);
    for (const grant of candidates) try {
      this.incidentAccess(snapshot,principal,incidentId,grant);
      k.authorize(snapshot,'messages.read',principal,{ incidentId },grant);return;
    } catch(error) { if (!(error instanceof DomainError)) throw error; }
    fail('NOT_FOUND','Recipient is not admitted to this incident mailbox');
  }
  prepare(snapshot,message,principal,access) {
    const k=this.k;k.ensureNewId(snapshot,message.id);
    const admission=core.messageAdmission(Object.keys(snapshot.controlState.messages??{}).length,Buffer.byteLength(message.summary),!!snapshot.controlState.incidents?.[message.incidentId],access.canIncident(message.incidentId),core.executionDeadline(message.expiresAt,k.clock.wall()));
    if(admission==='MessageRetention')fail('LIMIT_EXCEEDED','Context mailbox retention bound reached');
    if(admission==='MessageSummary')fail('LIMIT_EXCEEDED','Message summary exceeds 8 KiB');
    if(admission==='MessageIncident')fail('NOT_FOUND','Incident not found');
    if(admission==='MessageExpired')fail('INVALID_ARGUMENT','A new message must not already be expired');
    for (const ref of message.detailRefs) this.detail(snapshot,ref,access);
    this.recipient(snapshot,message.recipientId,message.incidentId);
    const parent=message.inReplyTo?snapshot.controlState.messages?.[message.inReplyTo]:undefined,reply=core.messageReply(message,principal,parent);
    if(reply==='ReplyRequired')fail('INVALID_ARGUMENT','A response must name its request');
    if(reply==='ReplyUnavailable')fail('NOT_FOUND','Reply request is not accessible to these participants');
    if(reply==='ReplyNeedsVisibility'&&!this.visible(snapshot,parent,principal,access))fail('NOT_FOUND','Reply request is not accessible to these participants');
    return k.stored(snapshot.context.id,message,core.counterNext(snapshot.context.revision,'Context revision'),principal);
  }
  message(snapshot,id,principal,access,grant) {
    const stored=snapshot.controlState.messages?.[id];
    if (!stored || !this.visible(snapshot,stored,principal,access)) fail('NOT_FOUND','Message is not accessible');
    this.incidentAccess(snapshot,principal,stored.value.incidentId,grant);return stored;
  }
  read(snapshot,current,input,principal,access,grant) {
    let offset=0;
    const scope={ scope:'messages.read',principalId:principal,authority:access.scopeKey,contextId:input.contextId,includeAcknowledged:input.includeAcknowledged };
    if (input.cursor) {
      const cursor=openCursor(input.cursor,this.k.cursorKey);
      if (Object.entries(scope).some(([key,value])=>cursor[key]!==value) || (input.atRevision!==undefined && input.atRevision!==cursor.revision) || !Number.isSafeInteger(cursor.offset) || cursor.offset<0) fail('INVALID_ARGUMENT','Cursor does not match mailbox');
      snapshot=this.k.store.read(input.contextId,cursor.revision);offset=cursor.offset;
    }
    const items=Object.values(snapshot.controlState.messages ?? {}).filter(stored=>{
      if (!core.messageSelected(input.includeAcknowledged,!!snapshot.controlState.messageAcks?.[stored.ref.id])) return false;
      try { this.message(current,stored.ref.id,principal,access,grant);return this.visible(snapshot,stored,principal,access); }
      catch(error) { if (!(error instanceof DomainError)) throw error;return false; }
    }).sort(core.messageCompare);
    return { items:items.slice(offset,offset+input.limit),snapshotRevision:snapshot.context.revision,...(offset+input.limit<items.length?{ nextCursor:sealCursor({ ...scope,revision:snapshot.context.revision,offset:offset+input.limit },this.k.cursorKey) }:{}) };
  }
  compose(snapshot,current,input,principal,access) {
    const k=this.k,template=this.detail(snapshot,input.template,access),present=this.detail(current,input.template,access);
    if (!core.promptTemplate(template,present,promptSchema)) fail('INVALID_ARGUMENT','Expected the installed prompt-template atom');
    const issuers=k.lookup(current,current.context.policy).value.authorityIssuers ?? [k.ownerId];
    const trusted=core.templateSupported(current.assertions,input.template,issuers,access);
    if (!trusted) fail('FORBIDDEN','Template instructions need current admitted issuer support');
    const { text,sourceSlots,optionalSlots=[] }=template.value.value;
    const markers=[...text.matchAll(/\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/g)].map(item=>item[1]);
    if (!core.promptSlots(input.sourceRefs.length,sourceSlots,optionalSlots,markers,text.replace(/\{\{[A-Za-z][A-Za-z0-9_]{0,63}\}\}/g,'').includes('{{'))) fail('INVALID_ARGUMENT','Template slots do not match the supplied bindings');
    const incident=snapshot.controlState.incidents?.[input.incidentId];
    if (!incident || !access.canIncident(input.incidentId)) fail('NOT_FOUND','Incident not found');
    for (const ref of incident.value.continuation) this.detail(current,ref,access);
    // Current authority is checked before rendering historical bytes or omitting optional detail.
    const sources=input.sourceRefs.map(ref=>{ this.detail(current,ref,access);return this.detail(snapshot,ref,access); });
    const output=k.schema(snapshot,input.outputSchema);if (!access.canRead(output.ref)) fail('NOT_FOUND','Output schema is not accessible');
    const policy=k.lookup(current,current.context.policy).value,limits={ ...policy.limits },envelopes=[current.context.limits,policy.limits,...access.chain.map(item=>item.limits)];
    for (const name of ['cpuMillis','memoryBytes','outputBytes','modelTokens','apiSpendMicrounits','concurrentExecutions']) limits[name]=core.resourceAvailable(envelopes.map(envelope=>({used:0,ceiling:envelope[name]})));
    for (const envelope of envelopes) if (envelope.deadline && !core.deadlineFits(limits.deadline,envelope.deadline)) limits.deadline=envelope.deadline;
    const omitted=new Set(),render=()=>canonical({ instructions:{ templateText:text },quotedEvidence:{ rendered:text.replace(/\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/g,(_,slot)=>omitted.has(slot)?'[omitted]':canonical(sources[sourceSlots.indexOf(slot)])) },context:{ incident,policy:current.context.policy,limits,grantActions:access.operator?null:access.chain[0].actions,authorityNotice:'Action names are a ceiling; every operation rechecks current policy, resources and incident scope.' },output:{ schema:input.outputSchema,document:output.value.document } });
    let content=render(),candidates=core.promptCandidates(sourceSlots,optionalSlots),complete=false;
    for(let step=0;step<=sourceSlots.length;step++) {
      const decision=core.promptStep(candidates,Buffer.byteLength(content),input.maximumInputBytes);
      if(decision.kind==='PromptFits'){complete=true;break;}
      if(decision.kind==='PromptRequired')fail('LIMIT_EXCEEDED','Required prompt exceeds its UTF-8 byte budget');
      omitted.add(decision.slot);candidates=decision.remaining;content=render();
    }
    if(!complete)fail('INTERNAL','Core prompt selection exceeded its declared slot bound');
    const artifact={ template:input.template,sourceRefs:input.sourceRefs,content,outputSchema:input.outputSchema,omittedRefs:sourceSlots.flatMap((slot,index)=>omitted.has(slot)?[input.sourceRefs[index]]:[]) };
    return { ...artifact,digest:digest(artifact) };
  }
}
