// Explicit opt-in: invokes the installed Codex configuration CLI in private staging only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync,existsSync,unlinkSync,realpathSync,symlinkSync,renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,delimiter } from 'node:path';
import { spawn,spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createIntegration,stageCodexConfig } from '../runtime/integration.mjs';
import { catalogIdentity } from '../runtime/bindings.mjs';
import {observeCodexVersion} from '../runtime/codex-api.mjs';
import { bytesDigest,digest } from '../runtime/json.mjs';
import { validateSurface } from '../runtime/bindings.mjs';
import { createClient } from '../runtime/client.mjs';
import { start,stop,cli } from '../test/daemon-fixture.mjs';
import { limits,incident } from '../test/helpers.mjs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const original='# Keep this owner comment\ncli_auth_credentials_store = "ephemeral"\n\n[mcp_servers.other]\ncommand = "/usr/bin/true"\n';
function fixture(t,{config=true}={}) {
  const root=realpathSync(mkdtempSync(join(tmpdir(),'mi-'))),codexHome=join(root,'c'),momentHome=join(root,'m'),target=join(codexHome,'config.toml');
  const cleanups=[];t.after(async()=>{for(const cleanup of cleanups.reverse()) await cleanup();rmSync(root,{recursive:true,force:true});});
  if(config) {mkdirSync(codexHome,{mode:0o700});writeFileSync(target,original,{mode:0o600});}
  const request=(action='connect',apply=true)=>({action,codexHome,momentHome,apply});
  const port=createIntegration({credentialFile:null}),run=async(action='connect',apply=true)=>{const result=await port.reconcile(request(action,apply));validateSurface('IntegrationEnvelope',result);return result;};
  const receiptDirectory=()=>join(momentHome,'integrations/codex',readdirSync(join(momentHome,'integrations/codex'))[0]);
  return {root,codexHome,momentHome,target,request,port,run,receiptDirectory,cleanup:fn=>cleanups.push(fn)};
}
const state=(result,expected)=>assert.equal(result.value?.state,expected,JSON.stringify(result));

test('supported CLI preview/apply/repeat/remove preserves unrelated bytes and exposes the exact launcher',async t=>{
  const f=fixture(t),preview=await f.run('connect',false);state(preview,'planned');
  assert.equal(existsSync(f.momentHome),false);assert.equal(readFileSync(f.target,'utf8'),original);
  assert.equal(preview.value.launcher.command,realpathSync(process.execPath));
  assert.equal(preview.value.launcher.env.MOMENT_HOME,f.momentHome);assert.match(preview.value.ownedEntry.text,/\[mcp_servers.moment\]/);
  assert.equal(preview.value.launcher.env.MOMENT_CATALOG_REVISION,catalogIdentity.digest);
  state(await f.run(),'applied');state(await f.run(),'unchanged');
  assert.equal(readFileSync(f.target,'utf8').startsWith(original),true);
  const receipt=JSON.parse(readFileSync(join(f.receiptDirectory(),'receipt.json')));assert.equal(receipt.codexVersion,observeCodexVersion('codex'));
  const mcp=new Client({name:'moment-emitted-launcher',version:'1'});
  try {
    await mcp.connect(new StdioClientTransport({...receipt.launcher,env:{PATH:process.env.PATH,...receipt.launcher.env},stderr:'pipe'}));
    const tools=(await mcp.listTools()).tools;assert.equal(tools.length,16);assert.ok(tools.some(tool=>tool.name==='moment_memory_read'));assert.ok(tools.every(tool=>tool._meta['moment/catalog']===receipt.launcher.env.MOMENT_CATALOG_REVISION));assert.equal(existsSync(join(f.momentHome,'runtime')),false);
  } finally {await mcp.close();}
  const disconnected=await f.run('disconnect');state(disconnected,'applied');assert.equal(readFileSync(f.target,'utf8'),original);
  state(await f.run('disconnect'),'unchanged');
});

