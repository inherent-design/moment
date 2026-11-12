import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { start,stop,cli } from './daemon-fixture.mjs';
import { createClient } from '../runtime/client.mjs';
import { limits,incident } from './helpers.mjs';

async function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'moment-command-')),child=await start(root);t.after(async()=>{ await stop(child);rmSync(root,{recursive:true,force:true}); });
  const contextId=randomUUID(),client=createClient(root),created=await client.call('context.create',{ id:contextId,label:'File input',bootstrapProfile:'owner-local',idempotencyKey:'bootstrap',limits });assert.equal(created.ok,true);
  const run=(args,input)=>spawnSync(process.execPath,[cli.pathname,...args],{ env:{...process.env,MOMENT_HOME:root},input,encoding:'utf8',timeout:5000,maxBuffer:2*1048576 });
  const file=join(root,'request.json');return { root,contextId,client,file,run };
}
test('CLI file, stdin and inline inputs perform identical authenticated reads',async t=>{
  const f=await fixture(t),input=JSON.stringify({contextId:f.contextId});writeFileSync(f.file,input);
  const replies=[f.run(['call','context.get',input]),f.run(['call','context.get','--file',f.file]),f.run(['call','context.get','--file','-'],input)];
  for (const reply of replies) { assert.equal(reply.status,0,reply.stderr);assert.equal(JSON.parse(reply.stdout).result.ok,true); }
  assert.deepEqual(JSON.parse(replies[0].stdout).result,JSON.parse(replies[1].stdout).result);assert.deepEqual(JSON.parse(replies[1].stdout).result,JSON.parse(replies[2].stdout).result);
});
test('CLI file mutations preserve exact retry keys and responses across file and stdin',async t=>{
  const f=await fixture(t),input={ contextId:f.contextId,expectedRevision:1,idempotencyKey:'file-mutation',id:randomUUID(),incident },bytes=JSON.stringify(input);writeFileSync(f.file,bytes);
  const first=f.run(['call','incident.create','--file',f.file]),retry=f.run(['call','incident.create','--file','-'],bytes);assert.equal(first.status,0,first.stderr);assert.equal(retry.status,0,retry.stderr);
  assert.deepEqual(JSON.parse(first.stdout).result,JSON.parse(retry.stdout).result);assert.equal((await f.client.call('context.get',{contextId:f.contextId})).value.revision,2);
});
test('CLI input refuses duplicate keys, malformed UTF-8, missing files and extra arguments before admission',async t=>{
  const f=await fixture(t);
  for (const content of ['{"contextId":"'+f.contextId+'","contextId":"'+f.contextId+'"}','{"a":1,}',Buffer.from([123,34,120,34,58,34,255,34,125]),Buffer.alloc(1048577,32)]) {
    writeFileSync(f.file,content);const reply=f.run(['call','context.get','--file',f.file]);assert.equal(reply.status,1,reply.stdout);assert.equal(reply.stdout,'');
  }
  for (const args of [['call','context.get','--file',join(f.root,'missing')],['call','context.get','--file'],['call','context.get','--file',f.file,'extra']]) assert.equal(f.run(args).status,1);
  assert.equal((await f.client.call('context.get',{contextId:f.contextId})).value.revision,1);
});
test('CLI accepts exactly 1 MiB of file or stdin bytes and refuses the next byte',async t=>{
  const f=await fixture(t),json=JSON.stringify({contextId:f.contextId}),exact=json+' '.repeat(1048576-Buffer.byteLength(json));writeFileSync(f.file,exact);
  assert.equal(f.run(['call','context.get','--file',f.file]).status,0);assert.equal(f.run(['call','context.get','--file','-'],exact).status,0);
  const refused=f.run(['call','context.get','--file','-'],exact+' ');assert.equal(refused.status,1);assert.match(refused.stderr,/1 MiB/);assert.equal(refused.stdout,'');
});
