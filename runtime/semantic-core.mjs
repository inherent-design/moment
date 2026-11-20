import {canonical,fail} from './json.mjs';
import {fileURLToPath} from 'node:url';
import {verifySemanticBuild} from './semantic-manifest.mjs';

verifySemanticBuild(fileURLToPath(new URL('../',import.meta.url)));
const {default:Core}=await import('./generated/semantics.mjs');

const list=values=>values.reduceRight((tail,head)=>({$: 'Con',head,tail}),{$:'Nil'});
const truth=value=>({$:value===true?'Yes':value===false?'No':'Unknown'});
const observed=value=>{if(value?.$==='Yes')return true;if(value?.$==='No')return false;if(value?.$==='Unknown')return 'unknown';fail('INTERNAL','Invalid core truth output');};
export const all=values=>observed(Core['truth.all'](list(values.map(truth))));
export const any=values=>observed(Core['truth.any'](list(values.map(truth))));
export const not=value=>observed(Core['truth.not'](truth(value)));
export const sameText=(a,b)=>Core.same_text(a,b);
export const sameValue=(a,b)=>sameText(canonical(a),canonical(b));
export function policyDecision(decisions) {
 const result=Core.policy(list(decisions.filter(d=>d.effect==='deny').map(d=>truth(d.result))),list(decisions.filter(d=>d.effect==='permit').map(d=>truth(d.result))));
 const value={Permit:'permit',Deny:'deny',Indeterminate:'indeterminate'}[result?.$];if(!value)fail('INTERNAL','Invalid core policy output');return value;
}
// IEEE-754 binary64 order is preserved as two unsigned limbs. Bend's native
// Float32 and JavaScript-host Nat representations cannot carry every JSON number.
export function numberRank(value) {
 if(typeof value!=='number'||!Number.isFinite(value))fail('INVALID_ARGUMENT','Numeric comparison requires finite numbers');
 const bytes=new DataView(new ArrayBuffer(8));bytes.setFloat64(0,value===0?0:value);const high=bytes.getUint32(0),low=bytes.getUint32(4);
 return high&0x80000000?{high:(~high)>>>0,low:(~low)>>>0}:{high:(high^0x80000000)>>>0,low};
}
export function lessOrEqual(a,b) {const x=numberRank(a),y=numberRank(b);return Core.ordered_le(x.high,x.low,y.high,y.low);}
export function within(visited,depth,nodes,maximumDepth) {for(const n of [visited,depth,nodes,maximumDepth])if(!Number.isSafeInteger(n)||n<0)fail('INVALID_ARGUMENT','Condition budget requires safe nonnegative integer counts');return Core.within(visited,depth,nodes,maximumDepth);}
const scoped=value=>value&&typeof value.systemId==='string'&&typeof value.contextId==='string';
export const sameScope=(a,b)=>!!(scoped(a)&&scoped(b)&&Core.same_scope(a.systemId,a.contextId,b.systemId,b.contextId));
export const sameReference=(a,b)=>!!(scoped(a)&&scoped(b)&&typeof a.id==='string'&&typeof b.id==='string'&&Core.same_ref(a.systemId,a.contextId,a.id,b.systemId,b.contextId,b.id));
export const textSubset=(child,parent)=>Core.text_subset(list(child),list(parent));
export const incidentScope=(child,parent)=>Core.incident_scope(parent==='all',child==='all',list(child==='all'?[]:child),list(parent==='all'?[]:parent));
export function limitsFit(child,parent) {return Core.fits(list(child.map(value=>({$:'Rank',...numberRank(value)}))),list(parent.map(value=>({$:'Rank',...numberRank(value)}))));}
export function deadlineFits(child,parent) {return Core.deadline(parent!==undefined,child!==undefined,{$:'Rank',...numberRank(child===undefined?0:Date.parse(child))},{$:'Rank',...numberRank(parent===undefined?0:Date.parse(parent))});}
export function recordEdit(exists,sameDigest) {return Core.record_edit(exists,sameDigest).$;}
export function assertionEdit(localRecord,sameDigest,status) {return Core.assertion_edit(localRecord,sameDigest,{$:{absent:'Absent',asserted:'Asserted',withdrawn:'Withdrawn'}[status]}).$;}
const support=status=>({$:{absent:'Absent',asserted:'Asserted',withdrawn:'Withdrawn'}[status]});
const rank=value=>({$:'Rank',...numberRank(value)});
const instant=value=>rank(value===undefined?0:Date.parse(value));
const resourceKey=ref=>canonical([ref.systemId,ref.contextId,ref.id]);
const limitKeys=['concurrentExecutions','cpuMillis','memoryBytes','outputBytes','modelTokens','apiSpendMicrounits'];
export function withdrawEdit(status) {return Core.assertion_withdraw(support(status)).$;}
export function graphOrder(changes) {
 const input=list(changes.map((change,index)=>({$:'GraphIndex',index,record:change.kind==='record.put'}))),ordered=[],seen=new Set();let result=Core.graph_order(input);
 while(result?.$==='Con') {const index=result.head;if(!Number.isSafeInteger(index)||index<0||index>=changes.length||seen.has(index))fail('INTERNAL','Invalid core graph ordering');seen.add(index);ordered.push(changes[index]);result=result.tail;}
 if(result?.$!=='Nil'||ordered.length!==changes.length)fail('INTERNAL','Incomplete core graph ordering');return ordered;
}
export function grantLink(context,ref,seen,stored,revoked,principalId,now) {
 return Core.grant_link(context.systemId,context.id,ref.systemId,ref.contextId,ref.id,list(seen),!!stored,!!revoked,stored?.value.expiresAt!==undefined,instant(stored?.value.expiresAt),rank(now),principalId,stored?.value.principalId??'').$;
}
export const grantEnd=seen=>Core.grant_end(list(seen)).$;
export function limitsBound(child,parent) {
 return Core.limits_bound(child.currency,parent.currency,list(limitKeys.map(k=>rank(child[k]))),list(limitKeys.map(k=>rank(parent[k]))),parent.deadline!==undefined,child.deadline!==undefined,instant(child.deadline),instant(parent.deadline)).$;
}
export function delegationBound(child,parent) {
 return Core.delegation_bound(list(child.actions),list(parent.actions),parent.incidentIds==='all',child.incidentIds==='all',list(child.incidentIds==='all'?[]:child.incidentIds),list(parent.incidentIds==='all'?[]:parent.incidentIds),list(child.resourceRefs.map(resourceKey)),list(parent.resourceRefs.map(resourceKey)),parent.expiresAt!==undefined,child.expiresAt!==undefined,instant(child.expiresAt),instant(parent.expiresAt),parent.delegable).$;
}
const policyRule=rule=>({$:'PolicyRule',permit:rule.effect==='permit',identity:canonical(rule),condition:canonical(rule.when),actions:list(rule.actions)});
export const policyIssuers=(candidate,current)=>Core.policy_issuers(list(candidate),list(current)).$;
export const policyRules=(candidate,current,grant)=>Core.policy_rules(list(candidate.map(policyRule)),list(current.map(policyRule)),list(grant)).$;
const runStates={queued:'RunQueued',leased:'RunLeased',running:'RunRunning',cancel_requested:'RunCancelling',unknown:'RunUncertain',succeeded:'RunSucceeded',failed:'RunFailed',cancelled:'RunCancelled'};
const runLabels=Object.fromEntries(Object.entries(runStates).map(([key,value])=>[value,key]));
const runState=value=>{if(typeof value!=='string'||!Object.hasOwn(runStates,value))fail('INVALID_ARGUMENT','Unsupported execution state');return {$:runStates[value]};};
export const executionTerminal=state=>Core.execution_terminal(runState(state));
export function executionStep(state,action,outcome) {
 const actions={claim:'Claim',heartbeat:'Heartbeat',finish:'Finish',cancel:'Cancel',lost:'Lost',retry:'Retry',observed:'Observed'};
 if(typeof action!=='string'||!Object.hasOwn(actions,action))fail('INVALID_ARGUMENT','Unsupported execution signal');
 const event={$:'Run'+actions[action]};if(['finish','observed'].includes(action)){const kinds={succeeded:'Success',failed:'Failure',cancelled:'Cancellation',unknown:'Unobserved'};if(typeof outcome!=='string'||!Object.hasOwn(kinds,outcome))fail('INVALID_ARGUMENT','Unsupported execution outcome');event.outcome={$:'Run'+kinds[outcome]};}
 const result=Core.execution_step(runState(state),event);
 if(result?.$==='RunNext') {const selected=runLabels[result.state?.$];if(!selected||['cancellation','authority','immediate'].some(k=>typeof result[k]!=='boolean'))fail('INTERNAL','Invalid core execution transition');return {kind:'next',state:selected,cancellation:result.cancellation,authority:result.authority,immediate:result.immediate};}
 if(!['RunNotClaimable','RunInactive','RunDispatchRequired','RunNotUncertain'].includes(result?.$))fail('INTERNAL','Invalid core execution refusal');
 return {kind:result.$.slice(3)};
}
const topologyVerdict=result=>{if(!['TopGood','TopParents','TopCycle','TopInvalid'].includes(result?.$))fail('INTERNAL','Invalid core topology verdict');return result.$;};
export function topologyCheck(size,edges,exclusive) {
 if(!Number.isSafeInteger(size)||size<0||size>0x7fffffff||!Array.isArray(edges)||edges.length>0x7fffffff||typeof exclusive!=='boolean')fail('INVALID_ARGUMENT','Topology index domain is not representable');
 const encoded=edges.map(edge=>{for(const index of [edge.source,edge.target])if(!Number.isSafeInteger(index)||index<0||index>0xffffffff)fail('INVALID_ARGUMENT','Topology endpoints must be unsigned word indices');return {$:'TopEdge',source:edge.source,target:edge.target};});
 // Arrays are affine within Bend and wrap indices. Supply fresh independent
 // power-of-two storage; the core checks each endpoint against the logical size.
 const capacity=2**Math.ceil(Math.log2(Math.max(1,size))),zeros=()=>new Array(capacity).fill(0),next=new Array(capacity).fill({$:'Nil'});
 return topologyVerdict(Core.topology_check(exclusive,size,list(encoded),zeros(),next,zeros(),zeros()));
}
export function topologyRecord(value,statuses,contextId) {
 const role=name=>value.roles?.[name]?.[0]?.id??'';
 const result=Core.topology_record(value.kind,value.schema.name,list(statuses),contextId,role('perspective'),value.roles?.frame?.[0]!==undefined,role('frame'),role('child'),role('parent'),role('earlier'),role('later'));
 if(result?.$==='TopSkip')return {kind:'skip'};
 if(!['TopWithin','TopBefore'].includes(result?.$)||['scope','source','target'].some(k=>typeof result[k]!=='string'||!result[k]))fail('INVALID_ARGUMENT','Malformed structural or temporal relation');
 return {kind:result.$==='TopWithin'?'within':'precedes',scope:result.scope,source:result.source,target:result.target};
}
// This private boundary qualifies the certificate checker independently of the
// sorting implementation. Production admission calls topologyCheck above.
export function topologyCertify(size,edges,ranks) {
 if(!Number.isSafeInteger(size)||size<0||size>0x7fffffff||!Array.isArray(ranks)||ranks.length!==size||!Array.isArray(edges))fail('INVALID_ARGUMENT','Invalid topology certificate shape');
 const encoded=edges.map(edge=>{for(const n of [edge.source,edge.target])if(!Number.isSafeInteger(n)||n<0||n>=size)fail('INVALID_ARGUMENT','Certificate endpoint is outside its graph');return {$:'TopEdge',source:edge.source,target:edge.target};});
 for(const rank of ranks)if(!Number.isSafeInteger(rank)||rank<0||rank>0xffffffff)fail('INVALID_ARGUMENT','Certificate ranks must be unsigned words');
 const storage=new Array(2**Math.ceil(Math.log2(Math.max(1,size)))).fill(0);for(let i=0;i<size;i++)storage[i]=ranks[i];
 return topologyVerdict(Core.topology_certify(list(encoded),storage));
}
export const topologyCombine=results=>topologyVerdict(Core.topology_combine(list(results.map(value=>({$:topologyVerdict({$:value})})))));

