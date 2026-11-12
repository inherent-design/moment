import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { bindingMap, exposedOperations, catalogIdentity } from '../runtime/bindings.mjs';
import { createClient } from '../runtime/client.mjs';
import { digest } from '../runtime/json.mjs';
import { createService } from '../runtime/service.mjs';
import { start, stop, cli } from './daemon-fixture.mjs';
import { limits, incident } from './helpers.mjs';

async function connect(t,root,version='2025-11-25',profile='continuity') {
  const versions=[];
  class VersionTransport extends StdioClientTransport {
    async send(message) {
      if(message.method==='initialize') {message={...message,params:{...message.params,protocolVersion:version}};versions.push(message.params.protocolVersion);}
      if(message.params?._meta?.['io.modelcontextprotocol/protocolVersion']) versions.push(message.params._meta['io.modelcontextprotocol/protocolVersion']);
      return super.send(message);
    }
  }
  const transport=new VersionTransport({command:process.execPath,args:[cli.pathname,'mcp','--profile',profile],env:{PATH:process.env.PATH,MOMENT_HOME:root},stderr:'pipe',maxBufferSize:1048576});
  let diagnostics='';transport.stderr.on('data',bytes=>{diagnostics=(diagnostics+bytes).slice(-8192);});
  const client=new Client({name:'moment-conformance',version:'1'},{...(version==='2026-07-28'?{versionNegotiation:{mode:{pin:version}}}:{})});
  t.after(()=>client.close());
  await client.connect(transport);
  return {client,transport,versions,diagnostics:()=>diagnostics};
}

