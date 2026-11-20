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
