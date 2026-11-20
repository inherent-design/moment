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
