import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../runtime/semantic-core.mjs';
const ref=id=>({systemId:'system',contextId:'context',id});
const schema={name:'input',version:'1',digest:'schema-digest'};
const item={ref:ref('cap'),value:{providerId:'provider',name:'verify',version:'1',inputSchema:schema,outputSchema:schema,features:['bytes'],isolation:'process',expiresAt:new Date(1000).toISOString()}};
const requirement={name:'verify',versions:['1'],inputSchema:schema,outputSchema:schema,features:['bytes'],acceptableIsolation:['process']};
const chain=[{actions:['verify'],resourceRefs:[ref('cap')],incidentIds:'all'}];

test('compatibility cannot substitute for observed policy or missing incident scope',()=>{
 const compatible=core.capabilityBasis(item,requirement,chain,'incident',999);assert.equal(compatible.$,'CapNeedsPolicy');
 assert.deepEqual(core.capabilityFinish(compatible,'missing'),{unmet:['policy_unknown'],eligibility:'unknown'});
 assert.deepEqual(core.capabilityFinish(compatible,'unknown'),{unmet:['policy_unknown'],eligibility:'unknown'});
 assert.deepEqual(core.capabilityFinish(compatible,'denied'),{unmet:['policy'],eligibility:'ineligible'});
 assert.deepEqual(core.capabilityFinish(compatible,'allowed'),{unmet:[],eligibility:'eligible'});
 const scoped=[{...chain[0],incidentIds:['incident']}],missing=core.capabilityBasis(item,requirement,scoped,undefined,999);
 assert.deepEqual(core.capabilityFinish(missing,'allowed'),{unmet:['incident_required'],eligibility:'unknown'});
 const expired=core.capabilityBasis(item,requirement,chain,'incident',1000);
 assert.deepEqual(core.capabilityFinish(expired,'allowed'),{unmet:['expired'],eligibility:'ineligible'});
 assert.deepEqual(core.capabilityFinish(core.capabilityBasis(item,requirement,[],'incident',999),'allowed'),{unmet:['grant'],eligibility:'ineligible'});
});

test('grant and schema matching retain complete identity and ordered unmet reasons',()=>{
 for(const grantRef of [{...ref('cap'),systemId:'foreign'},{...ref('cap'),contextId:'foreign'}]){
  const basis=core.capabilityBasis(item,requirement,[{...chain[0],resourceRefs:[grantRef]}],'incident',999);
  assert.deepEqual(core.capabilityFinish(basis,'allowed'),{unmet:['grant'],eligibility:'ineligible'});
 }
 const mixed={...requirement,versions:[],inputSchema:{...schema,version:'2'},outputSchema:{...schema,digest:'other'},features:['missing'],acceptableIsolation:[]};
 const basis=core.capabilityBasis(item,mixed,[{...chain[0],actions:[],incidentIds:[]}],undefined,1000);
 assert.deepEqual(core.capabilityFinish(basis,'allowed'),{unmet:['version','inputSchema','outputSchema','features','isolation','expired','grant','incident_required'],eligibility:'ineligible'});
});

test('ranking uses eligibility, unmet count and stable identity without relabeling unknown results',()=>{
 const match=(id,eligibility,unmet=[])=>({capability:{ref:ref(id)},eligibility,unmet});
 const eligible=match('z','eligible'),unknown=match('a','unknown',['policy_unknown']),bad=match('0','ineligible',['version']);
 assert.equal(core.capabilityCompare(eligible,unknown),-1);assert.equal(core.capabilityCompare(unknown,bad),-1);
 assert.equal(core.capabilityCompare(bad,match('z','ineligible',[])),1);
 assert.equal(core.capabilityCompare(match('a','ineligible'),match('b','ineligible')),-1);assert.equal(core.capabilityCompare(eligible,eligible),0);
 for(const unsupported of ['toString','constructor','__proto__']){
  assert.throws(()=>core.capabilityFinish({$:'CapNeedsPolicy'},unsupported),error=>error.code==='INVALID_ARGUMENT');
  assert.throws(()=>core.capabilityCompare(match('a',unsupported),eligible),error=>error.code==='INVALID_ARGUMENT');
 }
 for(const malformed of [{...requirement,versions:[1]},{...requirement,inputSchema:{...schema,version:1}},{...requirement,features:null}])assert.throws(()=>core.capabilityBasis(item,malformed,chain,'incident',999),error=>error.code==='INVALID_ARGUMENT');
 for(const timestamp of [1000,new Date(1000),null]){
  assert.throws(()=>core.executionDeadline(timestamp,999),error=>error.code==='INVALID_ARGUMENT');
  assert.throws(()=>core.executionAdmission({...item.value,expiresAt:timestamp},999,'open',{status:'open'}),error=>error.code==='INVALID_ARGUMENT');
 }
});
