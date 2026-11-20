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
 assert.equal(rows.length,46,'The complete declared finite correspondence set must be present');
 for(const row of rows){const [,kind,...parts]=row.split('|'),expected=parts.pop(),a=truth(parts[0]);let actual;
  if(kind==='not')actual=String(core.not(a));
  else if(kind==='all'||kind==='any')actual=String(core[kind]([a,truth(parts[1])]));
  else if(kind==='policy')actual=core.policyDecision([{effect:'deny',result:a},{effect:'permit',result:truth(parts[1])}]);
  else if(kind==='record')actual=core.recordEdit(a,truth(parts[1]));
  else if(kind==='assertion')actual=core.assertionEdit(a,truth(parts[1]),parts[2]);
  else throw Error('Unknown model case');
  assert.equal(actual,expected,'Native/model correspondence mismatch: '+row);
 }
 return {cases:rows.length,coverage:'Every combination for Boolean record presence/digest, three support states, and the three-valued unary/binary logic and policy combinator',limitations:['Finite exhaustive correspondence for these specific operations only','Theorems concern their stated models; the compiler/translation and native adapters remain explicit trust boundaries','Numeric codecs and native effects require their independent execution checks']};
}