const coreBoolean=value=>{if(typeof value!=='boolean')fail('INTERNAL','Invalid core predicate output');return value;};
export const isOperator=(principal,owner,contextOwner,bound)=>coreBoolean(Core.access_operator(principal,owner,contextOwner??'',!!bound));
export function accessScopes(operator,chain) {
 if(typeof operator!=='boolean'||!Array.isArray(chain))fail('INVALID_ARGUMENT','Invalid authority observation');
 const scopes=list(chain.map(grant=>({$:'AccessScope',actions:list(grant.actions),all_incidents:grant.incidentIds==='all',incidents:list(grant.incidentIds==='all'?[]:grant.incidentIds),resources:list(grant.resourceRefs.map(resourceKey))}))),resources=new Map(),incidents=new Map();
 return {
  canRead(ref){const key=resourceKey(ref);if(!resources.has(key))resources.set(key,coreBoolean(Core.access_resource(operator,scopes,key)));return resources.get(key);},
  canIncident(id){if(!incidents.has(id))incidents.set(id,coreBoolean(Core.access_incident(operator,scopes,id)));return incidents.get(id);},
  method(method,context){const result=Core.access_method(operator,scopes,method,resourceKey(context));if(!['MethodAllowed','MethodOutsideGrant','MethodSchemaOperator','MethodLimitsOperator','MethodContextWide'].includes(result?.$))fail('INTERNAL','Invalid core method admission');return result.$;}
 };
}
export function mutationBasis(current,expected,state,method) {
 for(const revision of [current,expected])if(!Number.isSafeInteger(revision)||revision<0)fail('INVALID_ARGUMENT','Revisions require safe nonnegative integers');
 const result=Core.mutation_basis(String(current),String(expected),state,method);if(!['MutationAllowed','MutationStale','MutationClosed'].includes(result?.$))fail('INTERNAL','Invalid core mutation basis');return result.$;
}
const incidentStates={open:'IncidentOpen',resting:'IncidentResting',completed:'IncidentCompleted',cancelled:'IncidentCancelled'};
const incidentState=state=>{if(typeof state!=='string'||!Object.hasOwn(incidentStates,state))fail('INVALID_ARGUMENT','Unsupported incident state');return {$:incidentStates[state]};};
export const incidentTerminal=state=>coreBoolean(Core.incident_terminal(incidentState(state)));
export const incidentRevisable=(old,current)=>coreBoolean(Core.incident_revisable(incidentState(old),incidentState(current)));
export function incidentEvidence(state,evidence) {
 const result=Core.incident_evidence(incidentState(state),evidence!==undefined,list(evidence?.sources.map(resourceKey)??[]));if(!['IncidentEvidenceAllowed','IncidentEvidenceMissing','IncidentCompletionMissing'].includes(result?.$))fail('INTERNAL','Invalid core incident evidence decision');return result.$;
}
export function querySelection(selector,relatedIds) {
 const ids=list(selector.ids??[]),schemas=list(selector.schemaNames??[]),related=list(relatedIds??[]);
 return (record,statuses)=>coreBoolean(Core.query_match(record.id,record.schema.name,list(statuses),selector.ids!==undefined,ids,selector.schemaNames!==undefined,schemas,selector.assertionStatus,relatedIds!==undefined,related));
}
export function queryRelated(record,role,target) {
 const roles=list(Object.entries(record.roles??{}).map(([name,refs])=>({$:'QueryRole',name,members:list(refs.map(resourceKey))})));
 return coreBoolean(Core.query_related(record.kind,roles,role!==undefined,role??'',resourceKey(target)));
}

