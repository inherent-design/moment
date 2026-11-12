import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '../runtime/client.mjs';
import { catalogIdentity,validateSurface } from '../runtime/bindings.mjs';
import { limits,incident } from './helpers.mjs';
import { start,stop,cli } from './daemon-fixture.mjs';

const run=(root,args,env={})=>spawnSync(process.execPath,[cli.pathname,...args],{env:{PATH:process.env.PATH,MOMENT_HOME:root,...env},encoding:'utf8',timeout:15000,maxBuffer:1048576});
test('offline agents/status/stop/help are bounded and observational with clean machine stdout',t=>{
  const parent=mkdtempSync(join(tmpdir(),'moment-co-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));const root=join(parent,'s');
  const summary=run(root,['agents','--limit','2']);assert.equal(summary.status,0,summary.stderr);
  const records=summary.stdout.trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(records.length,3);assert.equal(records[0].catalog.digest,catalogIdentity.digest);
  for(const record of records) validateSurface(record.kind==='manifest'?'AgentManifest':'AgentRecord',record);
  assert.equal(records[1].inputSchema.document,undefined);
  const exact=run(root,['agents','workspace.read']);assert.equal(exact.status,0,exact.stderr);assert.equal(exact.stderr,'');
  assert.ok(JSON.parse(exact.stdout.trim().split('\n')[1]).inputSchema.document.properties.target);
  const status=run(root,['status','--json']);assert.equal(status.status,0,status.stderr);validateSurface('StatusEnvelope',JSON.parse(status.stdout));
  assert.equal(JSON.parse(status.stdout).value.health.state,'stopped');assert.equal(status.stderr,'');
  const stopped=run(root,['stop','--json']);assert.equal(stopped.status,0,stopped.stderr);assert.equal(JSON.parse(stopped.stdout).value.accepted,false);
  assert.match(run(root,['stop']).stdout,/already stopped/);
  assert.match(run(root,['--help']).stdout,/show INCIDENT --context ID/);
  for(const args of [['show'],['agents','--limit','0'],['status','--unknown'],['stop','--context','x']]) {
    const result=run(root,args);assert.equal(result.status,1);assert.equal(result.stdout,'');assert.ok(result.stderr.length>0);
  }
  assert.equal(existsSync(root),false);
  assert.equal(summary.stdout.includes('\x1b'),false);
  for(const command of ['connect','disconnect']) {
    const missing=run(root,[command,'--json']);assert.equal(missing.status,1);assert.equal(JSON.parse(missing.stdout).error.code,'INVALID_ARGUMENT');assert.equal(missing.stderr,'');
  }
});

test('human status/show report actual selected work and explicit instance stop confirms retirement',async t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-human-')),child=await start(root);
  t.after(async()=>{if(child.exitCode===null && child.signalCode===null) await stop(child);rmSync(root,{recursive:true,force:true});});
  const client=createClient(root),contextId=randomUUID(),id=randomUUID();
  assert.equal((await client.call('context.create',{id:contextId,label:'Human status',bootstrapProfile:'owner-local',idempotencyKey:'create',limits})).ok,true);
  assert.equal((await client.call('incident.create',{contextId,expectedRevision:1,idempotencyKey:'incident',id,incident})).ok,true);
  const status=run(root,['status','--context',contextId]);assert.equal(status.status,0,status.stderr);assert.match(status.stdout,/Moment is ready/);assert.match(status.stdout,/Keep an attributable result/);
  const show=run(root,['show',id,'--context',contextId]);assert.equal(show.status,0,show.stderr);assert.match(show.stdout,/Completion requires: One real observation/);
  const structured=run(root,['show',id,'--context',contextId,'--json']);assert.equal(structured.status,0,structured.stderr);assert.equal(JSON.parse(structured.stdout).value.incident.ref.id,id);
  const denied=run(root,['show',randomUUID(),'--context',contextId,'--json']);assert.equal(denied.status,1);assert.equal(JSON.parse(denied.stdout).error.code,'NOT_FOUND');assert.equal(denied.stderr,'');
  const invalid=run(root,['status','--context','invalid','--json']);assert.equal(invalid.status,1);assert.equal(JSON.parse(invalid.stdout).value.issues[0].code,'INVALID_ARGUMENT');
  const stopped=run(root,['stop','--json']);assert.equal(stopped.status,0,stopped.stderr);const result=JSON.parse(stopped.stdout);validateSurface('StopEnvelope',result);assert.equal(result.value.retired,true);
});