test('an owned pre-revision registration upgrades once and edited revision markers remain conflicts',async t=>{
  const f=fixture(t);state(await f.run(),'applied');
  const receiptPath=join(f.receiptDirectory(),'receipt.json'),receipt=JSON.parse(readFileSync(receiptPath));
  const removeMarker=text=>text.replace(/^MOMENT_CATALOG_REVISION = .*\n/m,'');
  const legacy=removeMarker(readFileSync(f.target,'utf8'));assert.notEqual(legacy,readFileSync(f.target,'utf8'));
  receipt.entryBlock=removeMarker(receipt.entryBlock);receipt.entryDigest=bytesDigest(receipt.entryBlock);
  delete receipt.launcher.env.MOMENT_CATALOG_REVISION;receipt.codexVersion='codex-cli 0.167.2';
  const staged=stageCodexConfig({before:legacy,action:'disconnect',launcher:receipt.launcher,ownedBlock:receipt.entryBlock});
  receipt.configEntryDigest=digest(staged.currentEntry);
  writeFileSync(f.target,legacy);writeFileSync(receiptPath,JSON.stringify(receipt)+'\n',{mode:0o600});
  state(await f.run('connect',false),'planned');assert.equal(readFileSync(f.target,'utf8'),legacy);
  state(await f.run(),'applied');state(await f.run(),'unchanged');
  const updated=JSON.parse(readFileSync(receiptPath));
  assert.equal(updated.codexVersion,observeCodexVersion('codex'));assert.equal(updated.launcher.env.MOMENT_CATALOG_REVISION,catalogIdentity.digest);
  const installed=readFileSync(f.target,'utf8');assert.equal(installed.startsWith(original),true);
  const edited=installed.replace(catalogIdentity.digest,'owner-edited-revision');writeFileSync(f.target,edited);
  state(await f.run(),'conflict');state(await f.run('disconnect'),'conflict');assert.equal(readFileSync(f.target,'utf8'),edited);
});

test('incompatible CLI configuration output refuses before target publication with a boundary diagnostic',async t=>{
  const f=fixture(t),bin=join(f.root,'bin');mkdirSync(bin);
  const priorPath=process.env.PATH;
  try {
    process.env.PATH=bin+':'+priorPath;
    for(const version of ['0.167.2','0.170.0']) {
      writeFileSync(join(bin,'codex'),'#!'+process.execPath+'\nconsole.log('+JSON.stringify('codex-cli '+version)+');\n',{mode:0o700});
      const result=await f.run('connect',false);assert.equal(result.ok,false);assert.equal(result.error.code,'CAPABILITY_UNAVAILABLE');assert.match(result.error.message,/mcp list requires a JSON/);assert.ok(result.error.message.includes(version));
      assert.equal(readFileSync(f.target,'utf8'),original);assert.equal(existsSync(f.momentHome),false);
    }
  } finally {process.env.PATH=priorPath;}
});
test('working configuration commands accept older and future version labels and retain observed provenance',async t=>{
  const binary=realpathSync(process.env.PATH.split(delimiter).map(path=>join(path,'codex')).find(existsSync));
  for(const version of ['0.167.2','0.170.0']) {
    const f=fixture(t),bin=join(f.root,'bin');mkdirSync(bin);
    writeFileSync(join(bin,'codex'),'#!'+process.execPath+'\nimport {spawnSync} from "node:child_process";if(process.argv.includes("--version"))console.log('+JSON.stringify('codex-cli '+version)+');else{const result=spawnSync('+JSON.stringify(binary)+',process.argv.slice(2),{stdio:"inherit"});process.exit(result.status??1);}\n',{mode:0o700});
    const prior=process.env.PATH;process.env.PATH=bin+delimiter+prior;
    try {state(await f.run(),'applied');assert.equal(JSON.parse(readFileSync(join(f.receiptDirectory(),'receipt.json'))).codexVersion,'codex-cli '+version);state(await f.run('disconnect'),'applied');assert.equal(readFileSync(f.target,'utf8'),original);}
    finally{process.env.PATH=prior;}
  }
});

test('absent roots remain absent during preview and removal retires only the owned newly created config',async t=>{
  const f=fixture(t,{config:false});state(await f.run('connect',false),'planned');
  assert.equal(existsSync(f.codexHome),false);assert.equal(existsSync(f.momentHome),false);
  state(await f.run(),'applied');assert.equal(existsSync(f.target),true);assert.equal(existsSync(join(f.momentHome,'runtime')),false);
  state(await f.run('disconnect'),'applied');assert.equal(existsSync(f.target),false);assert.equal(existsSync(f.momentHome),true);
});

