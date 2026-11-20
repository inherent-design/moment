import { canonical,digest,fail,DomainError } from './json.mjs';
import { sealCursor,openCursor } from './cursors.mjs';
import { sameRef } from './authority.mjs';
import { promptSchema } from './builtins.mjs';

/** Bounded mailboxes and deterministic prompts; neither invokes a model nor accepts work. */
export class Awareness {
  constructor(kernel) { this.k=kernel; }
  detail(snapshot,ref,access) {
    if (!access.canRead(ref)) fail('NOT_FOUND','Detail is not accessible');
    const stored=this.k.lookup(snapshot,ref);
    if(snapshot.controlState.guidanceSources?.[ref.id])this.k.guidance.source(snapshot,ref.id,access);
    if(snapshot.controlState.guidanceCaptures?.[ref.id])this.k.guidance.capture(snapshot,ref.id,access);
    // Message bodies have their own recipient boundary. Internal runtime state is never a prompt source.
    if (snapshot.controlState.messages?.[ref.id]) fail('NOT_FOUND','Use the recipient mailbox for message bodies');
    if (stored.value.kind==='relation' && Object.values(stored.value.roles).flat().some(item=>!access.canRead(item))) fail('NOT_FOUND','Relation detail is not accessible');
    if (snapshot.controlState.incidents?.[ref.id] && !access.canIncident(ref.id)) fail('NOT_FOUND','Incident detail is not accessible');
    for (const source of [...(stored.evidence?.sources ?? []),...(stored.value.evidence?.sources ?? []),...(stored.value.continuation ?? [])]) if (!access.canRead(source)) fail('NOT_FOUND','Detail dependencies are not accessible');
    return stored;
  }
  visible(snapshot,stored,principal,access) {
    if (stored.value.recipientId!==principal || !access.canIncident(stored.value.incidentId)) return false;
    try { this.incidentAccess(snapshot,principal,stored.value.incidentId,access.chain[0]?this.k.ref(snapshot.context.id,access.chain[0].id):undefined);for (const ref of stored.value.detailRefs) this.detail(snapshot,ref,access);return true; }
    catch(error) { if (!(error instanceof DomainError)) throw error;return false; }
  }
  incidentAccess(snapshot,principal,incidentId,grant) {
    if (!snapshot.controlState.incidents?.[incidentId]) fail('NOT_FOUND','Incident not found');
    return this.k.authorize(snapshot,'incident.get',principal,{ incidentId },grant);
  }
  recipient(snapshot,principal,incidentId) {
    const k=this.k;
    const candidates=principal===k.ownerId?[undefined]:Object.values(snapshot.controlState.grants ?? {}).filter(item=>item.value.principalId===principal).map(item=>item.ref);
    if (candidates.length>4096) fail('LIMIT_EXCEEDED','Recipient grant lookup exceeds its bound');
    for (const grant of candidates) try {
      this.incidentAccess(snapshot,principal,incidentId,grant);
      k.authorize(snapshot,'messages.read',principal,{ incidentId },grant);return;
    } catch(error) { if (!(error instanceof DomainError)) throw error; }
    fail('NOT_FOUND','Recipient is not admitted to this incident mailbox');
  }
  prepare(snapshot,message,principal,access) {
    const k=this.k;k.ensureNewId(snapshot,message.id);
    if (Object.keys(snapshot.controlState.messages ?? {}).length>=4096) fail('LIMIT_EXCEEDED','Context mailbox retention bound reached');
    if (Buffer.byteLength(message.summary)>8192) fail('LIMIT_EXCEEDED','Message summary exceeds 8 KiB');
    if (!snapshot.controlState.incidents?.[message.incidentId] || !access.canIncident(message.incidentId)) fail('NOT_FOUND','Incident not found');
    if (message.expiresAt && Date.parse(message.expiresAt)<=k.clock.wall()) fail('INVALID_ARGUMENT','A new message must not already be expired');
    for (const ref of message.detailRefs) this.detail(snapshot,ref,access);
    this.recipient(snapshot,message.recipientId,message.incidentId);
    if (message.kind==='response' && !message.inReplyTo) fail('INVALID_ARGUMENT','A response must name its request');
    if (message.inReplyTo) {
      const parent=snapshot.controlState.messages?.[message.inReplyTo];
      if (!parent || parent.value.kind!=='request' || parent.value.incidentId!==message.incidentId || parent.value.recipientId!==principal || parent.recordedBy!==message.recipientId || !this.visible(snapshot,parent,principal,access)) fail('NOT_FOUND','Reply request is not accessible to these participants');
    }
    return k.stored(snapshot.context.id,message,snapshot.context.revision+1,principal);
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
      if (!input.includeAcknowledged && snapshot.controlState.messageAcks?.[stored.ref.id]) return false;
      try { this.message(current,stored.ref.id,principal,access,grant);return this.visible(snapshot,stored,principal,access); }
      catch(error) { if (!(error instanceof DomainError)) throw error;return false; }
    }).sort((a,b)=>a.revision-b.revision || a.ref.id.localeCompare(b.ref.id));
    return { items:items.slice(offset,offset+input.limit),snapshotRevision:snapshot.context.revision,...(offset+input.limit<items.length?{ nextCursor:sealCursor({ ...scope,revision:snapshot.context.revision,offset:offset+input.limit },this.k.cursorKey) }:{}) };
  }
  compose(snapshot,current,input,principal,access) {
    const k=this.k,template=this.detail(snapshot,input.template,access),present=this.detail(current,input.template,access);
    if (template.value.kind!=='atom' || !sameRef(template.ref,present.ref) || canonical(template.value.schema)!==canonical(promptSchema)) fail('INVALID_ARGUMENT','Expected the installed prompt-template atom');
    const issuers=k.lookup(current,current.context.policy).value.authorityIssuers ?? [k.ownerId];
    const trusted=current.assertions.some(item=>item.status==='asserted' && item.assertion.value.record.id===input.template.id && issuers.includes(item.assertion.recordedBy) && item.assertion.value.evidence.sources.every(access.canRead));
    if (!trusted) fail('FORBIDDEN','Template instructions need current admitted issuer support');
    const { text,sourceSlots,optionalSlots=[] }=template.value.value;
    const markers=[...text.matchAll(/\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/g)].map(item=>item[1]);
    if (input.sourceRefs.length!==sourceSlots.length || optionalSlots.some(slot=>!sourceSlots.includes(slot)) || markers.some(slot=>!sourceSlots.includes(slot)) || sourceSlots.some(slot=>!markers.includes(slot)) || text.replace(/\{\{[A-Za-z][A-Za-z0-9_]{0,63}\}\}/g,'').includes('{{')) fail('INVALID_ARGUMENT','Template slots do not match the supplied bindings');
    const incident=snapshot.controlState.incidents?.[input.incidentId];
    if (!incident || !access.canIncident(input.incidentId)) fail('NOT_FOUND','Incident not found');
    for (const ref of incident.value.continuation) this.detail(current,ref,access);
    // Current authority is checked before rendering historical bytes or omitting optional detail.
    const sources=input.sourceRefs.map(ref=>{ this.detail(current,ref,access);return this.detail(snapshot,ref,access); });
    const output=k.schema(snapshot,input.outputSchema);if (!access.canRead(output.ref)) fail('NOT_FOUND','Output schema is not accessible');
    const policy=k.lookup(current,current.context.policy).value,limits={ ...policy.limits };
    for (const grant of access.chain) for (const name of ['cpuMillis','memoryBytes','outputBytes','modelTokens','apiSpendMicrounits','concurrentExecutions']) limits[name]=Math.min(limits[name],grant.limits[name]);
    for (const envelope of [current.context.limits,...access.chain.map(item=>item.limits)]) if (envelope.deadline && (!limits.deadline || Date.parse(envelope.deadline)<Date.parse(limits.deadline))) limits.deadline=envelope.deadline;
    const omitted=new Set(),render=()=>canonical({ instructions:{ templateText:text },quotedEvidence:{ rendered:text.replace(/\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/g,(_,slot)=>omitted.has(slot)?'[omitted]':canonical(sources[sourceSlots.indexOf(slot)])) },context:{ incident,policy:current.context.policy,limits,grantActions:access.operator?null:access.chain[0].actions,authorityNotice:'Action names are a ceiling; every operation rechecks current policy, resources and incident scope.' },output:{ schema:input.outputSchema,document:output.value.document } });
    let content=render();
    for (const slot of [...sourceSlots].reverse()) if (Buffer.byteLength(content)>input.maximumInputBytes && optionalSlots.includes(slot)) { omitted.add(slot);content=render(); }
    if (Buffer.byteLength(content)>input.maximumInputBytes) fail('LIMIT_EXCEEDED','Required prompt exceeds its UTF-8 byte budget');
    const artifact={ template:input.template,sourceRefs:input.sourceRefs,content,outputSchema:input.outputSchema,omittedRefs:sourceSlots.flatMap((slot,index)=>omitted.has(slot)?[input.sourceRefs[index]]:[]) };
    return { ...artifact,digest:digest(artifact) };
  }
}
