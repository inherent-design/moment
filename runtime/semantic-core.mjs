import {sqliteOrdinal} from './sqlite-ordinal.mjs';
import {canonical,fail} from './json.mjs';
import {tokens} from './pointers.mjs';
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
export function counterAdd(value,extra,label='Resource counter') {const next=resourceAdd(value,extra);if(next===Infinity)fail('LIMIT_EXCEEDED',label+' exhausted');return next;}
export function counterNext(value,label='Journal counter') {
 return counterAdd(value,1,label);
}
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

const codecText=value=>{if(typeof value!=='string')fail('INVALID_ARGUMENT','Semantic codec requires text fields');return value;};
const codecTexts=values=>{if(!Array.isArray(values))fail('INVALID_ARGUMENT','Semantic codec requires a text collection');size(values.length);return list(values.map(codecText));};
const capSchema=value=>{if(!value||typeof value!=='object')fail('INVALID_ARGUMENT','Semantic codec requires a schema reference');return {$:'CapSchema',name:codecText(value.name),version:codecText(value.version),digest:codecText(value.digest)};};
const capAdvertisement=(value,ref)=>({$:'CapAdvertisement',identity:resourceKey(ref),provider:codecText(value.providerId),name:codecText(value.name),version:codecText(value.version),input:capSchema(value.inputSchema),output:capSchema(value.outputSchema),features:codecTexts(value.features),isolation:codecText(value.isolation)});
const capRequirement=value=>({$:'CapRequirement',versions:codecTexts(value.versions),input:capSchema(value.inputSchema),output:capSchema(value.outputSchema),features:codecTexts(value.features),isolation:codecTexts(value.acceptableIsolation)});
const capEligibilityTags={eligible:'CapEligible',ineligible:'CapIneligible',unknown:'CapUnknown'};
const capEligibility=value=>{if(typeof value!=='string'||!Object.hasOwn(capEligibilityTags,value))fail('INVALID_ARGUMENT','Unsupported capability eligibility');return {$:capEligibilityTags[value]};};
const capTag=(value,tags)=>{if(!tags.includes(value?.$))fail('INTERNAL','Invalid core capability decision');return value.$;};
export function capabilityBasis(item,requirement,chain,incident,now) {
 const scopes=chain.map(grant=>({$:'CapScope',actions:codecTexts(grant.actions),resources:list(grant.resourceRefs.map(resourceKey)),all_incidents:grant.incidentIds==='all'}));
 const result=Core.capability_basis(capAdvertisement(item.value,item.ref),capRequirement(requirement),list(scopes),instant(codecText(item.value.expiresAt)),rank(now),incident!==undefined);capTag(result,['CapNeedsPolicy','CapAssessment']);return result;
}
export function capabilityFinish(basis,policy) {
 const policies={allowed:'CapPolicyAllowed',denied:'CapPolicyDenied',unknown:'CapPolicyUnknown',missing:'CapPolicyMissing'};
 if(typeof policy!=='string'||!Object.hasOwn(policies,policy))fail('INVALID_ARGUMENT','Unsupported capability policy observation');
 const result=Core.capability_finish(basis,{$:policies[policy]});capTag(result,['CapAssessment']);
 const eligibility={CapEligible:'eligible',CapIneligible:'ineligible',CapUnknown:'unknown'}[capTag(result.eligibility,['CapEligible','CapIneligible','CapUnknown'])];
 return {unmet:textValues(result.unmet,8),eligibility};
}
export function capabilityCompare(left,right) {
 const result=Core.capability_compare(capEligibility(left.eligibility),size(left.unmet.length),left.capability.ref.id,capEligibility(right.eligibility),size(right.unmet.length),right.capability.ref.id);capTag(result,['LT','EQ','GT']);return {LT:-1,EQ:0,GT:1}[result.$];
}
export function capabilityPublish(capability,ref,principal,methods,retained,now) {
 return capTag(Core.capability_publish(capAdvertisement(capability,ref),principal,codecTexts(methods),size(retained),instant(codecText(capability.expiresAt)),rank(now)),['CapPublishAllowed','CapRetentionFull','CapWrongProvider','CapReservedName','CapExpired']);
}
export const capabilitySelected=(item,requested,readable)=>coreBoolean(Core.capability_selected(codecText(item.value.name),codecText(requested),!!readable));
export const executionRoom=value=>coreBoolean(Core.execution_room(size(value)));
export function executionAdmission(capability,now,context,incident) {
 return capTag(Core.execution_admission(instant(codecText(capability.expiresAt)),rank(now),context,!!incident,incidentState(incident?.status??'open')),['CapExecutionAllowed','CapExecutionExpired','CapExecutionClosed','CapExecutionIncident']);
}
export const executionDeadline=(deadline,now)=>coreBoolean(Core.execution_deadline(deadline!==undefined,instant(deadline===undefined?undefined:codecText(deadline)),rank(now)));
export function executionPrepare(intent,actor,requester,access,bound) {
 return capTag(Core.execution_prepare(access.canIncident(intent.incidentId),access.canRead(intent.capability),!!access.operator,actor,requester,resourceKey(intent.grant),bound?resourceKey(bound):'',access.canRead(intent.grant)),['CapPrepareAllowed','CapPrepareScope','CapPrepareGrant']);
}
export function executionVisible(stored,origin,principal,access) {
 const intent=stored?.value.intent;
 return coreBoolean(Core.execution_visible(!!stored,!!origin,!!intent&&access.canIncident(intent.incidentId),!!access.operator,principal,origin?.principalId??'',origin?.providerId??'',origin?.grantIds?.[0]??'',list(access.chain.map(grant=>grant.id)),!!intent&&access.canRead(intent.capability),!!stored&&access.canRead(stored.ref)));
}
export const executionReconcile=(principal,provider,operator,readable)=>coreBoolean(Core.execution_reconcile(principal,provider,!!operator,!!readable));
export const executionEvidence=(required,sources)=>coreBoolean(Core.execution_evidence(!!required,list(sources.map(resourceKey))));