test('nested existing server configuration stays byte-exact when Codex would normalize full-file edits',async t=>{
  for(const ending of ['\n','']) {
    const f=fixture(t),before='model = "gpt-6.1-sol"\n[mcp_servers.other]\ncommand = "/usr/bin/true"\n[mcp_servers.other.env]\nEXAMPLE = "fixture"'+ending;
    writeFileSync(f.target,before,{mode:0o600});
    state(await f.run('connect',false),'planned');assert.equal(readFileSync(f.target,'utf8'),before);
    state(await f.run(),'applied');assert.equal(readFileSync(f.target,'utf8').startsWith(before),true);
    state(await f.run(),'unchanged');state(await f.run('disconnect'),'applied');assert.equal(readFileSync(f.target,'utf8'),before);
  }
});

test('preexisting and user-edited registrations or missing ownership are preserved as conflicts',async t=>{
  const f=fixture(t);
  writeFileSync(f.target,original+'\n[mcp_servers.moment]\ncommand = "/usr/bin/false"\n');
  const unowned=readFileSync(f.target,'utf8');state(await f.run(),'conflict');assert.equal(readFileSync(f.target,'utf8'),unowned);
  writeFileSync(f.target,original);state(await f.run(),'applied');
  const installed=readFileSync(f.target,'utf8'),edited=installed.replace('args = [','args = ["user-added", ');writeFileSync(f.target,edited);
  state(await f.run('disconnect'),'conflict');assert.equal(readFileSync(f.target,'utf8'),edited);
  writeFileSync(f.target,installed);unlinkSync(join(f.receiptDirectory(),'receipt.json'));
  state(await f.run('disconnect'),'conflict');assert.equal(readFileSync(f.target,'utf8'),installed);
});

test('unrelated edits remain byte-exact on disconnect and observed external changes refuse publication',async t=>{
  const f=fixture(t);state(await f.run(),'applied');
  const before=readFileSync(f.target,'utf8');writeFileSync(f.target,'# Added outside Moment\n'+before);
  state(await f.run('disconnect'),'applied');assert.equal(readFileSync(f.target,'utf8'),'# Added outside Moment\n'+original);
  const port=createIntegration({onPhase:async phase=>{if(phase==='planned') writeFileSync(f.target,'# Concurrent owner edit\n'+readFileSync(f.target,'utf8'));}});
  state(await port.reconcile(f.request()),'conflict');assert.equal(readFileSync(f.target,'utf8').includes('[mcp_servers.moment]'),false);
  assert.match(readFileSync(f.target,'utf8'),/^# Concurrent owner edit/);
});

test('identical-content file replacement is detected through expected-old identity',async t=>{
  const f=fixture(t),port=createIntegration({onPhase:async phase=>{if(phase==='planned') {renameSync(f.target,f.target+'.previous');writeFileSync(f.target,original,{mode:0o600});}}});
  state(await port.reconcile(f.request()),'conflict');assert.equal(readFileSync(f.target,'utf8'),original);
  assert.equal(existsSync(join(f.receiptDirectory(),'receipt.json')),false);
});

test('a second real CLI installer cannot enter a cooperating transaction held by another operation',async t=>{
  const f=fixture(t);let enter,release;
  const entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const port=createIntegration({credentialFile:null,onPhase:async phase=>{if(phase==='planned') {enter();await gate;}}}),first=port.reconcile(f.request());
  await entered;
  try {
    const second=spawnSync(process.execPath,[cli.pathname,'connect','--codex-home',f.codexHome,'--moment-home',f.momentHome,'--apply','--json'],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:15000});
    assert.equal(second.status,1,second.stderr);const result=JSON.parse(second.stdout);assert.equal(result.error.code,'IDENTITY_CONFLICT');assert.match(result.error.message,/integration transaction/);assert.equal(readFileSync(f.target,'utf8'),original);
  } finally {release();await first;}
  state(await first,'applied');state(await f.run('disconnect'),'applied');assert.equal(readFileSync(f.target,'utf8'),original);
});

