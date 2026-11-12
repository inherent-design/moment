import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request, createClient } from '../runtime/client.mjs';
import { parseJson } from '../runtime/wire.mjs';
import { DatabaseSync } from 'node:sqlite';
import { digest } from '../runtime/json.mjs';
import { start,stop } from './daemon-fixture.mjs';

const limits={ concurrentExecutions:1,cpuMillis:1000,memoryBytes:1000,outputBytes:1000,modelTokens:0,apiSpendMicrounits:0,currency:'USD' };

test('real authenticated socket API persists intent across daemon kill and restart',async t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-rpc-'));
  let child=await start(root);
  t.after(async()=>{ if (child.exitCode===null && child.signalCode===null) await stop(child);rmSync(root,{ recursive:true,force:true }); });
  const description=await request(root,'system.describe',{ protocolVersion:'0.1' });
  assert.equal((await createClient(root).call('system.describe',{ protocolVersion:'0.1' })).ok,true);
  assert.equal((await createClient(root).call('context.get',{ contextId:'invalid' })).error.code,'INVALID_ARGUMENT');
  assert.equal(description.result.ok,true);assert.ok(description.result.value.methods.includes('incident.create'));
  assert.equal(statSync(join(root,'runtime','owner.json')).mode & 0o077,0);
  assert.equal(statSync(join(root,'runtime','moment.sock')).mode & 0o077,0);
  await assert.rejects(request(root,'system.describe',{ protocolVersion:'0.1' },{ token:'0'.repeat(64) }),{ code:'OUTCOME_UNKNOWN' });
  const contextId=randomUUID(),id=randomUUID();
  assert.equal((await request(root,'context.create',{ id:contextId,label:'Socket test',bootstrapProfile:'owner-local',idempotencyKey:'bootstrap',limits })).result.ok,true);
  const params={ contextId,expectedRevision:1,idempotencyKey:'new-incident',id,incident:{ purpose:'Survive a daemon restart',completionCriteria:['Retrieve same intent'],status:'open',continuation:[] } };
  const saved=(await request(root,'incident.create',params)).result;
  assert.equal(saved.ok,true);
  await stop(child,'SIGKILL');child=await start(root);
  assert.deepEqual((await request(root,'incident.create',params)).result,saved);
  assert.deepEqual((await request(root,'incident.get',{ contextId,incidentId:id })).result,saved);
  const policy=(await request(root,'context.get',{ contextId })).result.value.policy;
  assert.equal((await request(root,'control.get',{ contextId,ref:policy })).result.ok,true);
});

test('wire rejects duplicate keys, escaped duplicates, malformed syntax and excessive nesting',()=>{
  assert.deepEqual(parseJson('{"a":[1,true,null,"escaped\\\"text"]}'),{ a:[1,true,null,'escaped"text'] });
  for (const invalid of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','[1,]','{"a":1,}','01','1e999','"\\ud800"','true false','"unterminated','['.repeat(66)+'0'+']'.repeat(66)]) assert.throws(()=>parseJson(invalid),SyntaxError);
});

test('server rejects malformed frames without admitting changes or leaking credentials',async t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-frame-'));const child=await start(root);
  t.after(async()=>{ await stop(child);rmSync(root,{ recursive:true,force:true }); });
  const { token }=JSON.parse(readFileSync(join(root,'runtime','owner.json'),'utf8'));
  const raw=frame=>new Promise((resolve,reject)=>{
    const socket=net.createConnection(join(root,'runtime','moment.sock'));let text='';
    socket.on('error',reject);socket.setTimeout(2000,()=>{ socket.destroy();reject(new Error('Frame timeout')); });
    socket.on('connect',()=>socket.write(`Authorization: Bearer ${token}\n${frame}\n`));
    socket.on('data',bytes=>text+=bytes);socket.on('end',()=>resolve(JSON.parse(text)));
  });
  const duplicate=await raw('{"jsonrpc":"2.0","id":"a","id":"b","method":"system.describe","params":{"protocolVersion":"0.1"}}');
  assert.equal(duplicate.error.code,-32700);assert.equal(JSON.stringify(duplicate).includes(token),false);
  assert.equal((await raw('{"jsonrpc":"2.0","id":"a","method":"unknown","params":{}}')).error.code,-32601);
  assert.equal((await raw('{"jsonrpc":"2.0","id":"a","method":"context.get","params":{"contextId":"invalid"}}')).error.code,-32602);
  assert.equal((await raw('[]')).error.code,-32600);
  assert.equal((await raw(JSON.stringify({ jsonrpc:'2.0',id:'x'.repeat(129),method:'system.describe',params:{ protocolVersion:'0.1' } }))).error.code,-32600);
});