const pqTag=(value,tags)=>{if(!tags.includes(value?.$))fail('INTERNAL','Invalid core policy-query decision');return value.$;};
export function policyQueryAvailable(budget) {
 pqTag(budget,['PQBudget','PQExhausted']);if(budget.$==='PQBudget'&&(!Number.isInteger(budget.remaining)||budget.remaining<0||budget.remaining>32768))fail('INTERNAL','Invalid core policy-query budget');return coreBoolean(Core.policy_query_available(budget));
}
export const policyQueryInitial=(records,assertions)=>{const result=Core.policy_query_initial(size(records),size(assertions));policyQueryAvailable(result);return result;};
function indexValues(value,bound) {
 const indices=[],seen=new Set();while(value?.$==='Con'){const index=value.head;if(!Number.isInteger(index)||index<0||index>=bound||seen.has(index))fail('INTERNAL','Invalid core index projection');indices.push(index);seen.add(index);value=value.tail;}
 if(value?.$!=='Nil')fail('INTERNAL','Invalid core index projection');return indices;
}
export function policyQueryProjection(snapshot,issuers) {
 const initial=policyQueryInitial(snapshot.records.length,snapshot.assertions.length);if(!policyQueryAvailable(initial))return undefined;
 const assertions=snapshot.assertions.map((item,index)=>({$:'PQAssertion',index,system:codecText(item.assertion.ref.systemId),context:codecText(item.assertion.ref.contextId),issuer:codecText(item.assertion.recordedBy),record:codecText(item.assertion.value.record.id),sources:size(item.assertion.value.evidence.sources.length)}));
 const projection=Core.policy_query_projection(list(assertions),codecText(snapshot.context.systemId),codecText(snapshot.context.id),codecTexts(issuers),initial);pqTag(projection,['PQProjection']);if(!policyQueryAvailable(projection.budget))return undefined;
 if(!Number.isInteger(projection.provenance)||projection.provenance<0||projection.provenance>32768)fail('INTERNAL','Invalid core provenance count');
 return {budget:projection.budget,indices:indexValues(projection.indices,snapshot.assertions.length),records:textValues(projection.records,snapshot.assertions.length),provenance:projection.provenance};
}
export const policyQuerySupported=(status,sources,access)=>coreBoolean(Core.policy_query_supported(codecText(status),list(sources.map(ref=>coreBoolean(access.canRead(ref))))));
export const policyQueryObserved=(found,operator)=>({PQYes:true,PQNo:false,PQUnknown:'unknown'})[pqTag(Core.policy_query_observed(!!found,!!operator),['PQYes','PQNo','PQUnknown'])];
export const policyQueryCharge=(budget,costs)=>{const result=Core.policy_query_charges(list(costs.map(size)),budget);policyQueryAvailable(result);return result;};
export function policyQueryExistsBudget(budget,trusted,provenance,related) {
 const roles=related?trusted.records.flatMap(({value})=>value.kind==='relation'?Object.values(value.roles).map(refs=>size(refs.length)):[]):[];
 const result=Core.policy_query_exists_budget(budget,size(trusted.records.length),size(trusted.assertions.length),size(provenance),list(roles));policyQueryAvailable(result);return result;
}
export function policyQueryEndpoint(context,value,access) {
 const ref=typeof value==='string'?{systemId:context.systemId,contextId:context.id,id:value}:value;
 // Literal operands are data, not already validated Ref values. Check the sort
 // before canonical key encoding or a current scope lookup can be attempted.
 if(!scoped(ref)||typeof ref.id!=='string')return undefined;
 if(!Core.same_scope(context.systemId,context.id,ref.systemId,ref.contextId)||!access.canRead(ref))return undefined;
 return resourceKey(ref);
}
export function policyQueryRelated(budget,records,supported,names,start,end,hops,access) {
 if(!Number.isInteger(hops)||hops<1||hops>8)fail('INVALID_ARGUMENT','Policy relationship hops require 1–8');
 const schemas=codecTexts(names),selected=records.filter(item=>coreBoolean(Core.policy_query_selected(item.value.kind,item.value.schema.name,schemas,access.canRead(item.ref),supported.has(item.ref.id))));
 const headers=selected.map((item,index)=>({$:'PQHeader',index,subjects:size(item.value.roles.subject?.length??0),objects:size(item.value.roles.object?.length??0)}));
 const plan=Core.policy_query_plan(list(headers),budget);pqTag(plan,['PQPlan']);policyQueryAvailable(plan.budget);
 const indices=indexValues(plan.indices,selected.length),edges=indices.map(index=>{
  const record=selected[index].value,subjects=record.roles.subject??[],targets=record.roles.object??[];
  return {$:'PQEdge',subject_count:count(subjects.length),target_count:count(targets.length),subjects:list(subjects.map(resourceKey)),targets:list(targets.map(ref=>({$:'PQTarget',key:resourceKey(ref),readable:coreBoolean(access.canRead(ref))})))};
 });
 // An omitted suffix could not fit even the first source's remaining budget.
 // The explicit sentinel keeps that lack of observation unknown. Only the
 // core's selected prefix is decoded; its role payload is bounded by 32768.
 if(coreBoolean(plan.omitted))edges.push({$:'PQOmittedEdge'});
 const result=Core.policy_query_related(list(edges),codecText(start),codecText(end),hops,!!access.operator,budget);pqTag(result,['PQDone']);policyQueryAvailable(result.budget);
 return {budget:result.budget,value:({PQYes:true,PQNo:false,PQUnknown:'unknown'})[pqTag(result.verdict,['PQYes','PQNo','PQUnknown'])]};
}

export const policyQuerySelected=(record,names,readable,asserted)=>coreBoolean(Core.policy_query_selected(codecText(record.kind),codecText(record.schema.name),codecTexts(names),!!readable,!!asserted));