const accountingFields={cpuMillis:'cpu',memoryBytes:'memory',outputBytes:'output',modelTokens:'tokens',apiSpendMicrounits:'spend',concurrentExecutions:'concurrent'};
const count=value=>{if(!Number.isSafeInteger(value)||value<0)fail('INVALID_ARGUMENT','Resource quantities require safe nonnegative integers');return {$:'BudgetCount',high:Math.floor(value/2**32),low:value>>>0};};
const countValue=value=>{if(value?.$!=='BudgetCount'||!Number.isInteger(value.high)||value.high<0||value.high>0x1fffff||!Number.isInteger(value.low)||value.low<0||value.low>0xffffffff)fail('INTERNAL','Invalid core resource count');return value.high*2**32+value.low;};
const amountValue=value=>{if(value?.$==='BudgetOverflow')return Infinity;if(value?.$!=='BudgetFinite')fail('INTERNAL','Invalid core resource amount');return countValue(value.count);};
const quantities=value=>({$:'BudgetQuantities',...Object.fromEntries(Object.entries(accountingFields).map(([key,field])=>[field,count(key==='concurrentExecutions'?(value[key]??0):value[key])]))});
const amount=value=>value===Infinity?{$:'BudgetOverflow'}:{$:'BudgetFinite',count:count(value)};
const balance=value=>({$:'BudgetBalance',...Object.fromEntries(Object.entries(accountingFields).map(([key,field])=>[field,amount(value[key])]))});
export const resourceAdd=(a,b)=>amountValue(Core.resource_add(count(a),count(b)));
export const resourceLessOrEqual=(a,b)=>coreBoolean(Core.resource_le(count(a),count(b)));
export function resourceTotals(entries,grantId) {
 const scoped=entries.filter(({origin})=>grantId===undefined||Core.text_contains(list(origin.grantIds),grantId));
 const encoded=scoped.map(({value})=>({$:'BudgetReservation',state:runState(value.state),ceiling:quantities(value.intent.limits),usage:quantities(value.usage),...Object.fromEntries([['cpu_unknown','cpuMillis'],['output_unknown','outputBytes'],['tokens_unknown','modelTokens'],['spend_unknown','apiSpendMicrounits']].map(([flag,key])=>[flag,Core.text_contains(list(value.usage.unmeasured??[]),key)]))}));
 const result=Core.resource_totals(list(encoded));if(result?.$!=='BudgetBalance')fail('INTERNAL','Invalid core resource balance');
 return Object.fromEntries(Object.entries(accountingFields).map(([key,field])=>[key,amountValue(result[field])]));
}
export const resourceCapacity=(totals,requested,ceiling)=>coreBoolean(Core.resource_capacity(balance(totals),quantities(requested),quantities(ceiling)));
export const resourceUsage=(previous,usage,ceiling,observed)=>coreBoolean(Core.resource_usage(quantities(previous),quantities(usage),quantities(ceiling),!!observed));
export const resourceEnvelope=(requests,ceiling)=>coreBoolean(Core.resource_envelope(list(requests.map(quantities)),quantities(ceiling)));
export const resourceAvailable=envelopes=>countValue(Core.resource_available(list(envelopes.map(({used,ceiling})=>({$:'CapacityEnvelope',used:amount(used),ceiling:count(ceiling)})))));

