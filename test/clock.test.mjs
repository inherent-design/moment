import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../runtime/semantic-core.mjs';

test('clock observations refuse invalid calendars, monotonic readings and changed boots',()=>{
 const clock=(wall=0,monotonic=0)=>({bootId:'boot',wall:()=>wall,monotonic:()=>monotonic});
 for(const wall of [NaN,Infinity,0.1,-62167219200001,253402300800000,'0'])assert.throws(()=>core.observeClock(clock(wall)),{code:'INVALID_ARGUMENT'});
 for(const mono of [NaN,Infinity,-1,2**53,'0'])assert.throws(()=>core.observeClock(clock(0,mono)),{code:'INVALID_ARGUMENT'});
 let reads=0;assert.throws(()=>core.observeClock({get bootId(){return reads++?'new':'old';},wall:()=>0,monotonic:()=>0}),{code:'INVALID_ARGUMENT'});
 assert.deepEqual(core.observeClock(clock(0,0.125)),{bootId:'boot',wall:0,monotonic:0.125});
});

test('lease windows preserve integer calendar bounds and fractional monotonic origins',()=>{
 const start=-62167219200000,end=253402300799999;
 for(const wall of [start,0,Date.parse('2026-11-20T12:00:00.000Z'),end-30000])for(const millis of [1,1000,30000]){
  const observed={bootId:'boot',wall,monotonic:0.1};
  for(const bounds of [[],[wall],[wall+1],[wall+50,wall+1000],[wall+30000]]){
   const expected=Math.min(wall+millis,...bounds);
   if(expected<=wall){assert.throws(()=>core.leaseWindow(observed,millis,bounds),{code:'LEASE_STALE'});continue;}
   const result=core.leaseWindow(observed,millis,bounds);assert.equal(Date.parse(result.expiresAt),expected);assert.equal(result.meta.monotonicDeadline,0.1+(expected-wall));assert.equal(result.meta.bootId,'boot');
  }
 }
 const observed={bootId:'boot',wall:0,monotonic:0};
 for(const millis of [0,-1,0.5,30001,'1'])assert.throws(()=>core.leaseWindow(observed,millis,[]),{code:'INVALID_ARGUMENT'});
 assert.throws(()=>core.leaseWindow({...observed,monotonic:Number.MAX_SAFE_INTEGER},1,[]),{code:'INVALID_ARGUMENT'});
});

test('timer and fence codecs keep their numeric domains and conservative idle/immediate states',()=>{
 assert.equal(core.timeDelay([]),null);assert.equal(core.timeDelay([1.25,0.5,2]),0.5);assert.equal(core.timeDelay([1,-0.25,2]),0);
 for(const value of [NaN,Infinity,-Infinity,'1'])assert.throws(()=>core.timeDelay([value]),{code:'INVALID_ARGUMENT'});
 assert.equal(core.fenceNext(2**32-1),2**32);assert.equal(core.fenceNext(Number.MAX_SAFE_INTEGER-1),Number.MAX_SAFE_INTEGER);
 assert.equal(core.fenceEqual(2**32,0),false);assert.throws(()=>core.fenceNext(Number.MAX_SAFE_INTEGER),{code:'LIMIT_EXCEEDED'});
 for(const value of [-1,NaN,Infinity,2**53])assert.throws(()=>core.fenceEqual(1,value),{code:'INVALID_ARGUMENT'});
});
