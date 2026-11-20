import { sealCursor, openCursor } from './cursors.mjs';
import { randomUUID } from 'node:crypto';
import packageMetadata from '../package.json' with {type:'json'};
import { canonical, digest, fail, DomainError, resultError } from './json.mjs';
import { validateInput, compileDocument } from './validation.mjs';
import { boundLimits, attenuates, grantChain, limitedPolicy, sameRef, includesRef } from './authority.mjs';
import { builtinSchemas, installedSchema, validateTopology } from './builtins.mjs';
import { applyGraph } from './graph.mjs';
import { select, tokens, bindInput } from './pointers.mjs';
import { evaluate, evaluatePolicy } from './conditions.mjs';
import { Executions, executionMethods, zeroUsage } from './executions.mjs';
import { Events,mutationEvents } from './events.mjs';
import { Scheduler } from './scheduler.mjs';
import { Awareness } from './awareness.mjs';
import { Guidance } from './guidance.mjs';
import * as core from './semantic-core.mjs';

import { kernelMethods as methods } from './operations.mjs';

const bootstrapActions = [...methods];
const equal = (a,b) => canonical(a) === canonical(b);
const ok = value => ({ ok: true, value });

/** In-process API. principalId must come from an authenticated transport binding. */
export class Kernel {
  constructor(store, { ownerId, cursorKey, clock, catalog, instanceId,guidance }) {
    if (!ownerId || !cursorKey || Buffer.byteLength(cursorKey) < 32) throw new Error('An operator identity and cursor encryption key are required');
    this.store = store;
    this.catalog=catalog;this.instanceId=instanceId;
    this.ownerId = ownerId;
    this.cursorKey = cursorKey;
    this.schemaValidators = new Map();
    this.clock=clock ?? { wall:()=>Date.now(),monotonic:()=>performance.now(),bootId:randomUUID() };
    this.executions=new Executions(this);
    this.events=new Events(this);
    this.scheduler=new Scheduler(this);
    this.awareness=new Awareness(this);
    this.guidance=new Guidance(this,guidance);
  }
  ref(contextId, id) { return { systemId: this.store.systemId, contextId, id }; }
  stored(contextId, value, revision, principalId, id=value.id) {
    return { value, ref: this.ref(contextId, id), digest: digest(value), revision, recordedAt: new Date().toISOString(), recordedBy: principalId };
  }
  local(ref, contextId) {
    if (ref.systemId !== this.store.systemId || ref.contextId !== contextId) fail('NOT_FOUND', 'Reference is not in this context');
  }
  lookup(snapshot, ref) {
    this.local(ref, snapshot.context.id);
    const values = Object.values(snapshot.controlState).flatMap(namespace => namespace && typeof namespace === 'object' ? Object.values(namespace) : []);
    const found = snapshot.records.find(item => item.value.id === ref.id) ?? snapshot.assertions.find(item=>item.assertion.ref.id===ref.id)?.assertion ?? values.find(item => item?.ref?.id === ref.id);
    if (!found) fail('NOT_FOUND', 'Referenced object not found');
    return found;
  }
  ensureNewId(snapshot,id) {
    if (id===snapshot.context.id || snapshot.assertions.some(item=>item.assertion.ref.id===id) || snapshot.records.some(item=>item.ref.id===id) || Object.values(snapshot.controlState).some(namespace=>namespace && typeof namespace==='object' && Object.values(namespace).some(item=>item?.ref?.id===id))) fail('IDENTITY_CONFLICT','Object identity already used');
  }
  admission(snapshot, principalId, boundGrant) {
    const operator = core.isOperator(principalId,this.ownerId,snapshot.controlState.owners?.principalId,boundGrant);
    const chain = operator ? [] : grantChain(snapshot, boundGrant, principalId,this.clock.wall());
    return {operator,chain,scopeKey:operator?'operator':digest(chain.map(grant=>grant.id)),...core.accessScopes(operator,chain)};
  }
  policyQueries(snapshot, access, principalId) {
    const issuers=this.lookup(snapshot,snapshot.context.policy).value.authorityIssuers ?? [snapshot.controlState.owners.principalId];
    const projection=core.policyQueryProjection(snapshot,issuers);
    if(!projection)return {exists:()=> 'unknown',related:()=> 'unknown'};
    let queryBudget=projection.budget;
    const assertions=projection.indices.map(index=>snapshot.assertions[index]);
    const activeSupported=new Set(assertions.filter(item=>core.policyQuerySupported(item.status,item.assertion.value.evidence.sources,access)).map(item=>item.assertion.value.record.id));
    const ids=new Set(projection.records),trusted={...snapshot,assertions,records:snapshot.records.filter(item=>ids.has(item.ref.id))};
    const exists=selector=>{
      queryBudget=core.policyQueryExistsBudget(queryBudget,trusted,projection.provenance,selector.relatedTo!==undefined);
      if(!core.policyQueryAvailable(queryBudget))return 'unknown';
      if(selector.relatedTo && core.policyQueryEndpoint(snapshot.context,selector.relatedTo,access)===undefined)return 'unknown';
      const result=this.query(trusted,{contextId:snapshot.context.id,selector,limit:1},principalId,access);
      return core.policyQueryObserved(result.items.length>0,access.operator);
    };
    const related=(from,to,names,maxHops)=>{
      const start=core.policyQueryEndpoint(snapshot.context,from,access),end=core.policyQueryEndpoint(snapshot.context,to,access);
      if(start===undefined||end===undefined)return 'unknown';
      queryBudget=core.policyQueryCharge(queryBudget,[trusted.records.length,names.length]);
      if(!core.policyQueryAvailable(queryBudget))return 'unknown';
      const result=core.policyQueryRelated(queryBudget,trusted.records,activeSupported,names,start,end,maxHops,access);queryBudget=result.budget;return result.value;
    };
    return {exists,related};
  }
  authorize(snapshot, method, principalId, input, boundGrant) {
    const access = this.admission(snapshot, principalId, boundGrant);
    const methodAdmission=access.method(method,this.ref(snapshot.context.id,snapshot.context.id));
    const refusal={MethodOutsideGrant:'Action is outside delegated authority',MethodSchemaOperator:'Schema admission requires operator authority',MethodLimitsOperator:'Context resource ceilings require the authenticated local operator',MethodContextWide:'Operation requires context-wide delegation'}[methodAdmission];
    if(refusal)fail('FORBIDDEN',refusal);
    const incidentId=(method==='incident.create'?input.id:undefined) ?? input.incidentId ?? input.message?.incidentId ?? input.schedule?.incidentId ?? snapshot.controlState.schedules?.[input.scheduleId]?.value.incidentId ?? input.execution?.incidentId ?? input.proposal?.incidentId ?? snapshot.controlState.transitions?.[input.proposalId]?.value.proposal.incidentId ?? snapshot.controlState.executions?.[input.executionId]?.value.intent.incidentId;
    if (incidentId && !access.canIncident(incidentId)) fail('NOT_FOUND', 'Incident is not accessible');
    const resources=input.resourceRefs ?? (input.changes ?? []).map(change=>change.kind==='record.put'?this.ref(snapshot.context.id,change.record.id):change.kind==='assertion.put'?change.assertion.record:snapshot.assertions.find(item=>item.assertion.value.id===change.assertionId)?.assertion.value.record).filter(Boolean);
    if (method!=='policy.evaluate' && resources.some(ref=>!access.canRead(ref))) fail('FORBIDDEN','Resources are outside delegated authority');
    const policy = this.lookup(snapshot, snapshot.context.policy).value;
    const decision = evaluatePolicy(policy, method, { ...this.policyQueries(snapshot,access,principalId),bindings: { principalId, incidentId: incidentId ?? null, action: method, resourceRefs: resources,contextId:snapshot.context.id, contextRevision: snapshot.context.revision, now: new Date(this.clock.wall()).toISOString() } });
    if (decision !== 'permit') fail(decision === 'indeterminate' ? 'POLICY_INDETERMINATE' : 'FORBIDDEN', 'Current policy does not admit this operation');
    return access;
  }
  call(method, input, principalId, boundGrant, scheduled) {
    try {
      if (!principalId) fail('UNAUTHENTICATED', 'Authenticated principal required');
      if (!methods.includes(method)) fail('INVALID_ARGUMENT', 'Method is not implemented');
      validateInput(method, input);
      if (method === 'system.describe') return ok({ systemId: this.store.systemId, protocolVersion: '0.1', methods: [...methods], implementationVersion: packageMetadata.version, ...(this.catalog?{catalog:this.catalog}:{}), ...(this.instanceId?{instanceId:this.instanceId}:{}) });
      if (method === 'context.create') return this.create(input, principalId);
      if (principalId!==this.ownerId && !boundGrant) fail('NOT_FOUND','Context is not accessible');
      this.executions.maintain(input.contextId);
      const current = this.store.read(input.contextId);
      const access = this.authorize(current, method, principalId, input, boundGrant);
      if(method.startsWith('guidance.'))this.guidance.requestAccess(current,method,input,access);
      if(method==='guidance.review') {
        if(!access.operator && !sameRef(input.grant,boundGrant))fail('FORBIDDEN','Guidance assessment requires the selected bound grant');
        if(!access.canRead(input.capability))fail('NOT_FOUND','Guidance capability is inaccessible');
        const scope={incidentId:input.incidentId,resourceRefs:[input.capability]};
        this.authorize(current,'execution.request',principalId,scope,boundGrant);
        this.authorize(current,this.executions.capability(current,input.capability).value.name,principalId,scope,input.grant);
      }
      if(input.executionId && current.controlState.executions?.[input.executionId]?.value.intent.input?.profile==='moment-guidance/1')this.executions.get(current,input.executionId,principalId,access);
      if (method==='context.limits') this.executions.evidence(current,input.evidence,access,true);
      if (method==='incident.create' || method==='incident.update') {
        if ([...input.incident.continuation,...(input.evidence?.sources ?? [])].some(ref=>!access.canRead(ref))) fail('NOT_FOUND','Incident dependencies are not accessible');
        // Recheck both authorities before receipt replay as well as first admission.
        if (method==='incident.create' && input.incident.status!=='open') this.authorize(current,'incident.update',principalId,{...input,incidentId:input.id},boundGrant);
      }
      const snapshot = input.atRevision === undefined ? current : this.store.read(input.contextId, input.atRevision);
      const mutation = Object.hasOwn(input, 'expectedRevision');
      if (mutation) {
        const receipt = this.store.receipt(principalId, input.contextId, method, input.idempotencyKey, digest(input));
        if (receipt) {
          if(receipt.response.intent?.input?.profile==='moment-guidance/1')this.guidance.inputAccess(current,receipt.response.intent.input,access);
          return ok(receipt.response.kind === 'commit-receipt' ? receipt.commit : receipt.response);
        }
        const basis=core.mutationBasis(current.context.revision,input.expectedRevision,current.context.state,method);
        if(basis==='MutationStale')fail('REVISION_CONFLICT','Context changed since observation','refresh');
        if(basis==='MutationClosed')fail('FORBIDDEN','Context is closed');
      }
      const commitEventId=randomUUID();
      const batch = { mutation: input, principalId, requestDigest: digest(input), changes: [], controlChanges: [], events: [], outbox: [], response: { kind: 'commit-receipt' } };
      const revision = current.context.revision + 1;
      const control = (namespace, key, value) => batch.controlChanges.push({ namespace, key, value });
      switch (method) {
        case 'guidance.register': batch.response=this.guidance.register(current,input,principalId,access,control);break;
        case 'guidance.refresh': batch.response=this.guidance.refresh(current,input,principalId,access,control);break;
        case 'guidance.read': return ok(this.guidance.read(current,input,principalId,access));
        case 'guidance.review': {
          const execution=this.guidance.review(current,input,principalId,access);
          this.authorize(current,'execution.request',principalId,{incidentId:input.incidentId,resourceRefs:[input.capability]},boundGrant);
          const prepared=this.executions.prepare(current,execution,principalId,access);
          control('executions',execution.id,this.stored(input.contextId,prepared.execution,revision,principalId,execution.id));
          control('executionOrigins',execution.id,prepared.origin);batch.outbox.push(execution);batch.response=prepared.execution;break;
        }
        case 'context.get': return ok(snapshot.context);
        case 'context.limits': {
          const totals=this.executions.totals(current);
          if (input.limits.currency!==current.context.limits.currency) fail('FORBIDDEN','A resource revision cannot redenominate retained accounting');
          if(!core.resourceCapacity(totals,{...zeroUsage(),concurrentExecutions:0},input.limits))fail('LIMIT_EXCEEDED','Resource revision is below retained usage or reservations');
          // Existing policy/grants can be broader after a reduction, but every new
          // request is still bounded by all three. Preserve actual unknown work.
          if (input.limits.deadline) for (const stored of Object.values(current.controlState.executions ?? {})) {
            if (!['succeeded','failed','cancelled'].includes(stored.value.state) && (!stored.value.intent.limits.deadline || Date.parse(stored.value.intent.limits.deadline)>Date.parse(input.limits.deadline))) fail('LIMIT_EXCEEDED','New deadline would invalidate a retained execution');
          }
          control('contextMetadata','limits',input.limits);
          control('contextLimitRevisions',String(revision),{previous:current.context.limits,limits:input.limits,evidence:input.evidence,recordedBy:principalId});break;
        }
        case 'messages.send': {
          const stored=this.awareness.prepare(current,input.message,principalId,access);
          control('messages',input.message.id,stored);break;
        }
        case 'messages.read': return ok(this.awareness.read(snapshot,current,input,principalId,access,boundGrant));
        case 'messages.ack': {
          for (const id of input.messageIds) {
            this.awareness.message(current,id,principalId,access,boundGrant);
            control('messageAcks',id,{ principalId,recordedAt:new Date(this.clock.wall()).toISOString() });
          }
          break;
        }
        case 'prompt.compose': return ok(this.awareness.compose(snapshot,current,input,principalId,access));
        case 'events.read': return ok(this.events.read(snapshot,input,principalId,access));
        case 'schedule.put': {
          const { stored,state,origin }=this.scheduler.prepare(current,input.schedule,principalId,access,boundGrant);
          control('schedules',input.schedule.id,stored);control('scheduleStates',input.schedule.id,state);control('scheduleOrigins',input.schedule.id,origin);break;
        }
        case 'schedule.get': return ok(this.scheduler.get(snapshot,input.scheduleId,principalId,access));
        case 'schedule.cancel': {
          this.scheduler.get(current,input.scheduleId,principalId,access);
          const state=current.controlState.scheduleStates[input.scheduleId];
          if(core.scheduleCancellable(state.state))control('scheduleStates',input.scheduleId,{...state,state:'cancelled',pending:[]});break;
        }
        case 'policy.evaluate': {
          if (!access.operator && !sameRef(input.grant,boundGrant)) fail('FORBIDDEN','Only the bound grant may be evaluated');
          let decision='permit';
          try { this.authorize(current,input.action,principalId,input,input.grant); } catch (error) {
            if (!(error instanceof DomainError)) throw error;
            decision=error.code==='POLICY_INDETERMINATE'?'indeterminate':'deny';
          }
          return ok({ decision,policy:current.context.policy,evaluatedRevision:current.context.revision,supportingRefs:[input.grant],explanation:'Current policy and grant-chain evaluation' });
        }
        case 'policy.publish': {
          this.ensureNewId(current,input.policy.id);
          const value=this.stored(input.contextId,input.policy,revision,principalId);
          control('policies',input.policy.id,value);batch.response=value;break;
        }
        case 'policy.activate': {
          const candidate=this.lookup(current,input.policy);
          if (!current.controlState.policies?.[input.policy.id]) fail('NOT_FOUND','Policy not found');
          boundLimits(candidate.value.limits,current.context.limits);
          if (!access.operator) {
            if (!access.chain.every(grant=>grant.incidentIds==='all' && includesRef(grant.resourceRefs,this.ref(input.contextId,input.contextId)))) fail('FORBIDDEN','Context policy activation requires context-wide delegation');
            limitedPolicy(candidate.value,this.lookup(current,current.context.policy).value,access.chain[0],[current.controlState.owners.principalId]);
          }
          for (const ref of input.evidence.sources) { if (!access.canRead(ref)) fail('NOT_FOUND','Evidence is not accessible');this.lookup(current,ref); }
          control('contextMetadata','policy',input.policy);break;
        }
        case 'grant.issue': {
          const grant=input.grant;
          this.ensureNewId(current,grant.id);
          const capabilityNames=Object.values(current.controlState.capabilities ?? {}).map(item=>item.value.name);
          if (grant.actions.some(action=>!bootstrapActions.includes(action) && !capabilityNames.includes(action))) fail('INVALID_ARGUMENT','Grant contains an unknown action');
          boundLimits(grant.limits,current.context.limits);
          boundLimits(grant.limits,this.lookup(current,current.context.policy).value.limits);
          for (const ref of grant.resourceRefs) this.local(ref,input.contextId);
          if (!access.operator && !sameRef(grant.parentGrant,boundGrant)) fail('FORBIDDEN','Delegation must name the bound parent');
          if (grant.parentGrant) {
            const parent=this.lookup(current,grant.parentGrant).value;
            grantChain(current,grant.parentGrant,parent.principalId,this.clock.wall());attenuates(grant,parent);
          }
          if (grant.expiresAt && Date.parse(grant.expiresAt)<=this.clock.wall()) fail('INVALID_ARGUMENT','Cannot issue an expired grant');
          const value=this.stored(input.contextId,grant,revision,principalId);
          control('grants',grant.id,value);batch.response=value;break;
        }
        case 'grant.revoke': {
          const target=this.lookup(current,input.grant);
          if (!current.controlState.grants?.[input.grant.id]) fail('NOT_FOUND','Grant not found');
          if (!access.operator) {
            const chain=grantChain(current,input.grant,target.value.principalId,this.clock.wall());
            if (!sameRef(input.grant,boundGrant) && (target.recordedBy!==principalId || !chain.some(item=>item.id===boundGrant.id))) fail('FORBIDDEN','Cannot revoke outside the active delegation');
          }
          control('revokedGrants',input.grant.id,true);
          this.executions.cancelMatching(current,(_value,origin)=>origin.grantIds.includes(input.grant.id),'Execution grant revoked',principalId,control);break;
        }
        case 'context.close':
          control('contextMetadata', 'state', 'closed');
          this.executions.cancelMatching(current,()=>true,'Context closed',principalId,control);break;
        case 'control.get': {
          if (!access.operator && !sameRef(input.ref,boundGrant) && !access.canRead(input.ref)) fail('NOT_FOUND','Control object is not accessible');
          if(current.controlState.guidanceSources?.[input.ref.id])this.guidance.source(current,input.ref.id,access);
          if(current.controlState.guidanceCaptures?.[input.ref.id])this.guidance.capture(current,input.ref.id,access);
          const item = this.lookup(snapshot, input.ref);
          if (!['policies', 'grants', 'rules', 'capabilities', 'schedules', 'views','guidanceSources','guidanceCaptures'].some(namespace => snapshot.controlState[namespace]?.[input.ref.id])) fail('NOT_FOUND', 'Control object not found');
          return ok(item);
        }
        case 'schema.publish': {
          if (!access.operator) fail('FORBIDDEN','Schema admission currently requires the operator');
          if (input.schema.name.startsWith('moment.') && !installedSchema(input.schema)) fail('FORBIDDEN', 'The moment schema namespace is reserved for installed definitions');
          if (digest(input.document) !== input.schema.digest) fail('INVALID_ARGUMENT', 'Schema digest does not match document');
          compileDocument(input.document);
          const key = canonical([input.schema.name, input.schema.version]);
          const old = current.controlState.schemas?.[key];
          if (old && old.value.schema.digest !== input.schema.digest) fail('IDENTITY_CONFLICT', 'Schema version already has different content');
          const value = { schema: input.schema, document: input.document };
          const stored = { value, ref: this.ref(input.contextId, randomUUID()), digest: digest(value), revision, recordedAt: new Date().toISOString(), recordedBy: principalId };
          if (!old) this.ensureNewId(current,stored.ref.id);
          control('schemas', key, old ?? stored); batch.response = old ?? stored; break;
        }
        case 'schema.get': { const schema=this.schema(snapshot,input.schema);if (!access.canRead(schema.ref)) fail('NOT_FOUND','Schema is not accessible');return ok(schema.value.document); }
        case 'incident.create':
          if (!access.canIncident(input.id)) fail('FORBIDDEN','Incident is outside delegated authority');
          this.incidentEvidence(current,input.incident,input.evidence,access);
          this.ensureNewId(current,input.id);
          const stored = this.stored(input.contextId, { id: input.id, ...input.incident }, revision, principalId);
          stored.value = { ...input.incident }; stored.digest = digest(stored.value);
          if (input.evidence) stored.evidence=input.evidence;
          control('incidents', input.id, stored); batch.response = stored; break;
        case 'incident.get': {
          const item = snapshot.controlState.incidents?.[input.incidentId];
          if (!item) fail('NOT_FOUND', 'Incident not found');
          if (!this.incidentVisible(item,access) || !this.incidentVisible(current.controlState.incidents?.[input.incidentId],access)) fail('NOT_FOUND','Incident dependencies are not accessible');
          return ok(item);
        }
        case 'incident.list': return ok(this.listIncidents(snapshot,current,input,principalId,access,boundGrant));
        case 'incident.update': {
          const item = current.controlState.incidents?.[input.incidentId];
          if (!item) fail('NOT_FOUND', 'Incident not found');
          if (!core.incidentRevisable(item.value.status,input.incident.status)) fail('FORBIDDEN', 'Reopening requires a separately admitted operation');
          this.incidentEvidence(current,input.incident,input.evidence,access);
          const stored = this.stored(input.contextId, { id: input.incidentId, ...input.incident }, revision, principalId);
          stored.value = { ...input.incident };
          stored.digest = digest(stored.value);
          stored.evidence=input.evidence;
          control('incidents', input.incidentId, stored);
          if (core.incidentTerminal(input.incident.status)) this.executions.cancelMatching(current,value=>value.intent.incidentId===input.incidentId,'Incident ended',principalId,control);
          batch.response = stored; break;
        }
        case 'graph.transact': this.admitGraph(current,input.changes,principalId,access);batch.changes=input.changes;break;
        case 'capability.advertise': {
          const value=this.executions.publish(current,input.capability,principalId,access,methods);
          control('capabilities',value.ref.id,value);batch.response=value;break;
        }
        case 'capability.match': return ok(this.executions.match(snapshot,current,input,principalId,access,boundGrant));
        case 'execution.request': {
          const prepared=this.executions.prepare(current,input.execution,principalId,access);
          control('executions',input.execution.id,this.stored(input.contextId,prepared.execution,revision,principalId,input.execution.id));
          control('executionOrigins',input.execution.id,prepared.origin);batch.outbox.push(input.execution);batch.response=prepared.execution;break;
        }
        case 'execution.get': return ok(this.executions.get(snapshot,input.executionId,principalId,access).value);
        case 'execution.claim': case 'execution.heartbeat': case 'execution.finish': case 'execution.cancel': case 'execution.reconcile': {
          const { value,leaseMeta }=this.executions.update(current,method,input,principalId,access);
          control('executions',input.executionId,this.stored(input.contextId,value,revision,principalId,input.executionId));
          control('executionLeases',input.executionId,leaseMeta);batch.response=value;break;
        }
        case 'view.publish': {
          this.ensureNewId(current,input.view.id);
          if (input.view.fields.length>64) fail('LIMIT_EXCEEDED','Too many projection fields');
          for (const pointer of input.view.fields) { tokens(pointer);if (pointer.startsWith('/support/') || (pointer!=='/support' && !select({ value:{},ref:{},digest:'',revision:0,recordedAt:'',recordedBy:'' },pointer).found && !pointer.startsWith('/value/') && !pointer.startsWith('/ref/'))) fail('INVALID_ARGUMENT','Unknown projection field'); }
          if (input.view.groupBy==='schema' && !input.view.fields.includes('') && !input.view.fields.includes('/value') && !input.view.fields.includes('/value/schema') && !input.view.fields.includes('/value/schema/name')) fail('INVALID_ARGUMENT','Schema grouping requires a visible schema name');
          const value=this.stored(input.contextId,input.view,revision,principalId);control('views',input.view.id,value);batch.response=value;break;
        }
        case 'view.read': {
          if (!access.canRead(input.view)) fail('NOT_FOUND','View is not accessible');
          this.local(input.view,input.contextId);const stored=snapshot.controlState.views?.[input.view.id];if (!stored) fail('NOT_FOUND','View not found');
          const view=stored.value;const page=this.query(snapshot,{ contextId:input.contextId,selector:view.selector,limit:input.limit,...(input.cursor?{ cursor:input.cursor }:{}),...(input.atRevision!==undefined?{ atRevision:input.atRevision }:{}) },principalId,access,{ scope:'view:'+view.id,groupBy:view.groupBy });
          const records=page.items.map(item=>{ const fields={};for (const pointer of view.fields) if (pointer!=='/support') { const value=select(item.record,pointer);if (value.found) fields[pointer]=value.value; }return { ref:item.record.ref,fields }; });
          const result={ view:input.view,records,support:view.fields.includes('/support')?page.items.flatMap(item=>item.support):[],complete:!page.nextCursor };
          return ok({ ...result,version:digest(result),...(page.nextCursor?{ nextCursor:page.nextCursor }:{}) });
        }
        case 'rule.publish': {
          this.ensureNewId(current,input.rule.id);
          if (!methods.includes(input.rule.operation)) fail('CAPABILITY_UNAVAILABLE','Reaction destination is not installed');
          boundLimits(input.rule.limits,current.context.limits);
          if (!access.operator) for (const grant of access.chain) boundLimits(input.rule.limits,grant.limits);
          // Validate pointer structure and binding names at publication; actual values arrive at evaluation.
          const dummy=Object.fromEntries(Object.values(input.rule.inputBindings).map(name=>[name,null]));bindInput(input.rule.literalInput,input.rule.inputBindings,dummy);
          for (const name of Object.values(input.rule.inputBindings)) if (!['occurrence.id','occurrence.eventIds','schedule.id','contextId','principalId','incidentId','action','resourceRefs','contextRevision','now','event.id','event.ids','event.type','event.subjectRefs'].includes(name)) fail('INVALID_ARGUMENT','Unknown input binding');
          const value=this.stored(input.contextId,input.rule,revision,principalId);control('rules',input.rule.id,value);batch.response=value;break;
        }
        case 'reaction.evaluate': return ok(this.evaluateReaction(snapshot,input,principalId,access));
        case 'transition.propose': {
          const proposal=input.proposal;this.ensureNewId(current,proposal.id);
          if (!access.canIncident(proposal.incidentId) || !current.controlState.incidents?.[proposal.incidentId]) fail('NOT_FOUND','Incident not found');
          if (proposal.basisRevision!==input.expectedRevision || !sameRef(proposal.policy,current.context.policy)) fail('REVISION_CONFLICT','Proposal basis or policy is stale','refresh');
          if (!proposal.changes.length && !proposal.executions.length) fail('INVALID_ARGUMENT','Proposal is empty');
          if (proposal.changes.some(change=>(change.record?.id ?? change.assertion?.id)===proposal.id)) fail('IDENTITY_CONFLICT','Proposal identity aliases its graph change');
          if (proposal.rule) { this.local(proposal.rule,input.contextId);if (!access.canRead(proposal.rule) || !current.controlState.rules?.[proposal.rule.id]) fail('NOT_FOUND','Rule not found'); }
          for (const ref of proposal.evidence.sources) { if (!access.canRead(ref)) fail('NOT_FOUND','Proposal evidence is inaccessible');this.lookup(current,ref); }
          if (proposal.changes.length) {
            this.authorize(current,'graph.transact',principalId,{ ...input,changes:proposal.changes },boundGrant);
            this.admitGraph(current,proposal.changes,principalId,access);
          }
          this.executionPlan(current,proposal,principalId,access,boundGrant,principalId);
          const value=this.stored(input.contextId,{ proposal,state:'proposed' },revision,principalId,proposal.id);control('transitions',proposal.id,value);control('transitionOrigins',proposal.id,{ principalId,grantId:boundGrant?.id ?? null });batch.response=value.value;break;
        }
        case 'transition.get': {
          const stored=this.transition(snapshot,input.proposalId,principalId,access);return ok(stored.value);
        }
        case 'transition.commit': {
          const stored=this.transition(current,input.proposalId,principalId,access),proposal=stored.value.proposal;
          if (stored.value.state!=='proposed') fail('IDENTITY_CONFLICT','Proposal is already terminal; use its original retry key or transition.get');
          if (stored.revision!==current.context.revision || !sameRef(proposal.policy,current.context.policy)) fail('REVISION_CONFLICT','Proposal requires a fresh basis','refresh');
          if (proposal.changes.length) {
            this.authorize(current,'graph.transact',principalId,{ ...input,changes:proposal.changes },boundGrant);
            this.admitGraph(current,proposal.changes,principalId,access);
          }
          for (const prepared of this.executionPlan(current,proposal,principalId,access,boundGrant,current.controlState.transitionOrigins[proposal.id].principalId)) {
            const id=prepared.execution.intent.id;
            control('executions',id,this.stored(input.contextId,prepared.execution,revision,principalId,id));
            control('executionOrigins',id,prepared.origin);batch.outbox.push(prepared.execution.intent);
          }
          const commit={ transitionId:randomUUID(),contextId:input.contextId,previousRevision:input.expectedRevision,revision,eventIds:[commitEventId] };
          batch.commitId=commit.transitionId;batch.changes=proposal.changes;
          control('transitions',proposal.id,this.stored(input.contextId,{ proposal,state:'committed',commit },revision,principalId,proposal.id));break;
        }
        case 'graph.query': return ok(this.query(snapshot, input, principalId, access));
        default: fail('INVALID_ARGUMENT', 'Method is not implemented');
      }
      if (scheduled) scheduled.complete(batch,current);
      batch.events.unshift(...mutationEvents(this,method,input,current,batch,commitEventId,scheduled?.causeIds ?? []));
      if (batch.commitId) for (const change of batch.controlChanges) if (change.namespace==='transitions' && change.value.value.commit?.transitionId===batch.commitId) {
        change.value.value.commit.eventIds=batch.events.map(event=>event.id);change.value.digest=digest(change.value.value);
      }
      const committed = this.store.commit(batch, method);
      if (!committed.ok) return committed;
      return ok(batch.response.kind === 'commit-receipt' ? committed.value : batch.response);
    } catch (error) {
      if (error instanceof DomainError) return resultError(error);
      throw error;
    }
  }
  admitGraph(current,changes,principalId,access) {
    for (const change of changes) {
      const ref=change.kind==='record.put'?this.ref(current.context.id,change.record.id):change.kind==='assertion.put'?change.assertion.record:current.assertions.find(item=>item.assertion.value.id===change.assertionId)?.assertion.value.record;
      if (!ref || !access.canRead(ref)) fail('FORBIDDEN','Graph mutation is outside delegated resources');
      if (change.kind==='assertion.withdraw' && !access.operator && current.assertions.find(item=>item.assertion.value.id===change.assertionId)?.assertion.recordedBy!==principalId) fail('FORBIDDEN','Cannot withdraw another source\'s assertion');
      const references=change.kind==='record.put' && change.record.kind==='relation'?Object.values(change.record.roles).flat():change.kind==='assertion.put'?change.assertion.evidence.sources:[];
      if (references.some(ref=>!access.canRead(ref))) fail('NOT_FOUND','Referenced evidence is not accessible');
    }
    this.validateChanges(current,changes);
    const preview={ ...current,records:[...current.records],assertions:current.assertions.map(item=>({...item})) };
    applyGraph(preview,changes,value=>this.stored(current.context.id,value,current.context.revision+1,principalId),{ systemId:this.store.systemId,contextId:current.context.id,revision:current.context.revision+1 });
    validateTopology(preview);
  }
  executionPlan(current,proposal,principalId,access,boundGrant,requester) {
    const preview={ ...current,controlState:{ ...current.controlState,executions:{ ...current.controlState.executions },executionOrigins:{ ...current.controlState.executionOrigins } } };
    const ids=new Set([proposal.id,...proposal.changes.map(change=>change.record?.id ?? change.assertion?.id).filter(Boolean)]),prepared=[];
    for (const intent of proposal.executions) {
      if (intent.incidentId!==proposal.incidentId) fail('FORBIDDEN','Proposal executions must share its incident');
      if (ids.has(intent.id)) fail('IDENTITY_CONFLICT','Execution identity aliases another proposal object');ids.add(intent.id);
      this.authorize(current,'execution.request',principalId,{ incidentId:intent.incidentId,resourceRefs:[intent.capability] },boundGrant);
      const item=this.executions.prepare(preview,intent,principalId,access,requester);
      preview.controlState.executions[intent.id]=this.stored(current.context.id,item.execution,current.context.revision+1,principalId,intent.id);
      preview.controlState.executionOrigins[intent.id]=item.origin;prepared.push(item);
    }
    return prepared;
  }
  transition(snapshot,id,principalId,access) {
    const stored=snapshot.controlState.transitions?.[id];
    const origin=snapshot.controlState.transitionOrigins?.[id];
    const ownBranch=origin?.principalId===principalId && access.chain.some(grant=>grant.id===origin.grantId);
    if (!stored || !access.canIncident(stored.value.proposal.incidentId) || (!access.operator && !ownBranch && !access.canRead(stored.ref))) fail('NOT_FOUND','Transition not found');
    return stored;
  }
  evaluateReaction(snapshot,input,principalId,access,extraBindings={}) {
    this.local(input.rule,input.contextId);
    const stored=snapshot.controlState.rules?.[input.rule.id];
    if (!stored || !access.canRead(input.rule)) fail('NOT_FOUND','Rule not found');
    const rule=stored.value;
    const events=input.eventIds.map(id=>{ const event=this.store.event(input.contextId,id);if (!event || event.revision>snapshot.context.revision || !this.events.visible(snapshot,event,principalId,access)) fail('NOT_FOUND','Event not accessible');return event; }).filter(event=>!rule.triggerEventTypes.length || rule.triggerEventTypes.includes(event.type)).sort((a,b)=>a.sequence-b.sequence);
    const candidates=events.length?events:!input.eventIds.length && !rule.triggerEventTypes.length?[undefined]:[];
    let unknown=false;
    for (const event of candidates) {
      const bindings={ contextId:input.contextId,principalId,incidentId:input.incidentId,action:rule.operation,resourceRefs:[],contextRevision:snapshot.context.revision,now:new Date(this.clock.wall()).toISOString(),'event.ids':events.map(item=>item.id),...(event?{'event.id':event.id,'event.type':event.type,'event.subjectRefs':event.subjectRefs}:{}),...extraBindings };
      const value=evaluate(rule.condition,{ bindings,...this.policyQueries(snapshot,access,principalId) });
      if (value==='unknown') { unknown=true;continue; }
      if (value) { const candidateInput=bindInput(rule.literalInput,rule.inputBindings,bindings);validateInput(rule.operation,candidateInput);return { eligible:true,explanation:'Condition matched; destination input validated',candidateInput }; }
    }
    if (unknown) fail('POLICY_INDETERMINATE','Reaction condition is unresolved');
    return { eligible:false,explanation:'No triggering condition matched' };
  }
  create(input, principalId) {
    if (principalId !== this.ownerId) fail('FORBIDDEN', 'Context bootstrap requires operator authority');
    if (input.bootstrapProfile !== 'owner-local') fail('INVALID_ARGUMENT', 'Unknown installed bootstrap profile');
    const policyId = randomUUID();
    const policy = { id: policyId, authorityIssuers:[principalId], rules: [{ id: 'owner-local', effect: 'permit', actions: bootstrapActions.filter(method => method !== 'context.create'), when: { kind: 'equal', left: { kind: 'binding', name: 'principalId' }, right: { kind: 'literal', value: principalId } } }], limits: input.limits, evidence: { sources: [], method: 'installed-owner-local-profile', artifactDigests: [] } };
    const schemas=Object.fromEntries(builtinSchemas.map(item=>[canonical([item.schema.name,item.schema.version]),this.stored(input.id,{ schema:item.schema,document:item.document },1,principalId,randomUUID())]));
    const controlState = { schemas,owners: { principalId }, policies: { [policyId]: this.stored(input.id, policy, 1, principalId) } };
    const context = { id: input.id, label: input.label, policy: this.ref(input.id, policyId), limits: input.limits, imports: [] };
    return this.store.create(context, principalId, input.idempotencyKey, digest(input), controlState);
  }
  compiled(schema) {
    const key=schema.value.schema.digest;
    if (!this.schemaValidators.has(key)) {
      if (this.schemaValidators.size>=64) this.schemaValidators.delete(this.schemaValidators.keys().next().value);
      this.schemaValidators.set(key,compileDocument(schema.value.document));
    }
    return this.schemaValidators.get(key);
  }
  schema(snapshot, ref) {
    const schema = snapshot.controlState.schemas?.[canonical([ref.name, ref.version])];
    if (!schema || !equal(schema.value.schema, ref)) fail('NOT_FOUND', 'Exact schema reference not found');
    return schema;
  }
  validateChanges(snapshot, changes) {
    const records = changes.filter(change => change.kind === 'record.put').map(change => change.record);
    for (const record of records) {
      if (record.id===snapshot.context.id || snapshot.assertions.some(item=>item.assertion.ref.id===record.id) || changes.some(change=>change.kind==='assertion.put' && change.assertion.id===record.id) || Object.values(snapshot.controlState).some(namespace => namespace && typeof namespace === 'object' && Object.values(namespace).some(item => item?.ref?.id === record.id))) fail('IDENTITY_CONFLICT', 'Record ID already names a control object');
      const schema = this.schema(snapshot, record.schema);
      if (installedSchema(record.schema) && record.kind!==(record.schema.name==='moment.prompt-template'?'atom':'relation')) fail('INVALID_ARGUMENT','Installed schema requires its declared semantic record kind');
      if (!this.compiled(schema)(record.kind === 'atom' ? record.value : record.roles)) fail('INVALID_ARGUMENT', 'Record does not satisfy its admitted schema');
      if (record.kind === 'relation') for (const refs of Object.values(record.roles)) for (const ref of refs) {
        this.local(ref, snapshot.context.id);
        if (!records.some(item => item.id === ref.id)) this.lookup(snapshot, ref);
      }
    }
    for (const change of changes) if (change.kind === 'assertion.put') {
      const id=change.assertion.id;
      if (id===snapshot.context.id || snapshot.records.some(item=>item.ref.id===id) || records.some(item=>item.id===id) || Object.values(snapshot.controlState).some(namespace=>namespace && typeof namespace==='object' && Object.values(namespace).some(item=>item?.ref?.id===id))) fail('IDENTITY_CONFLICT','Assertion identity names another object');
      if (change.assertion.validDuring) fail('INVALID_ARGUMENT', 'Temporal assertion applicability is not implemented');
      for (const ref of change.assertion.evidence.sources) {
        this.local(ref, snapshot.context.id);
        if (!records.some(item => item.id === ref.id)) this.lookup(snapshot, ref);
      }
    }
  }
  incidentEvidence(snapshot,incident,evidence,access) {
    const decision=core.incidentEvidence(incident.status,evidence);
    if(decision==='IncidentEvidenceMissing')fail('INVALID_ARGUMENT','Non-open creation requires attributable evidence');
    if(decision==='IncidentCompletionMissing')fail('INVALID_ARGUMENT','Completion requires attributable evidence');
    for (const ref of evidence?.sources ?? []) {
      if (!access.canRead(ref)) fail('NOT_FOUND','Evidence is not accessible');
      this.lookup(snapshot,ref);
    }
  }
  incidentVisible(item,access) {
    return !!item && [...item.value.continuation,...(item.evidence?.sources ?? [])].every(access.canRead);
  }
  listIncidents(snapshot,current,input,principalId,access,boundGrant) {
    const selection=digest(input.statuses??null);
    const scope={scope:'incident.list',principalId,authority:access.scopeKey,contextId:input.contextId,selection};
    let offset=0;
    if(input.cursor) {
      const cursor=openCursor(input.cursor,this.cursorKey);
      if(Object.entries(scope).some(([k,v])=>cursor[k]!==v) || !Number.isSafeInteger(cursor.offset) || cursor.offset<0 || (input.atRevision!==undefined && input.atRevision!==cursor.revision)) fail('INVALID_ARGUMENT','Cursor does not match incident selection');
      snapshot=this.store.read(input.contextId,cursor.revision);offset=cursor.offset;
    }
    const selected=Object.values(snapshot.controlState.incidents??{}).filter(item=>{
      if(input.statuses && !input.statuses.includes(item.value.status)) return false;
      try {
        const latest=current.controlState.incidents?.[item.ref.id];
        this.authorize(current,'incident.get',principalId,{contextId:input.contextId,incidentId:item.ref.id},boundGrant);
        return this.incidentVisible(item,access) && this.incidentVisible(latest,access);
      } catch(error) { if(!(error instanceof DomainError)) throw error;return false; }
    }).sort((a,b)=>a.ref.id.localeCompare(b.ref.id));
    return {items:selected.slice(offset,offset+input.limit),snapshotRevision:snapshot.context.revision,...(offset+input.limit<selected.length?{nextCursor:sealCursor({...scope,revision:snapshot.context.revision,offset:offset+input.limit},this.cursorKey)}:{})};
  }
  query(snapshot, input, principalId, access, options={}) {
    let offset = 0;
    const selection = digest(input.selector);
    if (input.cursor) {
      const cursor=openCursor(input.cursor,this.cursorKey);
      if (cursor.scope!==(options.scope ?? 'graph.query') || cursor.principalId !== principalId || cursor.authority !== access.scopeKey || cursor.contextId !== input.contextId || cursor.selection !== selection || (input.atRevision !== undefined && input.atRevision !== cursor.revision)) fail('INVALID_ARGUMENT', 'Cursor does not match query');
      snapshot = this.store.read(input.contextId, cursor.revision); offset = cursor.offset;
    }
    if (input.selector.relatedTo && !access.canRead(input.selector.relatedTo)) fail('NOT_FOUND','Related object is not accessible');
    const supportIndex=new Map();
    for (const item of snapshot.assertions) if (item.assertion.value.evidence.sources.every(access.canRead)) {
      const id=item.assertion.value.record.id;if (!supportIndex.has(id)) supportIndex.set(id,[]);supportIndex.get(id).push(item);
    }
    const visibleSupport=ref=>supportIndex.get(ref.id) ?? [];
    let relatedIds;
    if (input.selector.relatedTo) {
      this.local(input.selector.relatedTo,snapshot.context.id);relatedIds=new Set();
      for (const relation of snapshot.records) if (access.canRead(relation.ref) && core.queryRelated(relation.value,input.selector.relationRole,input.selector.relatedTo)) {
        for (const refs of Object.values(relation.value.roles)) for (const ref of refs) relatedIds.add(ref.id);
      }
    }
    const matches=core.querySelection(input.selector,relatedIds===undefined?undefined:[...relatedIds]);
    const selected = snapshot.records.filter(item => {
      if (!access.canRead(item.ref)) return false;
      const support = visibleSupport(item.ref);
      return matches(item.value,support.map(item=>item.status));
    });
    const compare=(a,b)=>a<b?-1:a>b?1:0;
    if (options.groupBy==='schema') selected.sort((a,b)=>compare(a.value.schema.name,b.value.schema.name) || compare(a.ref.id,b.ref.id));
    if (options.groupBy==='record') selected.sort((a,b)=>compare(a.ref.id,b.ref.id));
    const items = selected.slice(offset, offset + input.limit).map(record => ({ record, support: visibleSupport(record.ref) }));
    const page = { items, snapshotRevision: snapshot.context.revision };
    if (offset + input.limit < selected.length) {
      page.nextCursor = sealCursor({ scope:options.scope ?? 'graph.query',principalId,authority:access.scopeKey,contextId:input.contextId,revision:snapshot.context.revision,selection,offset:offset+input.limit },this.cursorKey);
    }
    return page;
  }
}