test('a second daemon cannot displace a live owner with a durable database claim',async t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-owner-'));const child=await start(root);
  t.after(async()=>{ await stop(child);rmSync(root,{ recursive:true,force:true }); });
  await assert.rejects(start(root),/live process holds the daemon claim/);
  assert.equal((await request(root,'system.describe',{ protocolVersion:'0.1' })).result.ok,true);
});

test('separate transport credentials exercise delegated grants and immediate revocation over real sockets',async t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-delegate-'));const child=await start(root);
  t.after(async()=>{ await stop(child);rmSync(root,{ recursive:true,force:true }); });
  const { issueCredential }=await import('../runtime/credentials.mjs');
  const call=async(method,params)=>{ const reply=await request(root,method,params);assert.ok(!reply.error,JSON.stringify(reply));return reply.result; };
  const contextId=randomUUID();
  await call('context.create',{ id:contextId,label:'Delegation',bootstrapProfile:'owner-local',idempotencyKey:'create',limits });
  const write=async(method,input)=>{
    const context=(await call('context.get',{ contextId })).value;
    return call(method,{ contextId,expectedRevision:context.revision,idempotencyKey:randomUUID(),...input });
  };
  const context=(await call('context.get',{ contextId })).value;
  const original=(await call('control.get',{ contextId,ref:context.policy })).value.value;
  const policy={ ...original,id:randomUUID(),rules:[...original.rules,{ id:'delegates',effect:'permit',actions:['context.get'],when:{ kind:'equal',left:{ kind:'literal',value:true },right:{ kind:'literal',value:true } } }] };
  const candidate=(await write('policy.publish',{ policy })).value;
  assert.equal((await write('policy.activate',{ policy:candidate.ref,evidence:{ sources:[],method:'operator-approved',artifactDigests:[] } })).ok,true);
  const principalId=randomUUID();
  const grant=(await write('grant.issue',{ grant:{ id:randomUUID(),principalId,actions:['context.get'],incidentIds:'all',resourceRefs:[],delegable:false,limits } })).value;
  const credentialFile=issueCredential(root,principalId,{ [contextId]:grant.ref });
  const client=createClient(root,{ credentialFile });
  assert.equal((await client.call('context.get',{ contextId })).ok,true);
  assert.equal((await client.call('context.get',{ contextId:randomUUID() })).ok,false);
  assert.equal((await client.call('context.close',{ contextId,expectedRevision:1,idempotencyKey:'denied',reason:'cannot-admin' })).error.code,'FORBIDDEN');
  assert.equal((await write('grant.revoke',{ grant:grant.ref,reason:'revoked' })).ok,true);
  assert.equal((await client.call('context.get',{ contextId })).error.code,'FORBIDDEN');
  const owner=JSON.parse(readFileSync(join(root,'runtime','owner.json'),'utf8'));
  assert.throws(()=>issueCredential(root,owner.principalId,{ [contextId]:grant.ref }),/separate principal/);
});