const controlTag=(value,tags)=>{if(!tags.includes(value?.$))fail('INTERNAL','Invalid core control decision');return value.$;};
const controlChanges=changes=>list(changes.map(change=>change.kind==='assertion.withdraw'?{$:'ExistingChange'}:{$:'DeclaredChange',id:codecText(change.kind==='record.put'?change.record.id:change.assertion.id)}));
const revisionText=value=>{if(!Number.isSafeInteger(value)||value<0)fail('INVALID_ARGUMENT','Revisions require safe nonnegative integers');return String(value);};
export function projectionPlan(fields,groupBy) {
 if(!Array.isArray(fields)||![undefined,'record','schema'].includes(groupBy))fail('INVALID_ARGUMENT','Invalid projection shape');
 if(!coreBoolean(Core.control_projection_room(size(fields.length))))return 'ProjectionTooMany';
 const paths=list(fields.map(pointer=>({$:'ProjectionPath',tokens:codecTexts(tokens(codecText(pointer)))})));
 return controlTag(Core.control_projection(size(fields.length),paths,groupBy==='schema'),['ProjectionAllowed','ProjectionTooMany','ProjectionUnknown','ProjectionSchemaHidden']);
}
export function proposalAdmission(proposal,expected,currentPolicy) {
 return controlTag(Core.control_proposal(codecText(proposal.id),revisionText(proposal.basisRevision),revisionText(expected),resourceKey(proposal.policy),resourceKey(currentPolicy),controlChanges(proposal.changes),size(proposal.executions.length)),['ProposalAllowed','ProposalStale','ProposalEmpty','ProposalAlias']);
}
export function commitAdmission(stored,current) {
 return controlTag(Core.control_commit(codecText(stored.value.state),revisionText(stored.revision),revisionText(current.context.revision),resourceKey(stored.value.proposal.policy),resourceKey(current.context.policy)),['CommitAllowed','CommitTerminal','CommitStale']);
}
export function proposalPlan(proposal) {
 const items=list(proposal.executions.map(intent=>({$:'PlanExecution',id:codecText(intent.id),incident:codecText(intent.incidentId)})));
 return controlTag(Core.control_plan(codecText(proposal.id),codecText(proposal.incidentId),controlChanges(proposal.changes),items),['PlanAllowed','PlanIncident','PlanAlias']);
}
export function transitionVisible(stored,origin,principal,access) {
 return coreBoolean(Core.control_visible(!!stored,!!stored&&access.canIncident(stored.value.proposal.incidentId),!!access.operator,origin?.principalId??'',codecText(principal),origin?.grantId??'',codecTexts(access.chain.map(grant=>grant.id)),!!stored&&access.canRead(stored.ref)));
}
export const controlNamespace=names=>coreBoolean(Core.control_namespace(codecTexts(names)));
export const grantRevocable=(operator,target,bound,issuer,principal,chain)=>coreBoolean(Core.control_revoke(!!operator,resourceKey(target),bound?resourceKey(bound):'',codecText(issuer),codecText(principal),codecTexts(chain.map(grant=>resourceKey({...target,id:grant.id})))));
export const grantActions=(requested,installed,capabilities)=>coreBoolean(Core.control_actions(codecTexts(requested),codecTexts(installed),codecTexts(capabilities)));
export const schemaAdmission=(schema,installed,actual,old)=>controlTag(Core.control_schema(codecText(schema.name),!!installed,codecText(schema.digest),codecText(actual),!!old,old?.value.schema.digest??''),['SchemaAllowed','SchemaReserved','SchemaDigest','SchemaConflict']);
export const ruleBindings=names=>coreBoolean(Core.control_bindings(codecTexts(names)));
export const boundGrantSelected=(operator,submitted,bound)=>coreBoolean(Core.control_bound(!!operator,!!submitted,!!bound,submitted?resourceKey(submitted):'',bound?resourceKey(bound):''));
export const textContains=(values,value)=>coreBoolean(Core.text_contains(codecTexts(values),codecText(value)));

export const reactionSource=(event,revision)=>controlTag(Core.reaction_source(!!event,count(event?.revision??0),count(revision)),['ReactionSourceMissing','ReactionNeedsVisibility']);
export const reactionEvent=(visible,kind,types)=>controlTag(Core.reaction_event(!!visible,codecText(kind),codecTexts(types)),['ReactionEventHidden','ReactionEventSkip','ReactionEventUse']);
export const reactionMode=(events,requested,types)=>controlTag(Core.reaction_mode(size(events),size(requested),size(types)),['ReactionEvents','ReactionOnce','ReactionNone']);
export const reactionBegin=()=>Core.reaction_begin();
const reactionProgress=value=>{controlTag(value,['ReactionPending','ReactionMatched']);if(value.$==='ReactionPending'&&typeof value.unresolved!=='boolean')fail('INVALID_ARGUMENT','Invalid reaction observation state');return value;};
export function reactionObserve(progress,value) {
 if(![true,false,'unknown'].includes(value))fail('INVALID_ARGUMENT','Reaction observation requires a three-valued condition result');
 return reactionProgress(Core.reaction_observe(reactionProgress(progress),truth(value)));
}
export const reactionFinish=progress=>controlTag(Core.reaction_finish(reactionProgress(progress)),['ReactionEligible','ReactionIndeterminate','ReactionIneligible']);
export function resourceCompare(left,right) {const result=Core.resource_compare(count(left),count(right));controlTag(result,['LT','EQ','GT']);return {LT:-1,EQ:0,GT:1}[result.$];}

