import assert from 'node:assert/strict';
import * as core from '../runtime/semantic-core.mjs';

/** Audit the explicitly claimed Lean declarations and their transitive axioms. */
export function checkAxioms(output,claims) {
 const allowed=new Set(['propext','Classical.choice','Quot.sound']),audits=new Map();
 for(const line of output.split('\n')){const match=line.match(/^'([^']+)' (does not depend on any axioms|depends on axioms: \[([^\]]*)\])$/);if(!match)continue;const deps=match[3]?match[3].split(',').map(x=>x.trim()):[];if(deps.some(x=>!allowed.has(x)))throw Error('Unapproved proof axiom for '+match[1]+': '+deps.join(', '));if(audits.has(match[1]))throw Error('Duplicate axiom audit');audits.set(match[1],deps);}
 for(const claim of claims)if(!audits.has(claim))throw Error('Missing transitive axiom audit: '+claim);
 return claims.map(name=>({name,axioms:audits.get(name)}));
}

/** Compare the actual Lean evaluator and generated Bend/native consumer. */
export function checkCorrespondence(output) {
 const truth=value=>value==='true'?true:value==='false'?false:value==='unknown'?'unknown':(()=>{throw Error('Unknown model truth');})();
 const rows=output.split('\n').filter(line=>line.startsWith('case|'));
 assert.equal(rows.length,1730,'The complete declared finite correspondence set must be present');
 const counts={},seen=new Set(),choose=(values,mask)=>values.filter((_value,i)=>Number(mask)&2**i);
 const when={kind:'equal',left:{kind:'literal',value:true},right:{kind:'literal',value:true}},rules=[
  {id:'read',effect:'permit',when,actions:['read']},{id:'write',effect:'permit',when,actions:['write']},
  {id:'deny',effect:'deny',when,actions:['read']},{id:'both',effect:'permit',when,actions:['read','write']}
 ];
 for(const row of rows){const [,kind,...parts]=row.split('|'),expected=parts.pop(),key=[kind,...parts].join('|');let actual;
  assert.ok(!seen.has(key),'Duplicate model input: '+key);seen.add(key);counts[kind]=(counts[kind]??0)+1;
  const a=['not','all','any','policy','record','assertion'].includes(kind)?truth(parts[0]):undefined;
  if(kind==='not')actual=String(core.not(a));
  else if(kind==='all'||kind==='any')actual=String(core[kind]([a,truth(parts[1])]));
  else if(kind==='policy')actual=core.policyDecision([{effect:'deny',result:a},{effect:'permit',result:truth(parts[1])}]);
  else if(kind==='record')actual=core.recordEdit(a,truth(parts[1]));
  else if(kind==='assertion')actual=core.assertionEdit(a,truth(parts[1]),parts[2]);
  else if(kind==='withdraw')actual=core.withdrawEdit(parts[0]);
  else if(kind==='graph'){
   const changes=(parts[0]==='-'?[]:[...parts[0]]).map((flag,i)=>({kind:flag==='1'?'record.put':'assertion.withdraw',index:i}));actual=core.graphOrder(changes).map(change=>change.index).join(',');
  }
  else if(kind==='grant'){
   const [depth,repeated,scope,present,revoked,expiry,principal]=parts,seen=Array.from({length:Number(depth)},(_,i)=>i===0&&truth(repeated)?'leaf':'seen-'+i);
   const ref={systemId:truth(scope)?'system':'foreign',contextId:'context',id:'leaf'},value={principalId:truth(principal)?'caller':'other',...(Number(expiry)?{expiresAt:new Date(Number(expiry)).toISOString()}:{})};
   actual=core.grantLink({systemId:'system',id:'context'},ref,seen,truth(present)?{value}:undefined,truth(revoked),'caller',200);
  }
  else if(kind==='grantEnd')actual=core.grantEnd(Number(parts[0])?['leaf']:[]);
  else if(kind==='policyRules')actual=core.policyRules(choose(rules,parts[0]),choose(rules,parts[1]),choose(['read','write'],parts[2]));
  else if(kind==='issuers')actual=core.policyIssuers(choose(['a','b'],parts[0]),choose(['a','b'],parts[1]));
  else throw Error('Unknown model case');
  assert.equal(actual,expected,'Native/model correspondence mismatch: '+row);
 }
 assert.deepEqual(counts,{not:3,all:9,any:9,policy:9,record:4,assertion:12,withdraw:3,graph:63,grant:576,grantEnd:2,policyRules:1024,issuers:16});
 return {cases:rows.length,counts,coverage:'Finite complete truth/support tables; all record/support orderings through length five; grant scope, expiry, principal, repeat and depth boundary matrix; all subsets of four declared rules and two grant actions; issuer sets',limitations:['Finite exhaustive correspondence only within the named input sets, not every possible policy or graph','Theorems concern their stated models; the compiler/translation and native adapters remain explicit trust boundaries','Numeric codecs and native effects require their independent execution checks']};
}
