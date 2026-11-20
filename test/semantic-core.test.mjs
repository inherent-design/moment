import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../runtime/semantic-core.mjs';
import {evaluate,evaluatePolicy} from '../runtime/conditions.mjs';
import {checkAxioms} from '../scripts/core-correspondence.mjs';

test('proof admission preserves unknown axiom and missing-audit refusals',()=>{
 assert.deepEqual(checkAxioms("'Moment.valid' depends on axioms: [propext]",['Moment.valid']),[{name:'Moment.valid',axioms:['propext']}]);
 for(const axiom of ['sorryAx','Moment.assumeSuccess','Lean.ofReduceBool'])assert.throws(()=>checkAxioms("'Moment.valid' depends on axioms: ["+axiom+"]",['Moment.valid']),/Unapproved proof axiom/);
 assert.throws(()=>checkAxioms("'Moment.other' does not depend on any axioms",['Moment.valid']),/Missing transitive axiom audit/);
});

test('native binary64 values retain ordering through the two-limb Bend codec',()=>{
 const numbers=[-Number.MAX_VALUE,-(2**53),-Number.MAX_SAFE_INTEGER,-(2**32),-1.5,-1,-Number.MIN_VALUE,-0,0,Number.MIN_VALUE,0.1,0.5,1,1.5,2**32,Number.MAX_SAFE_INTEGER,2**53,Number.MAX_VALUE];
 let word=0x12345678;for(let i=0;i<128;i++){const bytes=new DataView(new ArrayBuffer(8));word=(Math.imul(word,1664525)+1013904223)>>>0;bytes.setUint32(0,word);word=(Math.imul(word,1664525)+1013904223)>>>0;bytes.setUint32(4,word);const n=bytes.getFloat64(0);if(Number.isFinite(n))numbers.push(n);}
 for(const a of numbers)for(const b of numbers)assert.equal(core.lessOrEqual(a,b),a<=b,`${a} <= ${b}`);
 for(const value of [NaN,Infinity,-Infinity,'1',null,undefined,1n])assert.throws(()=>core.lessOrEqual(value,1),{code:'INVALID_ARGUMENT'});
 assert.deepEqual(core.numberRank(-0),core.numberRank(0));
});

test('all tri-valued combinations agree with the declared policy and logic tables',()=>{
 const values=[true,false,'unknown'];
 const and=[[true,false,'unknown'],[false,false,false],['unknown',false,'unknown']],or=[[true,true,true],[true,false,'unknown'],[true,'unknown','unknown']];
 const policy=[['deny','deny','deny'],['permit','deny','indeterminate'],['indeterminate','indeterminate','indeterminate']];
 for(let i=0;i<3;i++)for(let j=0;j<3;j++){
  assert.equal(core.all([values[i],values[j]]),and[i][j]);assert.equal(core.any([values[i],values[j]]),or[i][j]);
  assert.equal(core.policyDecision([{effect:'deny',result:values[i]},{effect:'permit',result:values[j]}]),policy[i][j]);
 }
 assert.equal(core.all([]),true);assert.equal(core.any([]),false);assert.equal(core.policyDecision([]),'deny');
 assert.equal(core.sameValue({b:2,a:'α🙂'},{a:'α🙂',b:2}),true);
});

test('bounded native traversal preserves eager query order and stops queries beyond the core budget',()=>{
 const observed=[],query=i=>({kind:'exists',selector:{ids:[String(i)]}}),tree={kind:'all',terms:[query(1),query(2),query(3)]};
 const result=evaluate(tree,{bindings:{},maxNodes:3,exists:q=>{observed.push(q.ids[0]);return true;}});
 assert.equal(result,'unknown');assert.deepEqual(observed,['1','2']);
 const policy={rules:[{effect:'deny',actions:['read'],when:query(1)},{effect:'permit',actions:['read'],when:query(2)}]};
 assert.equal(evaluatePolicy(policy,'read',{bindings:{},exists:q=>q.ids[0]==='1'?undefined:true}),'indeterminate');
});

test('compiled support transitions retain missing, conflicting and irreversibly withdrawn identities',()=>{
 assert.equal(core.recordEdit(false,false),'Insert');assert.equal(core.recordEdit(true,true),'Keep');assert.equal(core.recordEdit(true,false),'Conflict');
 for(const same of [false,true]){
  assert.equal(core.assertionEdit(false,same,'absent'),'Missing');assert.equal(core.assertionEdit(true,same,'withdrawn'),'Conflict');
 }
 assert.equal(core.assertionEdit(true,false,'absent'),'Insert');assert.equal(core.assertionEdit(true,true,'asserted'),'Keep');
 assert.equal(core.sameScope({},{}),false);assert.equal(core.sameReference({},{}),false);
});