const awarenessTag=(value,tags)=>{if(!tags.includes(value?.$))fail('INTERNAL','Invalid core awareness decision');return value.$;};
export function awarenessDetail(stored,message,incident,scope,access) {
 const value=stored.value,roles=Object.values(value.roles??{}).flat(),sources=[...(stored.evidence?.sources??[]),...(value.evidence?.sources??[]),...(value.continuation??[])];
 return awarenessTag(Core.awareness_detail(!!message,codecText(value.kind??''),list(roles.map(ref=>coreBoolean(access.canRead(ref)))),!!incident,!!scope,list(sources.map(ref=>coreBoolean(access.canRead(ref))))),['DetailAllowed','DetailMailbox','DetailRelation','DetailIncident','DetailDependencies']);
}
export const messageVisible=(stored,principal,incident)=>coreBoolean(Core.awareness_message_visible(!!stored,codecText(stored?.value.recipientId??''),codecText(principal),!!incident));
export const messageAdmission=(retained,bytes,incident,scope,live)=>awarenessTag(Core.awareness_message(size(retained),count(bytes),!!incident,!!scope,!!live),['MessageAllowed','MessageRetention','MessageSummary','MessageIncident','MessageExpired']);
export function messageReply(message,principal,parent) {
 const encoded=message.inReplyTo===undefined?{$:'NoParent'}:!parent?{$:'MissingParent'}:{$:'ReplyParent',kind:codecText(parent.value.kind),incident:codecText(parent.value.incidentId),recipient:codecText(parent.value.recipientId),sender:codecText(parent.recordedBy)};
 return awarenessTag(Core.awareness_reply(codecText(message.kind),codecText(message.incidentId),codecText(principal),codecText(message.recipientId),encoded),['ReplyReady','ReplyRequired','ReplyUnavailable','ReplyNeedsVisibility']);
}
export function recipientCandidates(snapshot,principal,owner) {
 if(coreBoolean(Core.awareness_recipient_mode(codecText(principal),codecText(owner))))return [undefined];
 const grants=Object.values(snapshot.controlState.grants??{});size(grants.length);
 const result=Core.awareness_recipients(list(grants.map((grant,index)=>({$:'RecipientGrant',index,principal:codecText(grant.value.principalId)}))),principal);
 awarenessTag(result,['RecipientCandidates','RecipientFull']);if(result.$==='RecipientFull')fail('LIMIT_EXCEEDED','Recipient grant lookup exceeds its bound');
 return indexValues(result.indices,grants.length).map(index=>grants[index].ref);
}
export const messageSelected=(include,acknowledged)=>coreBoolean(Core.awareness_selected(!!include,!!acknowledged));
export function messageCompare(left,right) {const result=Core.awareness_message_compare(count(left.revision),codecText(left.ref.id),count(right.revision),codecText(right.ref.id));awarenessTag(result,['LT','EQ','GT']);return {LT:-1,EQ:0,GT:1}[result.$];}
export const promptTemplate=(template,current,expected)=>coreBoolean(Core.awareness_template(codecText(template.value.kind??''),canonical(template.value.schema??null),canonical(expected),resourceKey(template.ref),resourceKey(current.ref)));
export function templateSupported(assertions,template,issuers,access) {
 const items=list(assertions.map(item=>({$:'TemplateSupport',record:resourceKey(item.assertion.value.record),issuer:codecText(item.assertion.recordedBy),status:codecText(item.status),sources:list(item.assertion.value.evidence.sources.map(ref=>coreBoolean(access.canRead(ref))))})));
 return coreBoolean(Core.awareness_supported(items,resourceKey(template),codecTexts(issuers)));
}
export const promptSlots=(count,declared,optional,markers,malformed)=>coreBoolean(Core.awareness_slots(size(count),size(declared.length),codecTexts(declared),codecTexts(optional),codecTexts(markers),!!malformed));
export const promptCandidates=(declared,optional)=>textValues(Core.awareness_prompt_candidates(codecTexts(declared),codecTexts(optional)),32);
export function promptStep(candidates,used,maximum) {
 const result=Core.awareness_prompt_step(codecTexts(candidates),count(used),count(maximum));awarenessTag(result,['PromptFits','PromptRequired','PromptOmit']);
 if(result.$!=='PromptOmit')return {kind:result.$};return {kind:result.$,slot:codecText(result.slot),remaining:textValues(result.remaining,32)};
}
export const eventRefRoute=(local,message,readable,incident,execution,schedule)=>awarenessTag(Core.awareness_ref_route(!!local,!!message,!!readable,!!incident,!!execution,!!schedule),['RefMailbox','RefAllowed','RefDenied','RefIncident','RefExecution','RefSchedule']);
export function eventScanRequest(items,limit,scanned) {const result=Core.awareness_scan_request(size(items),size(limit),size(scanned));if(!Number.isInteger(result)||result<0||result>256)fail('INTERNAL','Invalid event scan request');return result;}

export function eventVisible(operator,event,context,fetch,canRef) {
 const root=codecText(event?.id??''),events=new Map([[root,event]]),encodedEvents=new Map(),refs=new Map();let state=Core.visibility_start(!!operator,root),limit=129;
 // The core owns traversal, repeated pops, alternative groups and short-circuit
 // reference demands. This loop supplies observations and a representation-bound
 // sanity limit, not another visibility algorithm.
 for(let step=0;step<=limit;step++) {
  const demand=Core.visibility_demand(state);awarenessTag(demand,['VisibilityComplete','VisibilityContinue','VisibilityNeedEvent','VisibilityNeedRef']);
  if(demand.$==='VisibilityComplete')return coreBoolean(demand.visible);
  if(demand.$==='VisibilityContinue'){state=demand.state;continue;}
  if(demand.$==='VisibilityNeedRef') {
   const key=codecText(demand.key);if(!refs.has(key))fail('INTERNAL','Core requested an unobserved reference');
   state=Core.visibility_ref(state,coreBoolean(canRef(refs.get(key))));continue;
  }
  const id=codecText(demand.id);if(!events.has(id))events.set(id,fetch(id));const value=events.get(id);let encoded=encodedEvents.get(id)??{$:'VisibilityMissingEvent'};
  if(value&&!encodedEvents.has(id)) {
   const alternatives=value.visibilityAlternatives??[value.visibilityRefs??value.subjectRefs];if(!Array.isArray(alternatives))fail('INVALID_ARGUMENT','Visibility alternatives require a reference collection');
   let slots=0;
   const groups=list(alternatives.map(group=>{if(!Array.isArray(group))fail('INVALID_ARGUMENT','Visibility requirements require a reference collection');size(group.length);slots+=group.length;return {$:'VisibilityGroup',refs:list(group.map(ref=>{if(!scoped(ref)||typeof ref.id!=='string')fail('INVALID_ARGUMENT','Visibility requires scoped reference identities');const key=resourceKey(ref);refs.set(key,ref);return key;}))};}));
   // Every admitted node consumes one core pop, so this allowance is added at
   // most64 times. Repeated/cached observations cannot enlarge it again.
   limit=resourceAdd(limit,slots);if(limit===Infinity)fail('INTERNAL','Visibility observation bound is not representable');
   encoded={$:'VisibilityEvent',id:codecText(value.id),context:codecText(value.contextId),groups,causes:codecTexts(value.causeIds)};
   encodedEvents.set(id,encoded);
  }
  state=Core.visibility_event(state,encoded,codecText(context));
 }
 fail('INTERNAL','Core visibility traversal exceeded its observed representation bound');
}


