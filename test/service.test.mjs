import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, statSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createService } from '../runtime/service.mjs';
import { createClient } from '../runtime/client.mjs';
import { catalogIdentity } from '../runtime/bindings.mjs';
import { issueCredential } from '../runtime/credentials.mjs';
import { limits, incident } from './helpers.mjs';

const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function retired(service) {
  for(let n=0;n<100;n++) { const state=await service.inspect();if(state.state==='stopped') return state;await wait(20); }
  assert.fail('Service did not retire');
}
function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'moment-managed-')),root=join(directory,'state'),children=[];
  const service=createService({root,onSpawn:child=>children.push(child)});
  t.after(async()=>{
    // These are retained handles created by this fixture, never inferred PIDs.
    for(const child of children) if(child.exitCode===null && child.signalCode===null) {const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
    rmSync(directory,{recursive:true,force:true});
  });
  return {root,service,children};
}

test('observational status and missing delegate do not initialize an absent home',async t=>{
  const f=fixture(t);
  assert.equal((await f.service.inspect()).state,'stopped');
  assert.equal(existsSync(f.root),false);
  const delegate=createService({root:f.root,credentialFile:join(f.root,'missing.json')});
  assert.equal((await delegate.ensure()).error.code,'UNAUTHENTICATED');
  assert.equal((await createService({root:f.root,credentialFile:''}).ensure()).error.code,'UNAUTHENTICATED');
  assert.equal(existsSync(f.root),false);
});

test('simultaneous clients converge on one authenticated instance and exact owner stop drains it',async t=>{
  const f=fixture(t);
  const results=await Promise.all(Array.from({length:5},()=>f.service.ensure()));
  for(const result of results) assert.equal(result.ok,true,JSON.stringify(result));
  const instance=results[0].value.instanceId;
  assert.equal(new Set(results.map(r=>r.value.instanceId)).size,1);
  assert.equal(f.children.length,1,'Managed callers launch exactly one candidate, so no losing starter can revive a stopped service');
  assert.equal(results[0].value.catalog.digest,catalogIdentity.digest);
  const client=createClient(f.root);
  const description=await client.call('system.describe',{protocolVersion:'0.1'});
  assert.ok(description.value.methods.includes('service.stop'));
  assert.equal((await f.service.stop(randomUUID())).error.code,'IDENTITY_CONFLICT');
  assert.equal((await f.service.inspect()).state,'ready');
  const file=issueCredential(f.root,randomUUID(),{});
  assert.equal((await createClient(f.root,{credentialFile:file}).call('service.stop',{expectedInstanceId:instance})).error.code,'FORBIDDEN');
  const stopped=await f.service.stop(instance);assert.equal(stopped.ok,true);
  assert.deepEqual(stopped.value,{accepted:true,instanceId:instance});
  await retired(f.service);
  assert.equal(statSync(join(f.root,'runtime/service.log')).mode&0o077,0);
  assert.ok(statSync(join(f.root,'runtime/service.log')).size<=65536);
});

test('owned abrupt restart retains identity, exact receipts, incidents and credentials',async t=>{
  const f=fixture(t);assert.equal((await f.service.ensure()).ok,true);
  const client=createClient(f.root),contextId=randomUUID(),id=randomUUID();
  const before=(await client.call('system.describe',{protocolVersion:'0.1'})).value;
  assert.equal((await client.call('context.create',{id:contextId,label:'Managed persistence',bootstrapProfile:'owner-local',idempotencyKey:'create',limits})).ok,true);
  const input={contextId,expectedRevision:1,idempotencyKey:'incident',id,incident};
  const saved=await client.call('incident.create',input);assert.equal(saved.ok,true);
  const active=f.children.find(child=>child.exitCode===null && child.signalCode===null);
  const exited=once(active,'exit');active.kill('SIGKILL');await exited;
  const restarted=await f.service.ensure();assert.equal(restarted.ok,true,JSON.stringify(restarted));
  assert.notEqual(restarted.value.instanceId,before.instanceId);
  assert.equal((await client.call('system.describe',{protocolVersion:'0.1'})).value.systemId,before.systemId);
  assert.deepEqual(await client.call('incident.create',input),saved);
  assert.deepEqual(await client.call('incident.get',{contextId,incidentId:id}),saved);
  assert.equal((await f.service.stop(before.instanceId)).error.code,'IDENTITY_CONFLICT');
});

