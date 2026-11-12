import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start,stop,cli } from './daemon-fixture.mjs';
import { spawnSync } from 'node:child_process';
import { createClient } from '../runtime/client.mjs';
import { bytesDigest } from '../runtime/json.mjs';
import { installVerifier } from '../runtime/providers/bytes-runtime.mjs';
import { recommendedLimits,receiptSchema } from '../runtime/providers/bytes-definition.mjs';
import { issueCredential } from '../runtime/credentials.mjs';

async function fixture(t,options={}) {
  const root=mkdtempSync(join(tmpdir(),'moment-verifier-rpc-'));let child=await start(root,options);
  t.after(async()=>{ if (child.exitCode===null && child.signalCode===null) await stop(child,options.entrypoint?'SIGKILL':'SIGTERM');rmSync(root,{ recursive:true,force:true }); });
  const client=createClient(root),contextId=randomUUID(),incidentId=randomUUID(),limits={ ...recommendedLimits('USD'),cpuMillis:100000,outputBytes:100000 };
  const call=async(method,input)=>{ const result=await client.call(method,input);assert.equal(result.ok,true,JSON.stringify(result));return result.value; };
  const write=async(method,input)=>{
    for (let count=0;count<16;count++) {
      const target=input.contextId ?? contextId,current=await call('context.get',{ contextId:target }),result=await client.call(method,{ contextId:target,expectedRevision:current.revision,idempotencyKey:randomUUID(),...input });
      if (result.ok) return result.value;assert.equal(result.error.code,'REVISION_CONFLICT',JSON.stringify(result));
    }
    assert.fail('Provider mutation did not settle within its bounded fresh-revision retries');
  };
  await call('context.create',{ id:contextId,label:'Actual bounded verifier',bootstrapProfile:'owner-local',idempotencyKey:'bootstrap',limits });
  await write('incident.create',{ id:incidentId,incident:{ purpose:'Verify explicit bytes and retain a recoverable result',completionCriteria:['Real byte digest and actual receipt'],status:'open',continuation:[] } });
  const registration=await installVerifier(root,contextId);
  const wait=async(id,target=contextId)=>{
    let execution;const until=Date.now()+10000;
    do { execution=await call('execution.get',{ contextId:target,executionId:id });if (['succeeded','failed'].includes(execution.state)) return execution;await new Promise(resolve=>setTimeout(resolve,20)); } while (Date.now()<until);
    assert.fail('Verifier did not produce a terminal result: '+JSON.stringify(execution));
  };
  return { root,contextId,incidentId,call,write,wait,registration,get child() { return child; },async restart() { await stop(child,'SIGKILL');child=await start(root); } };
}