const guidanceTag=(value,tags)=>{if(!tags.includes(value?.$))fail('INTERNAL','Invalid core guidance decision');return value.$;};
export const guidancePath=(rootHost,root,pathHost,selected)=>coreBoolean(Core.guidance_path(codecText(rootHost),codecTexts(root),codecText(pathHost),codecTexts(selected)));
export const guidanceRegistration=(normalized,previous,retained,definitionDigest)=>guidanceTag(Core.guidance_registration(!!normalized,!!previous,size(retained),coreBoolean(Core.same_text(previous?.value.definitionDigest??'',codecText(definitionDigest)))),['GuidanceInvalidPaths','GuidanceRegistryFull','GuidanceNewSource','GuidanceSameSource','GuidanceChangedSource']);
export const guidanceRefresh=(active,storage)=>guidanceTag(Core.guidance_refresh(!!active,!!storage),['GuidanceWithdrawn','GuidanceNoStorage','GuidanceObserve']);
export const guidanceRetained=(retained,maximumCount,total,extra,maximumBytes)=>coreBoolean(Core.guidance_retained(count(retained),count(maximumCount),count(total),count(extra),count(maximumBytes)));
export const guidanceObservationError=(code,domain)=>guidanceTag(Core.guidance_observation_error(codecText(code??''),!!domain),['GuidanceMissing','GuidanceDenied','GuidanceTooLarge','GuidanceChanged','GuidanceUnsupported','GuidanceRethrow']);
export const guidanceSelected=(explicit,active,located,matches)=>coreBoolean(Core.guidance_selected(!!explicit,!!active,!!located,list(matches.map(coreBoolean))));
export const guidanceReviewSize=retained=>guidanceTag(Core.guidance_review_size(size(retained)),['GuidanceNoSources','GuidanceSourceBound','GuidanceSourcesReady']);
export const guidanceReviewSource=(active,observation)=>coreBoolean(Core.guidance_review_source(!!active,codecText(observation??'')));
export const guidanceReviewBytes=lengths=>coreBoolean(Core.guidance_review_bytes(list(lengths.map(count))));
export function guidanceCurrent(source,capture) {
 const value=source?.value;
 return coreBoolean(Core.guidance_current(!!value,!!value?.active,codecText(value?.definitionDigest??''),codecText(capture?.value.definitionDigest??''),codecText(value?.latest?.state??''),value?.latest?.capture?resourceKey(value.latest.capture):'',capture?resourceKey(capture.ref):''));
}
export const guidanceBasis=(stored,expected)=>guidanceTag(Core.guidance_basis(!!stored,codecText(stored?.digest??''),codecText(expected)),['GuidanceBasisUnavailable','GuidanceBasisChanged','GuidanceBasisCurrent']);
export const guidancePolicy=(actualRef,expectedRef,actualDigest,expectedDigest)=>coreBoolean(Core.guidance_policy(resourceKey(actualRef),resourceKey(expectedRef),codecText(actualDigest),codecText(expectedDigest)));
const guidanceProfileCodec=value=>({$:'GuidanceProfile',provider:codecText(value.providerId),name:codecText(value.name),version:codecText(value.version),input:canonical(value.inputSchema),output:canonical(value.outputSchema),isolation:codecText(value.isolation),reconciliation:codecText(value.reconciliation),features:canonical(value.features)});
export const guidanceProfileMatches=(actual,expected)=>coreBoolean(Core.guidance_profile(guidanceProfileCodec(actual),guidanceProfileCodec(expected)));
export const guidanceProfileAvailable=(compatible,readable,expiresAt,now)=>coreBoolean(Core.guidance_profile_available(!!compatible,!!readable,instant(codecText(expiresAt)),rank(now)));
export const guidanceGrant=(grant,principal,capability,access)=>coreBoolean(Core.guidance_grant(codecText(principal),codecText(grant.value.principalId),codecTexts(grant.value.actions),codecTexts(grant.value.resourceRefs.map(resourceKey)),resourceKey(capability),!!access.operator,codecText(grant.ref.id),codecText(access.chain[0]?.id??'')));
export const guidanceCandidate=(state,blocked,settlement)=>coreBoolean(Core.guidance_candidate(runState(state),!!blocked,!!settlement));
export function guidanceCandidateCompare(left,leftKey,right,rightKey) {const result=Core.guidance_candidate_compare(runState(left),codecText(leftKey),runState(right),codecText(rightKey));guidanceTag(result,['LT','EQ','GT']);return {LT:-1,EQ:0,GT:1}[result.$];}
export const guidanceResult=(kind,failure,raw)=>guidanceTag(Core.guidance_result(codecText(kind??''),!!failure,!!raw),['GuidanceNotStarted','GuidanceCancelled','GuidanceFailed','GuidanceUnknownOutput','GuidanceProject']);
export const guidanceQuote=(matches,editorial)=>guidanceTag(Core.guidance_quote(size(matches),!!editorial),['GuidanceQuoteUnanchored','GuidanceQuoteExact','GuidanceQuoteAmbiguous','GuidanceQuoteEditorial']);
export const guidanceEditorial=(present,matches,ascii)=>coreBoolean(Core.guidance_editorial(!!present,size(matches),!!ascii));