test('catalog mismatch and an unowned socket path refuse replacement',async t=>{
  const f=fixture(t);assert.equal((await f.service.ensure()).ok,true);
  const mismatch=createService({root:f.root,expectedCatalog:{...catalogIdentity,digest:'sha256:'+'0'.repeat(64)}});
  assert.equal((await mismatch.inspect()).state,'incompatible');
  assert.equal((await mismatch.ensure()).error.code,'UNSUPPORTED_VERSION');
  assert.equal((await f.service.inspect()).state,'ready');
  const state=await f.service.inspect();await f.service.stop(state.instanceId);await retired(f.service);
  writeFileSync(join(f.root,'runtime/moment.sock'),'not a socket',{mode:0o600});
  assert.equal((await f.service.inspect()).state,'incompatible');
  assert.equal((await f.service.ensure()).ok,false);
});

test('missing retained owner custody and excessive socket paths never trigger replacement or initialization',async t=>{
  const f=fixture(t);assert.equal((await f.service.ensure()).ok,true);
  const state=await f.service.inspect();await f.service.stop(state.instanceId);await retired(f.service);
  const path=join(f.root,'runtime/owner.json'),original=readFileSync(path);unlinkSync(path);
  assert.equal((await f.service.inspect()).state,'unavailable');assert.equal((await f.service.ensure()).ok,false);assert.equal(existsSync(path),false);
  writeFileSync(path,original,{mode:0o600});assert.equal((await f.service.ensure()).ok,true);
  const next=await f.service.inspect();await f.service.stop(next.instanceId);await retired(f.service);
  const registry=join(f.root,'registry.json'),registered=readFileSync(registry);unlinkSync(registry);
  assert.equal((await f.service.inspect()).state,'incompatible');assert.equal((await f.service.ensure()).ok,false);assert.equal(existsSync(registry),false);
  writeFileSync(registry,registered,{mode:0o600});assert.equal((await f.service.ensure()).ok,true);
  const longRoot=join(f.root,'x'.repeat(110)),long=createService({root:longRoot});
  assert.equal((await long.inspect()).state,'incompatible');assert.equal(existsSync(longRoot),false);
});

test('live or uncertain startup custody and an incompatible database are preserved without another candidate',async t=>{
  const f=fixture(t);assert.equal((await f.service.ensure()).ok,true);
  const ready=await f.service.inspect();await f.service.stop(ready.instanceId);await retired(f.service);
  const put=value=>{
    const db=new DatabaseSync(join(f.root,'runtime/store.sqlite'));
    try {if(value===undefined) db.prepare("DELETE FROM metadata WHERE key='managedStartup'").run();else db.prepare("INSERT OR REPLACE INTO metadata VALUES ('managedStartup',?)").run(JSON.stringify(value));} finally {db.close();}
  };
  const limited=createService({root:f.root,startupMillis:100});
  put({pid:process.pid,nonce:randomUUID()});
  assert.equal((await limited.inspect()).state,'starting');assert.equal((await limited.ensure()).ok,false);assert.equal(f.children.length,1);
  put({pid:process.pid,childPid:0,nonce:randomUUID()});
  assert.equal((await limited.inspect()).state,'uncertain');assert.equal((await limited.ensure()).ok,false);assert.equal(f.children.length,1);
  put(undefined);
  const db=new DatabaseSync(join(f.root,'runtime/store.sqlite'));try{db.exec('PRAGMA user_version=99');}finally{db.close();}
  assert.equal((await f.service.inspect()).state,'incompatible');assert.equal((await f.service.ensure()).error.code,'UNSUPPORTED_VERSION');assert.equal(f.children.length,1);
});

test('a retained startup claim is reclaimed only after its recorded owned candidate actually retires',async t=>{
  const f=fixture(t);assert.equal((await f.service.ensure()).ok,true);
  const active=f.children[0],ready=await f.service.inspect();await f.service.stop(ready.instanceId);await retired(f.service);
  if(active.exitCode===null && active.signalCode===null) await once(active,'exit');
  const db=new DatabaseSync(join(f.root,'runtime/store.sqlite'));
  try {db.prepare("INSERT OR REPLACE INTO metadata VALUES ('managedStartup',?)").run(JSON.stringify({pid:process.pid,childPid:active.pid,nonce:randomUUID()}));}finally{db.close();}
  const observed=()=>{const db=new DatabaseSync(join(f.root,'runtime/store.sqlite'),{readOnly:true});try{return db.prepare("SELECT value FROM metadata WHERE key='managedStartup'").get()?.value;}finally{db.close();}};
  const before=observed();assert.equal((await f.service.inspect()).state,'stopped');assert.equal(observed(),before,'Inspection is observational');
  const restarted=await f.service.ensure();assert.equal(restarted.ok,true,JSON.stringify(restarted));assert.equal(f.children.length,2);assert.notEqual(restarted.value.instanceId,ready.instanceId);assert.equal(observed(),undefined);

});