export const resourceSubtract=(a,b)=>amountValue(Core.resource_subtract(count(a),count(b)));
export const resourceBlocked=entries=>coreBoolean(Core.resource_blocked(list(entries.map(value=>list(value.limitViolations??[])))));
export const resourceSingleSlot=value=>coreBoolean(Core.resource_single_slot(count(value)));
export const executionQueued=state=>coreBoolean(Core.execution_queued(runState(state)));
export const executionWaitsDeadline=(state,cancelled)=>coreBoolean(Core.execution_waits_deadline(runState(state),!!cancelled));
export const fenceEqual=(a,b)=>coreBoolean(Core.fence_equal(count(a),count(b)));
export function fenceNext(value) {
 const next=amountValue(Core.fence_next(count(value)));if(next===Infinity)fail('LIMIT_EXCEEDED','Execution fencing token exhausted');return next;
}
const calendarStart=-62167219200000,calendarEnd=253402300799999;
const wallCount=value=>{if(!Number.isSafeInteger(value)||value<calendarStart||value>calendarEnd)fail('INVALID_ARGUMENT','Wall clock requires an integer millisecond in the supported UTC calendar');return count(value-calendarStart);};
export function calendarAfter(anchor,duration) {
 const result=amountValue(Core.calendar_after(wallCount(anchor),count(duration),count(calendarEnd-calendarStart)));
 if(result===Infinity)fail('INVALID_ARGUMENT','Temporal anchor exceeds the supported calendar');const wall=result+calendarStart;wallCount(wall);return wall;
}
export function observeClock(clock) {
 const bootId=clock.bootId,wall=clock.wall(),monotonic=clock.monotonic();wallCount(wall);
 if(typeof bootId!=='string'||!bootId||clock.bootId!==bootId||!Number.isFinite(monotonic)||monotonic<0||monotonic>Number.MAX_SAFE_INTEGER)fail('INVALID_ARGUMENT','Invalid or changed monotonic clock frame');
 return {bootId,wall,monotonic};
}
export function leaseWindow(observed,millis,bounds) {
 if(!Number.isSafeInteger(millis)||millis<1||millis>30000)fail('INVALID_ARGUMENT','Lease duration requires 1–30000 integer milliseconds');
 const result=Core.lease_window(wallCount(observed.wall),count(millis),list(bounds.map(wallCount)));
 if(result?.$==='ClockExpired')fail('LEASE_STALE','No remaining lease interval','reconcile');
 if(result?.$==='ClockUnrepresentable')fail('INVALID_ARGUMENT','Lease window exceeds the supported clock representation');
 if(result?.$!=='ClockWindow')fail('INTERNAL','Invalid core lease window');
 const deadline=countValue(result.deadline)+calendarStart,duration=countValue(result.duration);wallCount(deadline);
 if(duration<1||duration>millis)fail('INTERNAL','Invalid core lease interval');
 // The interval is formed in one wall frame before interpolation into the
 // observed fractional monotonic frame. Never add an epoch to that reading.
 const monotonicDeadline=observed.monotonic+duration;
 if(!Number.isFinite(monotonicDeadline)||monotonicDeadline<=observed.monotonic||monotonicDeadline>Number.MAX_SAFE_INTEGER)fail('INVALID_ARGUMENT','Monotonic clock cannot represent the lease interval');
 return {expiresAt:new Date(deadline).toISOString(),meta:{bootId:observed.bootId,monotonicDeadline}};
}
export const leaseFrame=(meta,observed)=>coreBoolean(Core.lease_frame(!!meta,meta?.bootId??'',observed.bootId));
export function leaseExpired(lease,meta,observed) {
 return coreBoolean(Core.lease_expired(!!lease,!!meta,meta?.bootId??'',observed.bootId,rank(observed.wall),instant(lease?.expiresAt),rank(observed.monotonic),rank(meta?.monotonicDeadline??0)));
}
export function leaseValid(lease,meta,observed,principal,input) {
 return coreBoolean(Core.lease_valid(!!lease,lease?.holderId??'',principal,lease?.id??'',input.leaseId,count(lease?.fencingToken??0),count(input.fencingToken),leaseExpired(lease,meta,observed)));
}
export function retryAdmission(cancelled,basis,provider) {
 const result=Core.retry_admission(!!cancelled,basis,provider);if(!['RetryAllowed','RetryCancelled','RetryUnsupported'].includes(result?.$))fail('INTERNAL','Invalid core retry admission');return result.$;
}
export function executionMaintenance(value,meta,observed,capabilityExpiry,grantExpiries) {
 const result=Core.execution_maintenance(runState(value.state),leaseExpired(value.lease,meta,observed),value.intent.limits.deadline!==undefined,instant(value.intent.limits.deadline),rank(observed.wall),rank(capabilityExpiry),list(grantExpiries.map(rank)));
 if(!['ClockKeep','ClockLost','ClockCancelDeadline','ClockCancelAuthority'].includes(result?.$))fail('INTERNAL','Invalid core execution maintenance');return result.$;
}
export function timeDelay(values) {
 if(!Array.isArray(values)||values.length>0x7fffffff)fail('INVALID_ARGUMENT','Timer selection is outside the index domain');
 const result=Core.clock_delay(list(values.map((value,index)=>({$:'ClockCandidate',index,value:rank(value)}))),rank(0));
 if(result?.$==='ClockIdle')return null;if(result?.$==='ClockImmediate')return 0;
 if(result?.$!=='ClockSelected'||!Number.isInteger(result.index)||result.index<0||result.index>=values.length)fail('INTERNAL','Invalid core timer selection');return values[result.index];
}