export const guidanceCaptureRoom=retained=>coreBoolean(Core.guidance_capture_room(size(retained)));

export const guidanceSettlement=(state,blocked)=>coreBoolean(Core.guidance_settlement(runState(state),!!blocked));


const memoryTag=(value,tags)=>{if(!tags.includes(value?.$))fail('INTERNAL','Invalid core memory decision');return value.$;};
export const memoryTerminal=status=>coreBoolean(Core.memory_terminal(codecText(status??'')));
export const memoryPending=status=>coreBoolean(Core.memory_pending(codecText(status??'')));
export const memoryGap=status=>coreBoolean(Core.memory_gap(codecText(status??'')));
export const memoryUser=authorship=>coreBoolean(Core.memory_user(codecText(authorship)));
export const memoryFocusSource=source=>coreBoolean(Core.memory_focus_source(codecText(source.authorship),codecText(source.origin)));
export function memorySelection(cache,incoming,focus,sources,capacity) {
 const bound=counterAdd(counterAdd(cache.length,incoming.length),focus.length),selectableSourceIds=textValues(Core.memory_selectable(codecTexts(cache),codecTexts(incoming),codecTexts(focus)),bound);
 const contextOnlySourceIds=textValues(Core.memory_context(codecTexts(sources),codecTexts(selectableSourceIds)),sources.length);
 const maximumEntries=resourceAvailable([{used:0,ceiling:capacity},{used:0,ceiling:selectableSourceIds.length}]);
 return {selectableSourceIds,contextOnlySourceIds,maximumEntries};
}
export const memoryFocusHeader=(current,expected)=>memoryTag(Core.memory_focus_header(count(current),count(expected)),['MemoryFocusStale','MemoryFocusNeedsProjection']);
export const memoryFocusProjection=projection=>memoryTag(Core.memory_focus_projection(!!projection),['MemoryProjectionChanged','MemoryFocusReady']);
export const memoryFocusSelect=(present,seed,retained,maximum)=>memoryTag(Core.memory_focus_select(!!present,!!seed,count(retained),count(maximum)),['MemorySetFull','MemorySeedForExisting','MemoryCreateSet','MemoryReuseSet']);
export function memoryFocusRelease(present,pending,released,current,replacement) {
 const result=Core.memory_focus_release(!!present,!!pending,codecText(released),codecText(current),replacement!==undefined,codecText(replacement??''));memoryTag(result,['MemoryReleaseMissing','MemoryReleasePending','MemoryReleaseReplacement','MemoryReleaseUnexpected','MemoryReleaseTarget']);
 return result.$==='MemoryReleaseTarget'?{kind:result.$,id:codecText(result.id)}:{kind:result.$};
}
export const memoryFocusChanged=(created,edited,target,current)=>coreBoolean(Core.memory_focus_changed(!!created,!!edited,codecText(target),codecText(current)));
export const memoryConfigure=(current,expected,retained,maximum,requested)=>memoryTag(Core.memory_configure(count(current.revision),count(expected),count(retained),count(maximum),!!current.enabled,!!requested),['MemoryConfigurationStale','MemoryConfigurationFull','MemoryConfigurationChange','MemoryConfigurationSame']);
export const memoryDisableInput=(enabled,input)=>coreBoolean(Core.memory_disable_input(!!enabled,!!input.automatic,codecText(input.status)));
export const memoryEnrollment=(current,expected)=>memoryTag(Core.memory_enrollment(!!current.enabled,count(current.revision),count(expected)),['MemoryEnrollmentDisabled','MemoryEnrollmentStale','MemoryEnrollmentReady']);
export const memoryAdmission=(present,explicit,automatic,focus,sequence,maximumInputs,pending,maximumPending)=>memoryTag(Core.memory_admission(!!present,!!explicit,!!automatic,count(focus),count(sequence),count(maximumInputs),count(pending),count(maximumPending)),['MemoryTargetMissing','MemoryTargetAmbiguous','MemoryInputFull','MemoryBacklogFull','MemoryInputReady']);
export const memoryClaim=(active,pending)=>memoryTag(Core.memory_claim(!!active,!!pending),['MemoryBusy','MemoryIdle','MemoryLoadInput']);
export function memoryCompletionBasis(state,binding,target,focus,dispatch) {
 return memoryTag(Core.memory_basis(!!target,codecText(target?.id??''),dispatch.workingSetId!==undefined,codecText(dispatch.workingSetId??''),count(target?.revision??0),count(dispatch.workingSetRevision??dispatch.cacheRevision),count(state.processedThrough),count(dispatch.processedThrough),count(focus.revision),count(dispatch.focusRevision??binding.focusRevision),codecText(focus.workingSetId),count(state.revision),count(dispatch.cacheRevision)),['MemoryBasisIdentity','MemoryBasisStale','MemoryBasisActive','MemoryBasisDormant']);
}
export const memoryOutput=(failure,bounded,schema,replace)=>memoryTag(Core.memory_output(!!failure,!!bounded,!!schema,!!replace),['MemoryObservedFailure','MemoryInvalidOutput','MemoryKeepEntries','MemoryCheckSelection']);
export const memoryEntrySelection=(selected,eligible,capacity)=>memoryTag(Core.memory_selection(count(selected.length),count(capacity),codecTexts(selected),codecTexts(eligible)),['MemorySelectionBound','MemorySelectionUnknown','MemorySelectionReady']);
export const memoryReconcile=(active,id,kind)=>memoryTag(Core.memory_reconcile(!!active,codecText(active?.id??''),codecText(id),codecText(active?.status??''),codecText(kind??'')),['MemoryReconcileInvalid','MemoryReconcileOutput','MemoryReconcileFailure','MemoryReconcileRetry','MemoryReconcileCancelled']);
export const memoryCancelUncertain=(active,key,sequence)=>coreBoolean(Core.memory_cancel_uncertain(!!active,codecText(active?.key??''),codecText(key),count(active?.sequence??0),count(sequence)));
export const memoryCancelStatus=status=>codecText(Core.memory_cancel_status(codecText(status)));
export const memoryAutomation=(subscription,issue)=>memoryTag(Core.memory_automation(!!subscription.enabled,!!issue,!!subscription.lastIntake,count(subscription.revision),count(subscription.lastIntake?.subscriptionRevision??0)),['MemoryAutomationOff','MemoryAutomationUnavailable','MemoryAutomationObserved','MemoryAutomationAwaiting']);

