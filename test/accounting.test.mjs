import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../runtime/semantic-core.mjs';

const zero=()=>({cpuMillis:0,memoryBytes:0,outputBytes:0,modelTokens:0,apiSpendMicrounits:0,concurrentExecutions:0});
test('word counts agree with independent BigInt arithmetic across safe-integer boundaries',()=>{
 const values=[0,1,2,2**32-1,2**32,2**32+1,2**48-1,2**48,2**48+1,Number.MAX_SAFE_INTEGER-1,Number.MAX_SAFE_INTEGER];
 let word=0xa1b2c3d4;for(let i=0;i<64;i++){word=(Math.imul(word,1664525)+1013904223)>>>0;const high=word&0x1fffff;word=(Math.imul(word,1664525)+1013904223)>>>0;values.push(high*2**32+word);}
 const maximum=BigInt(Number.MAX_SAFE_INTEGER);
 for(const a of values)for(const b of values){const sum=BigInt(a)+BigInt(b);assert.equal(core.resourceAdd(a,b),sum>maximum?Infinity:Number(sum),`Exact count sum ${a}+${b}`);assert.equal(core.resourceLessOrEqual(a,b),BigInt(a)<=BigInt(b));}
 for(const invalid of [-1,0.5,NaN,Infinity,2**53,'1',1n,undefined])assert.throws(()=>core.resourceAdd(invalid,0),{code:'INVALID_ARGUMENT'});
});

test('large reservation folds retain charges, scope and overflow without mutating callers',()=>{
 const entry=(grant)=>({origin:{grantIds:[grant,'shared']},value:{state:'succeeded',intent:{limits:{...zero(),cpuMillis:3}},usage:{...zero(),cpuMillis:1,unmeasured:['cpuMillis']}}});
 const entries=Array.from({length:4096},(_,i)=>entry(i%2?'a':'b')),first=structuredClone(entries[0]);
 assert.equal(core.resourceTotals(entries).cpuMillis,4096*3);assert.equal(core.resourceTotals(entries,'a').cpuMillis,2048*3);
 assert.deepEqual(core.resourceTotals(entries,'missing'),zero());assert.deepEqual(entries[0],first);
 const huge=entry('a');huge.value.usage.cpuMillis=Number.MAX_SAFE_INTEGER;
 const total=core.resourceTotals([huge,huge],'shared');assert.equal(total.cpuMillis,Infinity);assert.equal(total.concurrentExecutions,0);
 assert.equal(core.resourceCapacity(total,zero(),{...zero(),cpuMillis:Number.MAX_SAFE_INTEGER}),false);
 assert.throws(()=>core.resourceCapacity(zero(),zero(),{...zero(),cpuMillis:Infinity}),{code:'INVALID_ARGUMENT'});
});