const scheduleLives={active:'SchActive',completed:'SchCompleted',cancelled:'SchCancelled'};
const scheduleWakes={event:'SchEvent',at:'SchAt',after:'SchAfter',capacity:'SchCapacity'};
const scheduleLife=value=>{if(typeof value!=='string'||!Object.hasOwn(scheduleLives,value))fail('INVALID_ARGUMENT','Unsupported schedule state');return {$:scheduleLives[value]};};
const scheduleWake=value=>{if(typeof value!=='string'||!Object.hasOwn(scheduleWakes,value))fail('INVALID_ARGUMENT','Unsupported schedule wake');return {$:scheduleWakes[value]};};
const scheduleOnce=value=>{if(value!=='once'&&value!=='rearmAfterCompletion')fail('INVALID_ARGUMENT','Unsupported schedule recurrence');return value==='once';};
const size=value=>{if(!Number.isInteger(value)||value<0||value>0x7fffffff)fail('INVALID_ARGUMENT','Collection is outside the core index domain');return value;};
const scheduleBlock=value=>value===-1||value===undefined?{$:'SchNoBlock'}:{$:'SchBlocked',activity:count(value)};
const scheduleFacts=state=>({$:'SchFacts',life:scheduleLife(state.state),sequence:count(state.lastSeq),block:scheduleBlock(state.blockedActivity),pending:size(state.pending.length),active:size(state.activeExecutionIds.length),edge:!!state.edge,fired:!!state.timerFired,pressure:scheduleBlock(state.backpressureActivity)});
const scheduleTag=(value,tags)=>{if(!tags.includes(value?.$))fail('INTERNAL','Invalid core schedule decision');return value.$;};
function textValues(value,bound) {
 const result=[];while(value?.$==='Con'){if(result.length>=bound||typeof value.head!=='string')fail('INTERNAL','Invalid core text collection');result.push(value.head);value=value.tail;}
 if(value?.$!=='Nil')fail('INTERNAL','Invalid core text collection');return result;
}
export const scheduleRoom=value=>coreBoolean(Core.schedule_room(size(value)));
export function scheduleVisible(stored,origin,principal,access) {
 return coreBoolean(Core.schedule_visible(!!stored,!!stored&&access.canIncident(stored.value.incidentId),!!access.operator,!!stored&&access.canRead(stored.ref),origin?.principalId??'',principal,origin?.grant?.id??'',list(access.chain.map(grant=>grant.id))));
}
export const scheduleNeedsEvents=kind=>coreBoolean(Core.schedule_needs_events(scheduleWake(kind)));
export const scheduleBaseline=wake=>coreBoolean(Core.schedule_baseline(scheduleWake(wake.kind),wake.mode==='edge'));
export const scheduleWakeAdmission=schedule=>scheduleTag(Core.schedule_wake_admission(scheduleWake(schedule.wake.kind),scheduleOnce(schedule.recurrence),schedule.wake.resource??''),['SchWakeAllowed','SchTimerRearm','SchUnknownResource']);
export const scheduleMutation=required=>coreBoolean(Core.text_contains(list(required??[]),'expectedRevision'));
export const scheduleScan=(state,context,ended,activity)=>scheduleTag(Core.schedule_scan(scheduleFacts(state),context,!!ended,count(activity)),['SchSkip','SchCancel','SchObserve']);
export function scheduleMode(wake,state,activity,now) {
 const result=Core.schedule_mode(scheduleWake(wake.kind),scheduleFacts(state),count(activity),state.due!==undefined,wallCount(state.due??0),wallCount(now));scheduleTag(result,['SchQuiet','SchEvents','SchTimer','SchCheckCapacity']);
 if(result.$==='SchEvents'&&result.limit!==256)fail('INTERNAL','Invalid core schedule event bound');return result;
}
export function scheduleSelection(ids,subjects) {
 const result=Core.schedule_selection(ids!==undefined,list(ids??[]),subjects!==undefined,list(subjects??[]));scheduleTag(result,['SchSelected','SchUnrestricted']);return result.$==='SchUnrestricted'?undefined:textValues(result.ids,Math.max(ids?.length??0,subjects?.length??0));
}
export const scheduleEventGate=(state,event,activity,types)=>scheduleTag(Core.schedule_event_gate(count(state.lastSeq),count(event.sequence),count(activity),event.type,list(types)),['SchStaleEvent','SchFutureEvent','SchIgnoreEvent','SchInspectEvent']);
export function scheduleObservation(mode,edge,selected) {
 if(mode!=='each'&&mode!=='edge')fail('INVALID_ARGUMENT','Unsupported schedule event mode');const result=Core.schedule_observation(mode==='each',!!edge,!!selected);scheduleTag(result,['SchObservation']);return {fire:coreBoolean(result.fire),edge:coreBoolean(result.edge)};
}
export function scheduleQueue(state,coalesce,sources) {
 const result=Core.schedule_queue(size(state.pending.length),!!coalesce,list(state.pending.at(-1)?.eventIds??[]),list(sources));scheduleTag(result,['SchQueueFull','SchMerge','SchAppend']);return {kind:result.$,...(result.$==='SchQueueFull'?{}:{sources:textValues(result.sources,Math.max(32,sources.length))})};
}
export function scheduleOrder(sequence,emitted) {
 const result=amountValue(Core.schedule_order(count(sequence),count(emitted)));if(result===Infinity)fail('LIMIT_EXCEEDED','Schedule occurrence sequence exhausted');return result;
}
export function scheduleAdvance(state,sequence,activity,nextEdge,fire,enqueued,recurrence) {
 const result=Core.schedule_advance(count(state.lastSeq),count(sequence),count(activity),!!state.edge,!!nextEdge,!!fire,!!enqueued,state.pending.length>0,scheduleOnce(recurrence));scheduleTag(result,['SchAdvance']);return {cursor:countValue(result.cursor),edge:coreBoolean(result.edge),stop:coreBoolean(result.stop),full:coreBoolean(result.full)};
}
export const scheduleCapacityEdge=(old,available,accepted)=>coreBoolean(Core.schedule_capacity_edge(!!old,!!available,!!accepted));
export const scheduleMatches=(state,id)=>coreBoolean(Core.schedule_matches(scheduleLife(state.state),state.pending[0]!==undefined,id,state.pending[0]?.id??''));
export function scheduleCompleted(recurrence) {const result=Core.schedule_completed(scheduleOnce(recurrence));scheduleTag(result,['SchActive','SchCompleted']);return result.$==='SchCompleted'?'completed':'active';}
export const scheduleCancellable=state=>coreBoolean(Core.schedule_cancellable(scheduleLife(state)));
export const scheduleRetryFault=code=>coreBoolean(Core.schedule_retry_fault(code));
export const scheduleWatch=(state,activity)=>coreBoolean(Core.schedule_watch(scheduleFacts(state),count(activity),state.due!==undefined));
export const scheduleReady=(state,activity,coalesce)=>coreBoolean(Core.schedule_ready(scheduleFacts(state),count(activity),!!coalesce,size(state.pending.at(-1)?.eventIds.length??0)));
export function scheduleChoose(entries,states,activity,last) {
 size(entries.length);const candidates=entries.map(([id,stored],index)=>({$:'SchCandidate',index,incident:stored.value.incidentId,order:count(states[id].pending[0]?.order??0),facts:scheduleFacts(states[id])}));
 const result=Core.schedule_choose(last!==undefined,last??'',list(candidates),count(activity));scheduleTag(result,['SchNobody','SchChosen']);if(result.$==='SchNobody')return undefined;
 const index=result.candidate?.index;if(!Number.isInteger(index)||index<0||index>=entries.length)fail('INTERNAL','Invalid core schedule selection');return entries[index];
}
export function scheduleDepends(event,fetch,contextId,scheduleRef) {
 let state=Core.schedule_causality(event.id);const cache=new Map([[event.id,event]]);
 // The core chooses every fetch, visited check, fuel charge and transition.
 // This loop is only a bounded observation port, not a second ancestry engine.
 for(let step=0;step<=128;step++){
  const demand=Core.schedule_causal_demand(state);scheduleTag(demand,['SchIndependent','SchUnresolved','SchSkipCause','SchNeedCause']);
  if(demand.$==='SchIndependent')return false;if(demand.$==='SchUnresolved')return 'unknown';if(demand.$==='SchSkipCause'){state=demand.state;continue;}
  if(typeof demand.id!=='string')fail('INTERNAL','Invalid core causal demand');if(!cache.has(demand.id))cache.set(demand.id,fetch(demand.id));const item=cache.get(demand.id);
  const encoded=item?{$:'SchCause',id:item.id,context:item.contextId,kind:item.type,subjects:list(item.subjectRefs.map(resourceKey)),causes:list(item.causeIds)}:{$:'SchMissingCause'};
  const result=Core.schedule_causal_step(state,encoded,contextId,resourceKey(scheduleRef));scheduleTag(result,['SchDependent','SchUnknownCause','SchNextCause']);
  if(result.$==='SchDependent')return true;if(result.$==='SchUnknownCause')return 'unknown';state=result.state;
 }
 fail('INTERNAL','Core causal walk exceeded its declared observation bound');
}