test('interrupted publication recovers the owned receipt without saving unrelated configuration',async t=>{
  const f=fixture(t);writeFileSync(f.target,'# PRIVATE_CONFIG_MARKER\n'+original);
  const port=createIntegration({onPhase:async phase=>{if(phase==='config-published') throw new Error('Injected interruption');}});
  const interrupted=await port.reconcile(f.request());assert.equal(interrupted.error.code,'OUTCOME_UNKNOWN');
  const directory=f.receiptDirectory(),pending=readFileSync(join(directory,'pending.json'),'utf8');
  const beforePreview=readFileSync(f.target,'utf8');
  for(const format of [[],['--json']]){
    const preview=spawnSync(process.execPath,[cli.pathname,'connect','--codex-home',f.codexHome,'--moment-home',f.momentHome,...format],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:15000});
    assert.equal(preview.status,1);assert.equal(preview.stderr,'');
    if(format.length)assert.equal(JSON.parse(preview.stdout).value.state,'recovery_required');else assert.match(preview.stdout,/interrupted integration needs apply.*preview has no effects/);
    assert.equal(readFileSync(f.target,'utf8'),beforePreview);assert.equal(readFileSync(join(directory,'pending.json'),'utf8'),pending);
  }
  assert.equal(pending.includes('PRIVATE_CONFIG_MARKER'),false);assert.equal(pending.includes('Keep this owner comment'),false);
  assert.equal(existsSync(join(directory,'receipt.json')),false);state(await f.run(),'applied');
  assert.equal(existsSync(join(directory,'pending.json')),false);state(await f.run(),'unchanged');
  state(await f.run('disconnect'),'applied');assert.equal(readFileSync(f.target,'utf8'),'# PRIVATE_CONFIG_MARKER\n'+original);
});

test('recovery completes both sides of configuration and receipt publication without repeating ownership changes',async t=>{
  for(const boundary of ['journaled','config-published','receipt-published']) {
    const f=fixture(t),port=createIntegration({onPhase:async phase=>{if(phase===boundary) throw new Error('Injected interruption');}});
    assert.equal((await port.reconcile(f.request())).error.code,'OUTCOME_UNKNOWN');
    state(await f.run(),'applied');state(await f.run(),'unchanged');
    state(await f.run('disconnect'),'applied');assert.equal(readFileSync(f.target,'utf8'),original);
  }
});

test('actual owned process interruption retains a journal and reclaims only its dead installer lock',async t=>{
  const f=fixture(t),module=new URL('../runtime/integration.mjs',import.meta.url).href;
  const source=`import {createIntegration} from ${JSON.stringify(module)};const port=createIntegration({onPhase:async phase=>{if(phase==='config-published'){process.stdout.write('paused\\n');await new Promise(()=>setInterval(()=>{},1000));}}});await port.reconcile(JSON.parse(process.env.MOMENT_TEST_INTEGRATION_REQUEST));`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{env:{PATH:process.env.PATH,MOMENT_TEST_INTEGRATION_REQUEST:JSON.stringify(f.request())},stdio:['ignore','pipe','pipe']});
  f.cleanup(async()=>{if(child.exitCode===null && child.signalCode===null) {const exit=once(child,'exit');child.kill('SIGTERM');await exit;}});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Owned installer did not reach publication')),10000);let text='';
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('Owned installer exited before barrier'));});
    child.stdout.on('data',bytes=>{text+=bytes;if(text.includes('paused\n')) {clearTimeout(timer);resolve();}});
  });
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  const directory=f.receiptDirectory();assert.equal(existsSync(join(directory,'transaction.lock/owner.json')),true);
  state(await f.run(),'applied');assert.equal(existsSync(join(directory,'transaction.lock')),false);assert.equal(existsSync(join(directory,'pending.json')),false);
  state(await f.run('disconnect'),'applied');assert.equal(readFileSync(f.target,'utf8'),original);
});

test('insufficient recovery evidence preserves the external edit and interrupted journal',async t=>{
  const f=fixture(t),port=createIntegration({onPhase:async phase=>{if(phase==='config-published') throw new Error('Injected interruption');}});
  assert.equal((await port.reconcile(f.request())).error.code,'OUTCOME_UNKNOWN');
  writeFileSync(f.target,'# Owner edit after interruption\n'+readFileSync(f.target,'utf8'));
  const before=readFileSync(f.target,'utf8');state(await f.run(),'recovery_required');assert.equal(readFileSync(f.target,'utf8'),before);
  assert.equal(existsSync(join(f.receiptDirectory(),'pending.json')),true);
});