export const memoryObservation=authorship=>memoryTag(Core.memory_observation(codecText(authorship)),['MemoryObservationReject','MemoryObservationSkip','MemoryObservationQueue']);
export const memoryHeadDue=(status,sequence,processed)=>coreBoolean(Core.memory_head_due(codecText(status),count(sequence),count(processed)));
const memoryOrdinal=value=>{
 const biased=sqliteOrdinal(value)+(1n<<63n);return {$:'MemoryOrdinal',high:Number(biased>>32n),low:Number(biased&0xffffffffn)};
};
export function memoryNextHead(heads) {
 const value=Core.memory_next_head(list(heads.map((head,index)=>({$:'MemoryHead',index:size(index),order:memoryOrdinal(head.order),status:codecText(head.input.status),sequence:count(head.input.sequence),processed:count(head.processedThrough)}))));
 memoryTag(value,['MemoryNoHead','MemoryNextHead']);if(value.$==='MemoryNoHead')return undefined;
 if(!Number.isInteger(value.index)||value.index<0||value.index>=heads.length)fail('INTERNAL','Invalid selected memory head');return value.index;
}

export const memoryRebuildBasis=(explicit,cache,expectedCache,working,expectedWorking)=>coreBoolean(Core.memory_rebuild_basis(!!explicit,count(cache),count(expectedCache??0),count(working),count(expectedWorking??0)));
export const memoryDispatch=(active,id,preparing=false)=>coreBoolean(Core.memory_dispatch(!!active,codecText(active?.id??''),codecText(id),codecText(active?.status??''),!!preparing));


const memoryAdapterTag=(value,tags)=>{if(!tags.includes(value?.$))fail('INTERNAL','Invalid core memory adapter decision');return value.$;};
const nativePhase=item=>({present:item.phase!==undefined,value:typeof item.phase==='string'?item.phase:''});
export const memoryVisibleAssistant=item=>{const phase=nativePhase(item);return coreBoolean(Core.memory_adapter_visible_assistant(codecText(item.role),phase.present,phase.value));};
export const memoryFrame=item=>{const phase=nativePhase(item);return memoryAdapterTag(Core.memory_adapter_frame(codecText(item.role),phase.present,phase.value),['MemoryExchangeFrame','MemoryUserFrame','MemoryIgnoredFrame']);};
export function memoryLatestExchange(frames) {
 const value=Core.memory_adapter_exchange(list(frames.map((frame,index)=>{const phase=nativePhase(frame.item);return {$:'MemoryFrame',index:size(index),role:codecText(frame.item.role),phase_present:phase.present,phase:phase.value,output_parts:count(frame.outputParts)};})));
 memoryAdapterTag(value,['MemoryNoExchange','MemoryLatestExchange']);if(value.$==='MemoryNoExchange')return undefined;
 if(!Number.isInteger(value.index)||value.index<0||value.index>=frames.length)fail('INTERNAL','Invalid selected memory exchange');return value.index;
}
export const memoryPartsFit=(lengths,maximum)=>coreBoolean(Core.memory_adapter_parts(count(lengths.length),list(lengths.map(count)),count(maximum)));
export const memoryHistoryPart=(provenance,bytes,maximum)=>memoryAdapterTag(Core.memory_adapter_history_part(codecText(typeof provenance==='string'?provenance:''),count(bytes),count(maximum)),['MemoryHarnessPart','MemoryOversizePart','MemoryUnknownUserPart']);
export const memoryHistoryFull=(retained,maximum)=>coreBoolean(Core.memory_adapter_history_full(count(retained),count(maximum)));
export const memoryProject=(registry,target,associated)=>coreBoolean(Core.memory_adapter_project(codecText(registry?.systemId??''),codecText(target.systemId),codecText(target.projectId),codecText(target.contextId),list((registry?.projects??[]).map(item=>({$:'MemoryProject',id:codecText(item.id),contexts:codecTexts(item.contextIds??[])}))),codecTexts(associated)));
export const memoryBindingError=code=>memoryAdapterTag(Core.memory_adapter_binding_error(codecText(code)),['MemoryBindingIntegrity','MemoryBindingUnavailable','MemoryBindingComponent']);
export const memoryWorkerMode=(provider,unavailable,active)=>codecText(Core.memory_adapter_worker_mode(!!provider,!!unavailable,!!active));
export function memoryWorkerBootstrap(provider,unavailable,active,recover) {const value=Core.memory_adapter_worker_bootstrap(!!provider,!!unavailable,!!active,!!recover,codecText(active?.status??''));memoryAdapterTag(value,['MemoryWorkerBootstrap']);return {state:codecText(value.state),markUnknown:coreBoolean(value.mark_unknown)};}
export const memoryWorkerEnabled=(closed,provider,unavailable)=>coreBoolean(Core.memory_adapter_worker_enabled(!!closed,!!provider,!!unavailable));
export const memoryWorkerQueueNeeded=(state,active)=>coreBoolean(Core.memory_adapter_worker_queue_needed(codecText(state),!!active));
export function memoryWorkerWake(state,active,pending,busy,scheduled) {const value=Core.memory_adapter_worker_wake(codecText(state),!!active,!!pending,!!busy,!!scheduled);memoryAdapterTag(value,['MemoryWorkerWake']);return {queued:coreBoolean(value.queued),action:memoryAdapterTag(value.action,['MemoryWakeBusy','MemoryWakeScheduled','MemoryWakeSchedule'])};}
export const memoryWorkerDemand=(active,pending)=>memoryAdapterTag(Core.memory_adapter_worker_demand(!!active,!!pending),['MemoryWorkerRecover','MemoryWorkerPrepare','MemoryWorkerIdle']);
export const memoryWorkerFault=(dispatched,current,notStarted)=>memoryAdapterTag(Core.memory_adapter_worker_fault(!!dispatched,!!current,!!notStarted),['MemoryWorkerUnknown','MemoryWorkerNotStarted','MemoryWorkerCleanup','MemoryWorkerUnavailable']);
export const memoryWorkerAgain=(continuing,requested,state,reconciled,closed)=>coreBoolean(Core.memory_adapter_worker_again(!!continuing,!!requested,codecText(state),!!reconciled,!!closed));
export const memoryWorkerCancel=(active,session,sequence,result)=>coreBoolean(Core.memory_adapter_worker_cancel(!!active,canonical(active?.request.session??null),canonical(session),count(active?.sequence??0),count(sequence),codecText(result)));