test('the real service installs a verifier, checks file bytes, exposes its result through a view and retains it after restart',async t=>{
  const f=await fixture(t),filename=join(f.root,'fixture.bin');writeFileSync(filename,'Actual file bytes for the connected verifier\n',{ mode:0o600 });const bytes=readFileSync(filename);
  const input={ contentBase64:bytes.toString('base64'),expectedDigest:bytesDigest(bytes) },sourceId=randomUUID(),evidence={ sources:[],artifactDigests:[],method:'Independent attributed fixture observation' };
  const systemId=(await f.call('system.describe',{ protocolVersion:'0.1' })).systemId,sourceRef={ systemId,contextId:f.contextId,id:sourceId };
  await f.write('graph.transact',{ changes:[{ kind:'record.put',record:{ kind:'atom',id:sourceId,schema:f.registration.inputSchema,value:input } },{ kind:'assertion.put',assertion:{ id:randomUUID(),record:sourceRef,evidence } }] });
  const actor=randomUUID(),context=await f.call('context.get',{ contextId:f.contextId }),active=(await f.call('control.get',{ contextId:f.contextId,ref:context.policy })).value;
  const candidate=await f.write('policy.publish',{ policy:{ ...active,id:randomUUID(),parent:context.policy,rules:[...active.rules,{ id:'fixture-source',effect:'permit',actions:['graph.transact'],when:{ kind:'equal',left:{ kind:'binding',name:'principalId' },right:{ kind:'literal',value:actor } } }] } });await f.write('policy.activate',{ policy:candidate.ref,evidence });
  const scope=await f.write('grant.issue',{ grant:{ id:randomUUID(),principalId:actor,actions:['graph.transact'],incidentIds:[f.incidentId],resourceRefs:[sourceRef],delegable:false,limits:f.registration.limits } });
  const actorClient=createClient(f.root,{ credentialFile:issueCredential(f.root,actor,{ [f.contextId]:scope.ref }) });
  const originalIncident=(await f.call('incident.get',{ contextId:f.contextId,incidentId:f.incidentId })).value;
  await f.write('incident.update',{ incidentId:f.incidentId,incident:{ ...originalIncident,status:'resting' },evidence });
  const rule=await f.write('rule.publish',{ rule:{ id:randomUUID(),triggerEventTypes:['graph.transact.committed'],condition:{ kind:'equal',left:{ kind:'literal',value:true },right:{ kind:'literal',value:true } },operation:'incident.update',literalInput:{ contextId:f.contextId,expectedRevision:0,idempotencyKey:'placeholder',incidentId:f.incidentId,incident:originalIncident,evidence },inputBindings:{},limits:f.registration.limits } });
  await f.write('schedule.put',{ schedule:{ id:randomUUID(),incidentId:f.incidentId,rule:rule.ref,wake:{ kind:'event',eventTypes:['graph.transact.committed'],selector:{ ids:[sourceId],assertionStatus:'asserted' },mode:'each' },recurrence:'once',coalesce:false } });
  for (let count=0;count<16;count++) {
    const current=await f.call('context.get',{ contextId:f.contextId });
    const observed=await actorClient.call('graph.transact',{ contextId:f.contextId,expectedRevision:current.revision,idempotencyKey:randomUUID(),changes:[{ kind:'assertion.put',assertion:{ id:randomUUID(),record:sourceRef,evidence } }] });
    if (observed.ok) break;assert.equal(observed.error.code,'REVISION_CONFLICT');if (count===15) assert.fail('Second observer could not obtain a fresh revision');
  }
  let awakened;for (let count=0;count<100;count++) { awakened=await f.call('incident.get',{ contextId:f.contextId,incidentId:f.incidentId });if (awakened.value.status==='open') break;await new Promise(resolve=>setTimeout(resolve,20)); }
  assert.equal(awakened.value.status,'open');
  const observations=await f.call('graph.query',{ contextId:f.contextId,selector:{ ids:[sourceId],assertionStatus:'asserted' },limit:1 });assert.equal(new Set(observations.items[0].support.map(item=>item.assertion.recordedBy)).size,2);
  const intent={ id:randomUUID(),incidentId:f.incidentId,capability:f.registration.capability,grant:f.registration.grant,input,limits:f.registration.limits };
  assert.equal((await f.write('execution.request',{ execution:intent })).state,'queued');const result=await f.wait(intent.id);
  assert.equal(result.state,'succeeded');assert.equal(result.outcome.output.observedDigest,bytesDigest(bytes));assert.ok(result.usage.cpuMillis>0);assert.ok(result.usage.memoryBytes>0);assert.equal(result.usage.modelTokens,0);
  const view=await f.write('view.publish',{ view:{ id:randomUUID(),selector:{ schemaNames:[receiptSchema.name],assertionStatus:'asserted' },fields:['/value/value/result','/value/value/measurement'] } });
  const projected=await f.call('view.read',{ contextId:f.contextId,view:view.ref,limit:10 });assert.equal(projected.records[0].fields['/value/value/result'].matches,true);assert.equal(projected.records[0].fields['/value/value/measurement'].nodeVersion,process.version);
  const receipt=join(f.root,'runtime','verifier',f.contextId,intent.id,'1','receipt.json'),original=readFileSync(receipt);
  await f.restart();const retained=await f.call('execution.get',{ contextId:f.contextId,executionId:intent.id });assert.deepEqual(retained,result);assert.deepEqual(readFileSync(receipt),original);
  assert.equal(existsSync(join(f.root,'runtime','verifier',f.contextId,intent.id,'1','input.bin')),false);
  const second={ ...intent,id:randomUUID() };await f.write('execution.request',{ execution:second });assert.equal((await f.wait(second.id)).state,'succeeded');
});

test('an interrupted daemon reconciles the retained real receipt without another dispatch attempt',async t=>{
  const f=await fixture(t,{ entrypoint:new URL('./interrupted-provider.mjs',import.meta.url) }),bytes=Buffer.from('A real external verification precedes its lost completion report\n');
  const intent={ id:randomUUID(),incidentId:f.incidentId,capability:f.registration.capability,grant:f.registration.grant,input:{ contentBase64:bytes.toString('base64'),expectedDigest:bytesDigest(bytes) },limits:f.registration.limits };
  await f.write('execution.request',{ execution:intent });
  const barrier=join(f.root,'before-finish.json'),until=Date.now()+10000;
  while (!existsSync(barrier) && Date.now()<until) { assert.equal(f.child.exitCode,null);await new Promise(resolve=>setTimeout(resolve,20)); }
  assert.equal(existsSync(barrier),true);assert.equal(JSON.parse(readFileSync(barrier,'utf8')).executionId,intent.id);
  const directory=join(f.root,'runtime','verifier',f.contextId,intent.id),receipt=join(directory,'1','receipt.json'),original=readFileSync(receipt),status=readFileSync(join(directory,'1','status.json'));
  await f.restart();const recovered=await f.wait(intent.id);
  assert.equal(recovered.state,'succeeded');assert.equal(recovered.attempt,1);assert.equal(recovered.outcome.output.observedDigest,bytesDigest(bytes));assert.ok(recovered.outcome.evidence.sources.length);
  assert.deepEqual(readFileSync(receipt),original);assert.deepEqual(readFileSync(join(directory,'1','status.json')),status);assert.deepEqual(readdirSync(directory),['1']);
});