test('live installer locks, linked targets and linked receipt custody refuse changes',async t=>{
  const f=fixture(t);state(await f.run(),'applied');
  const directory=f.receiptDirectory(),lock=join(directory,'transaction.lock');mkdirSync(lock,{mode:0o700});
  writeFileSync(join(lock,'owner.json'),JSON.stringify({formatVersion:1,pid:process.pid,nonce:randomUUID()}),{mode:0o600});
  const before=readFileSync(f.target,'utf8');const busy=await f.run('disconnect');assert.equal(busy.error.code,'IDENTITY_CONFLICT');assert.equal(readFileSync(f.target,'utf8'),before);
  unlinkSync(join(lock,'owner.json'));assert.equal((await f.run('disconnect')).error.code,'OUTCOME_UNKNOWN');assert.equal(existsSync(lock),true);
  rmSync(lock,{recursive:true});
  const outside=join(f.root,'outside.toml');writeFileSync(outside,original,{mode:0o600});unlinkSync(f.target);symlinkSync(outside,f.target);
  assert.equal((await f.run()).error.code,'FORBIDDEN');assert.equal(readFileSync(outside,'utf8'),original);
  unlinkSync(f.target);writeFileSync(f.target,before,{mode:0o600});
  const other=join(f.root,'outside-custody');mkdirSync(other,{mode:0o700});rmSync(directory,{recursive:true});symlinkSync(other,directory,'dir');
  assert.equal((await f.run('disconnect')).error.code,'FORBIDDEN');assert.deepEqual(readdirSync(other),[]);assert.equal(readFileSync(f.target,'utf8'),before);
});

test('ownership edits during interrupted recovery are preserved',async t=>{
  const f=fixture(t),port=createIntegration({onPhase:async phase=>{if(phase==='receipt-published') throw new Error('Injected interruption');}});
  assert.equal((await port.reconcile(f.request())).error.code,'OUTCOME_UNKNOWN');
  const receipt=join(f.receiptDirectory(),'receipt.json'),edited=JSON.parse(readFileSync(receipt));edited.catalog.digest='sha256:'+'0'.repeat(64);writeFileSync(receipt,JSON.stringify(edited),{mode:0o600});
  const before=readFileSync(receipt,'utf8');state(await f.run(),'recovery_required');assert.equal(readFileSync(receipt,'utf8'),before);assert.equal(existsSync(join(f.receiptDirectory(),'pending.json')),true);
});

test('CLI commands use explicit roots and disconnect preserves a real running store, credentials and retained intent',async t=>{
  const f=fixture(t),run=args=>spawnSync(process.execPath,[cli.pathname,...args],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:15000,maxBuffer:1048576});
  const args=['--codex-home',f.codexHome,'--moment-home',f.momentHome,'--json'];
  const preview=run(['connect',...args]);assert.equal(preview.status,0,preview.stderr);state(JSON.parse(preview.stdout),'planned');
  const apply=run(['connect',...args,'--apply']);assert.equal(apply.status,0,apply.stderr);state(JSON.parse(apply.stdout),'applied');
  const daemon=await start(f.momentHome);f.cleanup(()=>stop(daemon));
  const client=createClient(f.momentHome),contextId=randomUUID(),id=randomUUID();
  assert.equal((await client.call('context.create',{id:contextId,label:'Preserved by disconnect',bootstrapProfile:'owner-local',idempotencyKey:'create',limits})).ok,true);
  assert.equal((await client.call('incident.create',{contextId,expectedRevision:1,idempotencyKey:'incident',id,incident})).ok,true);
  const credential=readFileSync(join(f.momentHome,'runtime/owner.json'),'utf8');
  const goal=join(f.momentHome,'retained-intent.md');writeFileSync(goal,'Retain this explicit intent\n',{mode:0o600});
  const removed=run(['disconnect',...args,'--apply']);assert.equal(removed.status,0,removed.stderr);state(JSON.parse(removed.stdout),'applied');
  assert.equal((await client.call('incident.get',{contextId,incidentId:id})).value.value.purpose,incident.purpose);
  assert.equal(readFileSync(join(f.momentHome,'runtime/owner.json'),'utf8'),credential);assert.equal(readFileSync(goal,'utf8'),'Retain this explicit intent\n');
  assert.equal(readFileSync(f.target,'utf8'),original);
});
