import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup,schema,atom,grant,incident,limits } from './helpers.mjs';
import { zeroUsage } from '../runtime/executions.mjs';

export const evidence={ sources:[],artifactDigests:[],method:'test provider observation' };
export const budget={ ...limits,cpuMillis:200,memoryBytes:1024,outputBytes:512 };
export const outcome={ kind:'succeeded',output:'verified',evidence };
export const usage={ ...zeroUsage(),cpuMillis:1,memoryBytes:128,outputBytes:10 };
export function fixture(t,options={}) {
  const f=setup(t,options),incidentId=randomUUID();assert.equal(f.write('incident.create',{ id:incidentId,incident }).ok,true);
  const s=schema(f),capability={ id:randomUUID(),providerId:f.ownerId,name:'fixture.verify',version:'1',inputSchema:s,outputSchema:s,features:['bytes'],platform:{ os:process.platform,architecture:process.arch },isolation:'none',reconciliation:options.reconciliation ?? 'lookup',evidence,expiresAt:new Date((options.clock?.wall() ?? Date.now())+3600000).toISOString() };
  const advertised=f.write('capability.advertise',{ capability });assert.equal(advertised.ok,true,JSON.stringify(advertised));
  const ctx=f.call('context.get',{ contextId:f.contextId }).value;
  const initial=f.call('control.get',{ contextId:f.contextId,ref:ctx.policy }).value.value;
  const policy={ ...initial,id:randomUUID(),parent:ctx.policy,rules:initial.rules.map(rule=>({ ...rule,actions:[...rule.actions,capability.name] })) };
  const stored=f.write('policy.publish',{ policy });assert.equal(stored.ok,true);assert.equal(f.write('policy.activate',{ policy:stored.value.ref,evidence }).ok,true);
  const authorized=grant(f,f.ownerId,{ actions:['execution.request',capability.name],resourceRefs:[advertised.value.ref],limits:options.grantLimits ?? options.limits ?? limits });
  const intent=()=>({ id:randomUUID(),incidentId,capability:advertised.value.ref,grant:authorized.ref,input:'fixture',limits:budget });
  const request=()=>{ const value=intent(),result=f.write('execution.request',{ execution:value });assert.equal(result.ok,true,JSON.stringify(result));return result.value; };
  const get=id=>f.call('execution.get',{ contextId:f.contextId,executionId:id });
  const claim=id=>{ const result=f.write('execution.claim',{ executionId:id,leaseMillis:15000 });assert.equal(result.ok,true,JSON.stringify(result));return result.value; };
  const leaseInput=value=>({ executionId:value.intent.id,leaseId:value.lease.id,fencingToken:value.lease.fencingToken });
  const running=id=>{ const leased=claim(id),result=f.write('execution.heartbeat',{ ...leaseInput(leased),leaseMillis:15000 });assert.equal(result.ok,true,JSON.stringify(result));return result.value; };
  const proof=()=>{ const record=atom(s);assert.equal(f.write('graph.transact',{ changes:[{ kind:'record.put',record }] }).ok,true);return { ...evidence,sources:[{ systemId:f.systemId,contextId:f.contextId,id:record.id }] }; };
  return { ...f,get kernel() { return f.kernel; },get store() { return f.store; },get,claim,running,leaseInput,intent,request,proof,capability,authorized,capRef:advertised.value.ref };
}