test('a real daemon expires leases without client activity and fences running work after abrupt restart',async t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-execution-rpc-'));let child=await start(root);
  t.after(async()=>{ if (child.exitCode===null && child.signalCode===null) await stop(child);rmSync(root,{ recursive:true,force:true }); });
  const client=createClient(root),contextId=randomUUID(),incidentId=randomUUID();
  const { principalId }=JSON.parse(readFileSync(join(root,'runtime','owner.json'),'utf8'));
  const call=async(method,input)=>{ const result=await client.call(method,input);assert.equal(result.ok,true,JSON.stringify(result));return result.value; };
  const write=async(method,input)=>{
    const context=await call('context.get',{ contextId });
    return call(method,{ contextId,expectedRevision:context.revision,idempotencyKey:randomUUID(),...input });
  };
  await call('context.create',{ id:contextId,label:'Execution recovery',bootstrapProfile:'owner-local',idempotencyKey:'bootstrap',limits });
  await write('incident.create',{ id:incidentId,incident:{ purpose:'Preserve uncertain effects',completionCriteria:['No blind replay'],status:'open',continuation:[] } });
  const document={ type:'string' },schema={ name:'fixture.verification',version:'1',digest:digest(document) };
  await write('schema.publish',{ schema,document });
  const evidence={ sources:[],method:'socket test provider',artifactDigests:[] };
  const cap=await write('capability.advertise',{ capability:{ id:randomUUID(),providerId:principalId,name:'fixture.socket',version:'1',inputSchema:schema,outputSchema:schema,features:[],platform:{ os:process.platform,architecture:process.arch },isolation:'none',reconciliation:'lookup',evidence,expiresAt:new Date(Date.now()+60000).toISOString() } });
  const context=await call('context.get',{ contextId }),old=await call('control.get',{ contextId,ref:context.policy });
  const candidate=await write('policy.publish',{ policy:{ ...old.value,id:randomUUID(),parent:context.policy,rules:old.value.rules.map(rule=>({ ...rule,actions:[...rule.actions,cap.value.name] })) } });
  await write('policy.activate',{ policy:candidate.ref,evidence });
  const bound=await write('grant.issue',{ grant:{ id:randomUUID(),principalId,actions:['execution.request',cap.value.name],incidentIds:[incidentId],resourceRefs:[cap.ref],delegable:false,limits } });
  const enqueue=async()=>write('execution.request',{ execution:{ id:randomUUID(),incidentId,capability:cap.ref,grant:bound.ref,input:'fixture',limits } });
  const dispatch=async(id,leaseMillis)=>{
    const leased=await write('execution.claim',{ executionId:id,leaseMillis });
    const lease={ executionId:id,leaseId:leased.lease.id,fencingToken:leased.lease.fencingToken };
    await write('execution.heartbeat',{ ...lease,leaseMillis });return lease;
  };
  const first=await enqueue();await dispatch(first.intent.id,250);
  // Observe SQLite read-only, without any RPC that could trigger lazy maintenance.
  const observer=new DatabaseSync(join(root,'runtime','store.sqlite'),{ readOnly:true });
  try {
    let observed;
    const until=Date.now()+3000;
    do {
      const row=observer.prepare('SELECT value FROM snapshots WHERE context_id=? ORDER BY revision DESC LIMIT 1').get(contextId);
      observed=JSON.parse(row.value).controlState.executions[first.intent.id].value;
      if (observed.state==='unknown') break;
      await new Promise(resolve=>setTimeout(resolve,20));
    } while (Date.now()<until);
    assert.equal(observed.state,'unknown');assert.equal(observed.attempt,1);
  } finally { observer.close(); }
  const proofId=randomUUID();await write('graph.transact',{ changes:[{ kind:'record.put',record:{ kind:'atom',id:proofId,schema,value:'Test provider observed no external dispatch' } }] });
  const systemId=(await call('system.describe',{ protocolVersion:'0.1' })).systemId;
  const usage={ cpuMillis:0,memoryBytes:0,outputBytes:0,modelTokens:0,apiSpendMicrounits:0 };
  await write('execution.reconcile',{ attempt:1,executionId:first.intent.id,resolution:{ kind:'observed',outcome:{ kind:'cancelled',evidence:{ ...evidence,sources:[{ systemId,contextId,id:proofId }] } } },usage });
  const second=await enqueue(),stale=await dispatch(second.intent.id,10000);
  await stop(child,'SIGKILL');child=await start(root);
  const recovered=await call('execution.get',{ contextId,executionId:second.intent.id });assert.equal(recovered.state,'unknown');assert.equal(recovered.attempt,1);
  const current=await call('context.get',{ contextId });
  const refused=await client.call('execution.finish',{ contextId,expectedRevision:current.revision,idempotencyKey:'stale-result',...stale,outcome:{ kind:'cancelled',evidence },usage });
  assert.equal(refused.error.code,'LEASE_STALE');
});