const retentionKinds={profile:'RetentionProfile',working:'RetentionWorking',assessment:'RetentionAssessment'};
const retentionCategory=category=>{if(typeof category!=='string'||!Object.hasOwn(retentionKinds,category))fail('INVALID_ARGUMENT','Unknown memory retention category');return {$:retentionKinds[category]};};
const retentionTag=(value,tags)=>{if(!tags.includes(value?.$))fail('INTERNAL','Invalid core memory retention decision');return value.$;};
export function memoryValueCategory(kind) {
 const value=Core.memory_retention_classify(codecText(kind));retentionTag(value,['RetentionValueClass','RetentionValueUnknown']);if(value.$==='RetentionValueUnknown')fail('UNSUPPORTED_VERSION','Unrecognized pooled memory value kind; retained bytes need inspection');
 return {RetentionProfile:'profile',RetentionWorking:'working',RetentionAssessment:'assessment'}[retentionTag(value.category,['RetentionProfile','RetentionWorking','RetentionAssessment'])];
}
export function memoryRetentionUsage(category,observed) {
 const value=Core.memory_retention_usage(retentionCategory(category),list(observed.values.map(item=>({$:'RetentionValue',kind:codecText(item.kind),bytes:count(item.bytes)}))),list(observed.assessments.map(count)),list(observed.working.map(count)),list(observed.receipts.map(count)),count(observed.focus),count(observed.bindings));
 retentionTag(value,['RetentionUsage','RetentionUnknownKind']);if(value.$==='RetentionUnknownKind')fail('UNSUPPORTED_VERSION','Unrecognized pooled memory value kind; preserve its bytes before capacity admission');return amountValue(value.amount);
}
export const memoryRetentionPressure=(category,usage,extra,limits)=>retentionTag(Core.memory_retention_pressure(retentionCategory(category),amount(usage),count(extra),count(limits.maxProfileBytes),count(limits.maxWorkingSetBytes),count(limits.maxAssessmentBytes)),['RetentionFits','RetentionRetire','RetentionFull']);
export function memoryCollectValues(values,live,states) {
 const result=Core.memory_retention_collect(list(values.map((value,index)=>({$:'RetentionIdentity',index:size(index),kind:codecText(value.kind),key:codecText(value.kind)+'\0'+codecText(value.digest)}))),codecTexts(live),codecTexts(states));retentionTag(result,['RetentionCollection','RetentionCollectionKind','RetentionCollectionState']);
 if(result.$==='RetentionCollectionKind')fail('UNSUPPORTED_VERSION','Unrecognized pooled memory value kind; collection preserves its bytes');if(result.$==='RetentionCollectionState')fail('UNSUPPORTED_VERSION','Unrecognized assessment state; collection preserves its evidence');return indexValues(result.indices,values.length);
}
export function memoryRetireAssessment(rows,protectedIds) {
 const result=Core.memory_retention_retire(list(rows.map((row,index)=>({$:'RetentionAssessmentRow',index:size(index),order:memoryOrdinal(row.ordinal),id:codecText(row.value.id),basis:!!row.value.basis,status:codecText(row.value.status)}))),codecTexts(protectedIds));retentionTag(result,['RetentionNoCandidate','RetentionCandidate','RetentionUnknownState']);
 if(result.$==='RetentionUnknownState')fail('UNSUPPORTED_VERSION','Unrecognized assessment state; detail retirement preserves its evidence');if(result.$==='RetentionNoCandidate')return undefined;
 if(!Number.isInteger(result.index)||result.index<0||result.index>=rows.length)fail('INTERNAL','Invalid memory retirement selection');return result.index;
}
export const memoryRetentionExcess=(retained,maximum)=>coreBoolean(Core.memory_retention_excess(count(retained),count(maximum)));
export function memoryNativeAvailability(manifest) {
 const value=Core.memory_retention_availability(!!manifest.raw,codecText(manifest.basisAvailability),manifest.rawUnavailable?.reason!==undefined,codecText(manifest.rawUnavailable?.reason??''),codecText(manifest.status));retentionTag(value,['RetentionNativeAvailable','RetentionNativeUnsupported']);if(value.$==='RetentionNativeUnsupported')fail('UNSUPPORTED_VERSION','Unrecognized assessment state or basis; native output availability is unqualified');return codecText(value.value);
}