test('SDK negotiates legacy and modern revisions and discovers the exact offline profile without initializing state',async t=>{
  const parent=mkdtempSync(join(tmpdir(),'moment-mcp-offline-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
  for(const version of ['2025-06-18','2025-11-25','2026-07-28']) {
    const root=join(parent,version),f=await connect(t,root,version);
    const listing=await f.client.listTools();
    assert.deepEqual(listing.tools.map(tool=>tool.name).sort(),exposedOperations().map(id=>bindingMap.get(id).mcpName).sort());
    for(const tool of listing.tools) {
      const binding=[...bindingMap.values()].find(b=>b.mcpName===tool.name);
      assert.deepEqual(tool.inputSchema,binding.inputSchema.document);
      assert.deepEqual(tool.outputSchema,binding.envelopeSchema);
      assert.equal(tool._meta['moment/catalog'],catalogIdentity.digest);
    }
    assert.ok(f.versions.includes(version),JSON.stringify(f.versions));
    const result=await f.client.callTool({name:'moment_bindings_discover',arguments:{operationId:'workspace.read'}});
    assert.equal(result.isError,false);assert.equal(result.structuredContent.result.ok,true);
    assert.deepEqual(JSON.parse(result.content[0].text),result.structuredContent);
    assert.equal(existsSync(root),false);
    await f.client.close();assert.equal(f.diagnostics(),'');
  }
});

test('actual SDK bridge shares admitted kernel results and preserves its service after bridge exit',async t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-mcp-live-')),child=await start(root);
  t.after(async()=>{await stop(child);rmSync(root,{recursive:true,force:true});});
  const {client}=await connect(t,root),native=createClient(root),contextId=randomUUID(),id=randomUUID();
  const invoke=async(operation,input)=>client.callTool({name:bindingMap.get(operation).mcpName,arguments:input});
  const input={id:contextId,label:'MCP context',bootstrapProfile:'owner-local',idempotencyKey:'bootstrap',limits};
  const created=await invoke('context.create',input);
  assert.equal(created.structuredContent.result.ok,true,JSON.stringify(created));
  assert.deepEqual(created.structuredContent.result,await native.call('context.create',input));
  const mutation={contextId,expectedRevision:1,idempotencyKey:'save',id,incident};
  const saved=await invoke('incident.create',mutation);assert.equal(saved.structuredContent.result.ok,true);
  assert.deepEqual(saved.structuredContent.result,await native.call('incident.create',mutation));
  const attachment=await invoke('workspace.attach',{contextId,incidentId:id});
  assert.equal(attachment.structuredContent.result.value.attachment.incidentId,id);
  const description=await native.call('system.describe',{protocolVersion:'0.1'});
  const packet=await invoke('workspace.read',{target:{systemId:description.value.systemId,contextId,incidentId:id}});
  assert.equal(packet.structuredContent.result.value.incident.value.purpose,incident.purpose);
  const stale=await invoke('incident.create',{...mutation,id:randomUUID(),idempotencyKey:'stale'});
  assert.equal(stale.isError,true);assert.equal(stale.structuredContent.result.error.code,'REVISION_CONFLICT');
  const invalid=await invoke('incident.create',{...mutation,unexpected:true});
  assert.equal(invalid.isError,true);assert.equal(invalid.structuredContent?.result.error.code,'INVALID_ARGUMENT',JSON.stringify(invalid));
  await client.close();
  assert.equal((await native.call('context.get',{contextId})).value.revision,2);
});

test('strict framing refuses duplicates, malformed UTF-8, oversized and incomplete input before SDK decode',async t=>{
  const parent=mkdtempSync(join(tmpdir(),'moment-mcp-frame-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
  for(const bytes of [Buffer.from('{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}\n'),Buffer.from('{"a":1,"\\u0061":2}\n'),Buffer.from([123,34,120,34,58,34,255,34,125,10]),Buffer.alloc(1048578,32),Buffer.from('{')]) {
    const root=join(parent,randomUUID()),child=spawn(process.execPath,[cli.pathname,'mcp'],{env:{PATH:process.env.PATH,MOMENT_HOME:root},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',bytes=>stdout+=bytes);child.stderr.on('data',bytes=>stderr+=bytes);
    const exit=once(child,'exit');child.stdin.on('error',()=>{});child.stdin.end(bytes);
    const timer=setTimeout(()=>child.kill('SIGKILL'),5000);const [code]=await exit;clearTimeout(timer);
    assert.equal(code,1,stderr);assert.equal(stdout,'');assert.match(stderr,/framing/);assert.equal(existsSync(root),false);
  }
});

test('oversized admitted MCP results retain a private exact request for receipt reconciliation',async t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-mcp-retry-')),child=await start(root);
  t.after(async()=>{await stop(child);rmSync(root,{recursive:true,force:true});});
  const {client}=await connect(t,root,'2025-06-18','operator'),native=createClient(root),contextId=randomUUID();
  assert.equal((await native.call('context.create',{id:contextId,label:'Bounded MCP result',bootstrapProfile:'owner-local',idempotencyKey:'bootstrap',limits})).ok,true);
  const document={type:'string',$comment:'x'.repeat(600000)},schema={name:'fixture.mcp-large',version:'1',digest:digest(document)};
  const input={contextId,expectedRevision:1,idempotencyKey:'large-result',schema,document};
  const response=await client.callTool({name:'moment_schema_publish',arguments:input});
  assert.equal(response.isError,true);const result=response.structuredContent.result;
  assert.equal(result.error.code,'OUTCOME_UNKNOWN',JSON.stringify(response));
  assert.ok(Buffer.byteLength(JSON.stringify(response))<1048576);
  const retained=JSON.parse(readFileSync(result.error.details.requestFile,'utf8'));
  assert.equal(statSync(result.error.details.requestFile).mode&0o077,0);
  assert.deepEqual(retained.params,input);assert.equal(retained.method,'schema.publish');assert.equal(Object.hasOwn(retained,'token'),false);
  assert.equal((await native.call('context.get',{contextId})).value.revision,2);
  const retry=await native.call(retained.method,retained.params);assert.equal(retry.ok,true);
  assert.deepEqual(retry.value.value.document,document);
  assert.equal((await native.call('context.get',{contextId})).value.revision,2);
});

test('the first actual MCP domain call starts a shared service that survives both bridge connections',async t=>{
  const parent=mkdtempSync(join(tmpdir(),'moment-mm-')),root=join(parent,'s'),service=createService({root});
  t.after(async()=>{
    let state=await service.inspect();
    if(state.state==='ready') await service.stop(state.instanceId);
    for(let n=0;n<100;n++) {state=await service.inspect();if(state.state==='stopped') break;await new Promise(resolve=>setTimeout(resolve,20));}
    assert.equal(state.state,'stopped','Preserve test state if retirement cannot be proven');rmSync(parent,{recursive:true,force:true});
  });
  const peers=await Promise.all(Array.from({length:3},()=>connect(t,root))),first=peers[0],contextId=randomUUID();
  assert.equal(existsSync(root),false);
  const results=await Promise.all(peers.map(peer=>peer.client.callTool({name:'moment_context_create',arguments:{id:contextId,label:'On-demand MCP',bootstrapProfile:'owner-local',idempotencyKey:'bootstrap',limits}})));
  for(const created of results) {
    assert.equal(created.structuredContent.result.ok,true,JSON.stringify({response:created,serviceLog:existsSync(join(root,'runtime/service.log'))?readFileSync(join(root,'runtime/service.log'),'utf8'):'absent'}));
    assert.deepEqual(created.structuredContent.result,results[0].structuredContent.result);
  }
  const instance=(await service.inspect()).instanceId;
  await Promise.all(peers.map(peer=>peer.client.close()));assert.equal((await service.inspect()).instanceId,instance);
  const second=await connect(t,root);
  const attached=await second.client.callTool({name:'moment_workspace_attach',arguments:{contextId}});
  assert.equal(attached.structuredContent.result.value.attachment.contextId,contextId);
  assert.equal((await service.inspect()).instanceId,instance);
  await second.client.close();assert.equal((await service.inspect()).state,'ready');
});
