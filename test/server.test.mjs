import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request, createClient } from '../runtime/client.mjs';
import { parseJson } from '../runtime/wire.mjs';

const cli=new URL('../runtime/cli.mjs',import.meta.url);
const limits={ concurrentExecutions:1,cpuMillis:1000,memoryBytes:1000,outputBytes:1000,modelTokens:0,apiSpendMicrounits:0,currency:'USD' };
async function start(root) {
  const child=spawn(process.execPath,[cli.pathname,'serve'],{ env:{ ...process.env,MOMENT_HOME:root },stdio:['ignore','pipe','pipe'] });
  let output='',errors='';child.stderr.on('data',bytes=>errors+=bytes);
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{ child.kill('SIGKILL');reject(new Error('Server startup timeout: '+errors)); },5000);
    child.once('error',error=>{ clearTimeout(timeout);reject(error); });
    child.once('exit',code=>{ clearTimeout(timeout);reject(new Error(`Server exited ${code}: ${errors}`)); });
    child.stdout.on('data',bytes=>{ output+=bytes;if (output.includes('\n')) { clearTimeout(timeout);resolve(); } });
  });
  return child;
}
async function stop(child,signal='SIGTERM') {
  const exited=once(child,'exit');child.kill(signal);await exited;
}

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