test('a real daemon rests without writes, resumes a saved schedule once after restart and supports long polling',async t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-wake-rpc-'));let child=await start(root);
  t.after(async()=>{ if (child.exitCode===null && child.signalCode===null) await stop(child);rmSync(root,{ recursive:true,force:true }); });
  const client=createClient(root),contextId=randomUUID(),incidentId=randomUUID(),evidence={ sources:[],method:'Real wake fixture',artifactDigests:[] };
  const call=async(method,input)=>{ const result=await client.call(method,input);assert.equal(result.ok,true,JSON.stringify(result));return result.value; };
  const write=async(method,input)=>{
    for (let attempt=0;attempt<8;attempt++) {
      const ctx=await call('context.get',{ contextId }),result=await client.call(method,{ contextId,expectedRevision:ctx.revision,idempotencyKey:randomUUID(),...input });
      if (result.ok) return result.value;
      assert.equal(result.error.code,'REVISION_CONFLICT',JSON.stringify(result));
    }
    assert.fail('Fresh revision did not settle within the bounded retry');
  };
  await call('context.create',{ id:contextId,label:'Wake lifecycle',bootstrapProfile:'owner-local',idempotencyKey:'bootstrap',limits });
  await write('incident.create',{ id:incidentId,incident:{ purpose:'Wait for a relevant observation',completionCriteria:['One admitted wake'],status:'open',continuation:[] } });
  const document={ type:'string' },schema={ name:'fixture.wake',version:'1',digest:digest(document) };
  await write('schema.publish',{ schema,document });
  await write('incident.update',{ incidentId,incident:{ purpose:'Wait for a relevant observation',completionCriteria:['One admitted wake'],status:'resting',continuation:[] },evidence });
  const rule=await write('rule.publish',{ rule:{ id:randomUUID(),triggerEventTypes:['graph.transact.committed'],condition:{ kind:'equal',left:{ kind:'literal',value:true },right:{ kind:'literal',value:true } },operation:'incident.update',literalInput:{ contextId,expectedRevision:0,idempotencyKey:'placeholder',incidentId,incident:{ purpose:'Wait for a relevant observation',completionCriteria:['One admitted wake'],status:'open',continuation:[] },evidence },inputBindings:{},limits } });
  const scheduleId=randomUUID();await write('schedule.put',{ schedule:{ id:scheduleId,incidentId,rule:rule.ref,wake:{ kind:'event',eventTypes:['graph.transact.committed'],selector:{ schemaNames:[schema.name],assertionStatus:'any' },mode:'each' },recurrence:'once',coalesce:false } });
  // Wait for a stable read-only snapshot, then establish that idle time causes no writes.
  const observer=new DatabaseSync(join(root,'runtime','store.sqlite'),{ readOnly:true });
  const snapshot=()=>JSON.parse(observer.prepare('SELECT value FROM snapshots WHERE context_id=? ORDER BY revision DESC LIMIT 1').get(contextId).value);
  try {
    let previous=snapshot().context.revision;
    for (let count=0;count<20;count++) { await new Promise(resolve=>setTimeout(resolve,20));const next=snapshot().context.revision;if (next===previous) break;previous=next; }
    const before=snapshot();await new Promise(resolve=>setTimeout(resolve,80));assert.equal(snapshot().context.revision,before.context.revision);assert.equal(before.controlState.incidents[incidentId].value.status,'resting');
  } finally { observer.close(); }
  await stop(child,'SIGKILL');child=await start(root);
  const tail=await call('events.read',{ contextId,limit:100,waitMillis:0 });
  const waiting=call('events.read',{ contextId,after:tail.nextCursor,limit:100,waitMillis:2000 });
  await write('graph.transact',{ changes:[{ kind:'record.put',record:{ kind:'atom',id:randomUUID(),schema,value:'Relevant observed evidence' } }] });
  const notified=await waiting;assert.ok(notified.items.some(item=>item.type==='graph.transact.committed'));
  let status;
  for (let count=0;count<100;count++) { status=await call('schedule.get',{ contextId,scheduleId });if (status.state==='completed') break;await new Promise(resolve=>setTimeout(resolve,20)); }
  assert.equal(status.state,'completed');assert.equal((await call('incident.get',{ contextId,incidentId })).value.status,'open');
  const all=await call('events.read',{ contextId,limit:100,waitMillis:0 });assert.equal(all.items.filter(item=>item.type==='runtime.schedule.triggered').length,1);assert.equal(all.items.filter(item=>item.type==='incident.update.committed' && item.causeIds.length).length,1);
  await stop(child,'SIGKILL');child=await start(root);
  assert.equal((await call('schedule.get',{ contextId,scheduleId })).state,'completed');
});
