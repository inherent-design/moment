import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../runtime/semantic-core.mjs';

test('topology handles a long chain and its closing edge without native recursion overflow',()=>{
 const size=10000,chain=Array.from({length:size-1},(_,source)=>({source,target:source+1}));
 const original=structuredClone(chain);
 assert.equal(core.topologyCheck(size,chain,true),'TopGood');
 assert.equal(core.topologyCheck(size,[...chain,{source:size-1,target:0}],true),'TopCycle');
 assert.deepEqual(chain,original,'Affine core storage must not mutate caller inputs');
 assert.equal(core.topologyCertify(size,chain,Array.from({length:size},(_,i)=>i)),'TopGood');
 assert.equal(core.topologyCertify(size,chain,Array(size).fill(0)),'TopInvalid');
});

test('logical topology bounds precede padded-array indexing and parent conflict',()=>{
 for(const edge of [{source:3,target:0},{source:0,target:3},{source:0xffffffff,target:0}]){
  assert.equal(core.topologyCheck(3,[edge],false),'TopInvalid');
  assert.equal(core.topologyCheck(3,[{source:0,target:1},{source:0,target:2},edge],true),'TopInvalid');
 }
 assert.equal(core.topologyCheck(0,[],true),'TopGood');
 assert.equal(core.topologyCheck(0,[{source:0,target:0}],true),'TopInvalid');
 assert.equal(core.topologyCheck(3,[{source:0,target:1},{source:0,target:1}],true),'TopGood');
 assert.equal(core.topologyCheck(3,[{source:0,target:1},{source:0,target:2}],true),'TopParents');
 assert.equal(core.topologyCheck(3,[{source:0,target:1},{source:0,target:2}],false),'TopGood');
});

test('topology codecs refuse unrepresentable counts, indices, certificates and enum keys',()=>{
 for(const size of [-1,1.5,NaN,Infinity,2**31,'3'])assert.throws(()=>core.topologyCheck(size,[],true),{code:'INVALID_ARGUMENT'});
 for(const index of [-1,1.5,NaN,Infinity,2**32,'0'])assert.throws(()=>core.topologyCheck(3,[{source:index,target:0}],true),{code:'INVALID_ARGUMENT'});
 for(const ranks of [[],[0],[0,NaN],[0,-1],[0,2**32],[0,0.5]])assert.throws(()=>core.topologyCertify(2,[],ranks),{code:'INVALID_ARGUMENT'});
 assert.throws(()=>core.topologyCertify(2,[{source:0,target:2}],[0,1]),{code:'INVALID_ARGUMENT'});
 for(const key of ['constructor','__proto__','toString','TopMaybe'])assert.throws(()=>core.topologyCombine([key]),{code:'INTERNAL'});
 assert.equal(core.topologyCertify(2,[{$:'hostile',source:0,target:1}],[0,1]),'TopGood');
});

test('large independent support lists and scope verdicts remain bounded stack operations',()=>{
 const roles=Object.fromEntries(['child','parent','perspective'].map(id=>[id,[{id}]]));
 const record={kind:'relation',schema:{name:'moment.within'},roles};
 const withdrawn=Array(16000).fill('withdrawn');
 assert.deepEqual(core.topologyRecord(record,withdrawn,'context'),{kind:'skip'});
 assert.deepEqual(core.topologyRecord(record,[...withdrawn,'asserted'],'context'),{kind:'within',scope:'perspective',source:'child',target:'parent'});
 assert.equal(core.topologyCombine(Array(12000).fill('TopGood')),'TopGood');
 assert.equal(core.topologyCombine(['TopCycle',...Array(12000).fill('TopGood'),'TopParents']),'TopParents');
});
