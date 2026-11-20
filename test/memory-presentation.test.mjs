import {test} from 'node:test';
import assert from 'node:assert/strict';
import {memoryMap} from '../runtime/memory-presentation.mjs';
import {bytesDigest} from '../runtime/json.mjs';

function packet(count=5){
  const session={runtimeId:'owned-runtime',sessionId:'owned-session'};
  const sources=Array.from({length:count},(_,i)=>{const text=('Distinct original '+i+': 🍃 “only for this task.”\n').repeat(i===0?150:2);return {id:'source-'+i,session,text,digest:bytesDigest(text),authorship:i===1?'assistant':'human',origin:i===1?'referenced-exchange':'submission',observedAt:'2026-11-16T00:00:00Z'};});
  const assessment={dispatchId:'rejected-input-assessment',sequence:19,workingSetId:'current-set',basisAvailability:'retained',incomingSourceIds:['rejected-incoming-original'],explanation:'A checker judgment; not source authority.'};
  return {session,cacheRevision:7,processedThrough:19,observedThrough:22,entries:sources.map(x=>({sourceId:x.id,weight:.7,note:'An attributed description for '+x.id})),sources,omittedSourceIds:['not-delivered-original'],
    pending:[{sequence:20,status:'unknown',dispatchId:'unsettled-job'},{sequence:21,status:'pending'},{sequence:22,status:'pending'}],gaps:[],gapCount:12,
    focus:{workingSetId:'current-set',revision:3},workingSet:{id:'current-set',revision:2,purposeKey:'bounded-task',label:'Current task',purpose:'A conditional local purpose.',returnPoint:'Resume the earlier task when this question is answered.',basisSourceIds:['rejected-incoming-original']},
    lastAssessment:assessment,activeAssessment:assessment,presentation:{maximumBytes:4096},worker:{state:'unknown',reason:'A retained dispatch is unresolved.'}};
}
const decode=text=>JSON.parse(text.slice(text.indexOf('\n')+1));

test('automatic map bounds UTF-8 and omits whole components without changing source identity',()=>{
  const input=packet(10);
  for(const budget of [1024,1536,2048,4096]){
    input.presentation.maximumBytes=budget;
    const text=memoryMap(input),map=decode(text);assert.ok(Buffer.byteLength(text)<=budget);
    assert.equal(map.coverage.pending,3);assert.equal(map.coverage.gaps,12);
    assert.equal(map.omitted.selectedEntries,input.entries.length-map.entries.length);
    assert.equal(map.omitted.entryDescriptions,input.entries.length-map.entries.filter(x=>Object.hasOwn(x,'weight')).length);
    assert.equal(map.omitted.sourceBodies,input.sources.length+input.omittedSourceIds.length-map.sources.length);
    for(const source of map.sources){assert.deepEqual(source,input.sources.find(x=>x.id===source.id));assert.equal(bytesDigest(source.text),source.digest);}
    for(const entry of map.entries)if(entry.note!==undefined)assert.equal(entry.note,input.entries.find(x=>x.sourceId===entry.sourceId).note);
    if(map.workingSet?.purpose===undefined)assert.ok(map.omitted.fields.includes('workingSet.purpose'));
    if(map.lastAssessment?.incomingSourceIds)assert.deepEqual(map.lastAssessment.incomingSourceIds,['rejected-incoming-original']);
    else assert.ok(map.omitted.fields.includes('lastAssessment.incomingSourceIds'));
  }
  assert.ok(decode(memoryMap({...input,presentation:{maximumBytes:4096}})).sources.some(x=>x.authorship==='assistant'),'A delivered exchange body must retain its own attribution');
});

test('automatic map keeps honest recovery omissions under large escaped identities and descriptions',()=>{
  const input=packet(32);input.session={runtimeId:'"\\\n'.repeat(80),sessionId:'\t\r\\'.repeat(80)};
  input.workingSet.purpose='A narrow condition 🍃. '.repeat(150);input.workingSet.returnPoint='Return only when explicitly requested. '.repeat(40);
  for(const entry of input.entries)entry.note='Distinctive description with a qualification “only here” 🍃. '.repeat(25);
  input.presentation.maximumBytes=1024;
  const map=decode(memoryMap(input));
  assert.equal(map.session,undefined);assert.ok(map.omitted.fields.includes('session'));assert.ok(map.omitted.selectedEntries>0);assert.ok(map.omitted.entryDescriptions>0);
  if(!map.activeAssessment)assert.equal(Object.hasOwn(map,'activeAssessment'),false,'An omitted existing assessment must not be represented as absent');
  assert.ok(Buffer.byteLength(memoryMap(input))<=1024);
  assert.throws(()=>memoryMap(input,1),{code:'LIMIT_EXCEEDED'});
});

test('presentation limits remain distinct from explicit evidence and cap a local override',()=>{
  const input=packet(1),original=structuredClone(input);
  const bounded=memoryMap(input,262144);assert.ok(Buffer.byteLength(bounded)<=4096);assert.equal(decode(bounded).sources.length,0);
  input.presentation.maximumBytes=262144;
  const whole=decode(memoryMap(input));assert.deepEqual(whole.sources,input.sources);
  assert.ok(Buffer.byteLength(memoryMap(input,1536))<=1536);
  assert.deepEqual({...input,presentation:original.presentation},original,'Packing must not rewrite original evidence or its packet');
});

test('automatic maps preserve upstream partial-read qualifications rather than calling missing notes complete',()=>{
  const input=packet(5);delete input.entries[0].note;delete input.workingSet.purpose;
  input.omittedFields=['/entries/0/note','/workingSet/purpose'];input.omittedWorkingSetIds=['a-dormant-set'];
  const map=decode(memoryMap(input));assert.equal(map.omitted.readFields,2);assert.equal(map.omitted.workingSets,1);
  assert.deepEqual(map.readOmissions.fields,input.omittedFields);assert.deepEqual(map.readOmissions.workingSetIds,['a-dormant-set']);assert.ok(map.omitted.entryDescriptions>=1);
  input.omittedFields=Array.from({length:32},(_,i)=>'/entries/'+i+'/note');input.presentation.maximumBytes=1024;
  const compact=decode(memoryMap(input));assert.equal(compact.omitted.readFields,32);assert.ok(Buffer.byteLength(memoryMap(input))<=1024);
  if(!compact.readOmissions)assert.ok(compact.omitted.fields.includes('readOmissions'));
});