test('equal execution IDs in separate contexts retain separate inputs, receipts and outcomes',async t=>{
  const f=await fixture(t),contextId=randomUUID(),incidentId=randomUUID(),limits={ ...recommendedLimits('USD'),cpuMillis:100000,outputBytes:100000 };
  await f.call('context.create',{ id:contextId,label:'Independent verifier context',bootstrapProfile:'owner-local',idempotencyKey:'second-context',limits });
  await f.write('incident.create',{ contextId,id:incidentId,incident:{ purpose:'Keep context-scoped receipts separate',completionCriteria:['One exact result'],status:'open',continuation:[] } });
  const registration=await installVerifier(f.root,contextId),id=randomUUID(),a=Buffer.from('Context A bytes'),b=Buffer.from('Context B bytes');
  const intent=(incidentId,registration,bytes)=>({ id,incidentId,capability:registration.capability,grant:registration.grant,input:{ contentBase64:bytes.toString('base64'),expectedDigest:bytesDigest(bytes) },limits:registration.limits });
  await f.write('execution.request',{ execution:intent(f.incidentId,f.registration,a) });await f.write('execution.request',{ contextId,execution:intent(incidentId,registration,b) });
  const first=await f.wait(id),second=await f.wait(id,contextId);assert.equal(first.outcome.output.observedDigest,bytesDigest(a));assert.equal(second.outcome.output.observedDigest,bytesDigest(b));assert.equal(first.attempt,1);assert.equal(second.attempt,1);
  assert.ok(existsSync(join(f.root,'runtime','verifier',f.contextId,id,'1','receipt.json')));assert.ok(existsSync(join(f.root,'runtime','verifier',contextId,id,'1','receipt.json')));
});

test('the actual CLI bootstraps usable verifier references without widening its action set',async t=>{
  const f=await fixture(t),child=spawnSync(process.execPath,[cli.pathname,'verifier',f.contextId],{ env:{ ...process.env,MOMENT_HOME:f.root },encoding:'utf8',timeout:10000 });
  assert.equal(child.status,0,child.stderr);const installed=JSON.parse(child.stdout),scope=await f.call('control.get',{ contextId:f.contextId,ref:installed.grant });
  assert.deepEqual(scope.value.actions,['execution.request','local.verify-bytes']);assert.equal(scope.value.delegable,false);assert.equal(scope.value.resourceRefs.length,1);
  const bytes=Buffer.from('Installed through the real CLI'),id=randomUUID();await f.write('execution.request',{ execution:{ id,incidentId:f.incidentId,capability:installed.capability,grant:installed.grant,input:{ contentBase64:bytes.toString('base64'),expectedDigest:bytesDigest(bytes) },limits:installed.limits } });
  assert.equal((await f.wait(id)).outcome.output.matches,true);
});

test('context closure preserves a real late success and its receipt without reopening graph admission',async t=>{
  const f=await fixture(t,{ entrypoint:new URL('./held-provider.mjs',import.meta.url) }),bytes=Buffer.from('Completion races with context closure'),id=randomUUID();
  await f.write('execution.request',{ execution:{ id,incidentId:f.incidentId,capability:f.registration.capability,grant:f.registration.grant,input:{ contentBase64:bytes.toString('base64'),expectedDigest:bytesDigest(bytes) },limits:f.registration.limits } });
  const barrier=join(f.root,'before-finish.json'),until=Date.now()+10000;while (!existsSync(barrier) && Date.now()<until) await new Promise(resolve=>setTimeout(resolve,20));assert.equal(existsSync(barrier),true);
  await f.write('context.close',{ reason:'Preserve observed completion, stop future work' });
  const requested=await f.call('execution.get',{ contextId:f.contextId,executionId:id });assert.equal(requested.state,'cancel_requested');
  writeFileSync(join(f.root,'release-finish'),'release',{ mode:0o600 });const result=await f.wait(id);
  assert.equal(result.state,'succeeded');assert.ok(result.cancellation);assert.equal(result.outcome.output.observedDigest,bytesDigest(bytes));assert.deepEqual(result.outcome.evidence.sources,[f.registration.capability]);
  const receipt=readFileSync(join(f.root,'runtime','verifier',f.contextId,id,'1','receipt.json'));assert.ok(result.outcome.evidence.artifactDigests.includes(bytesDigest(receipt)));
  assert.equal((await f.call('context.get',{ contextId:f.contextId })).state,'closed');
});
