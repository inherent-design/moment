import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { bindingMap, exposedOperations, catalogIdentity, catalog } from '../runtime/bindings.mjs';
import { createClient } from '../runtime/client.mjs';
import { digest, bytesDigest } from '../runtime/json.mjs';
import {installGuidance} from '../runtime/guidance-commands.mjs';
import { installVerifier } from '../runtime/providers/bytes-runtime.mjs';
import { recommendedLimits } from '../runtime/providers/bytes-definition.mjs';
import { createService } from '../runtime/service.mjs';
import { createManaged } from '../runtime/managed.mjs';
import { managedMethods } from '../runtime/operations.mjs';
import { promptSchema } from '../runtime/builtins.mjs';
import { SessionMemory } from '../runtime/session-memory.mjs';
import { issueCredential } from '../runtime/credentials.mjs';
import { start, stop, cli } from './daemon-fixture.mjs';
import { limits, incident } from './helpers.mjs';

function cliResult(root,operation,input) {
  const reply=spawnSync(process.execPath,[cli.pathname,'call',operation,'--file','-'],{env:{...process.env,MOMENT_HOME:root},input:JSON.stringify(input),encoding:'utf8',timeout:15000,maxBuffer:2097152});
  assert.equal(reply.stderr,'');const wire=JSON.parse(reply.stdout);
  // The raw operator CLI retains the JSON-RPC envelope. Compare its explicit
  // pre-dispatch refusal to the typed clients' domain projection.
  if(wire.error){assert.ok([-32601,-32602].includes(wire.error.code));assert.equal(reply.status,1);return {ok:false,error:{code:'INVALID_ARGUMENT',message:wire.error.message,retry:'never',details:null}};}
  const result=wire.result;
  assert.equal(reply.status,result.ok?0:1);return result;
}

async function connect(t,root,version='2025-11-25',profile='continuity',credentialFile) {
  const versions=[];
  class VersionTransport extends StdioClientTransport {
    async send(message) {
      if(message.method==='initialize') {message={...message,params:{...message.params,protocolVersion:version}};versions.push(message.params.protocolVersion);}
      if(message.params?._meta?.['io.modelcontextprotocol/protocolVersion']) versions.push(message.params._meta['io.modelcontextprotocol/protocolVersion']);
      return super.send(message);
    }
  }
  const transport=new VersionTransport({command:process.execPath,args:[cli.pathname,'mcp','--profile',profile],env:{...process.env,MOMENT_HOME:root,...(credentialFile?{MOMENT_CREDENTIAL_FILE:credentialFile}:{})},stderr:'pipe',maxBufferSize:1048576});
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
    assert.equal(f.client.getInstructions(),catalog.instructions);
    const listing=await f.client.listTools();
    assert.deepEqual(listing.tools.map(tool=>tool.name).sort(),exposedOperations().map(id=>bindingMap.get(id).mcpName).sort());
    for(const tool of listing.tools) {
      const binding=[...bindingMap.values()].find(b=>b.mcpName===tool.name);
      assert.deepEqual(tool.inputSchema,binding.inputSchema.document);
      assert.deepEqual(tool.outputSchema,binding.envelopeSchema);
      assert.equal(tool._meta['moment/catalog'],catalogIdentity.digest);
      assert.equal(tool.description,[binding.summary,...binding.preconditions].join(' '));
    }
    assert.ok(f.versions.includes(version),JSON.stringify(f.versions));
    const result=await f.client.callTool({name:'moment_bindings_discover',arguments:{operationId:'workspace.read'}});
    assert.equal(result.isError,false);assert.equal(result.structuredContent.result.ok,true);
    assert.equal(result._meta['moment/protocolVersion'],version);
    assert.deepEqual(JSON.parse(result.content[0].text),result.structuredContent);
    assert.equal(existsSync(root),false);
    await f.client.close();assert.equal(f.diagnostics(),'');
  }
});

test('historical initial states share evidence and retry semantics across actual MCP, native and CLI surfaces',async t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-mcp-history-')),child=await start(root);
  t.after(async()=>{await stop(child);rmSync(root,{recursive:true,force:true});});
  const {client}=await connect(t,root),native=createClient(root),contextId=randomUUID(),id=randomUUID();
  const invoke=async(operation,input)=>client.callTool({name:bindingMap.get(operation).mcpName,arguments:input});
  assert.equal((await native.call('context.create',{id:contextId,label:'Historical intake',bootstrapProfile:'owner-local',idempotencyKey:'bootstrap',limits})).ok,true);
  const document={type:'string'},sourceSchema={name:'test.historical-intent',version:'1',digest:digest(document)};
  assert.equal((await native.call('schema.publish',{contextId,expectedRevision:1,idempotencyKey:'source-schema',schema:sourceSchema,document})).ok,true);
  const sourceRef={systemId:(await native.call('system.describe',{protocolVersion:'0.1'})).value.systemId,contextId,id:randomUUID()};
  assert.equal((await native.call('graph.transact',{contextId,expectedRevision:2,idempotencyKey:'source',changes:[{kind:'record.put',record:{kind:'atom',id:sourceRef.id,schema:sourceSchema,value:'Fixture original intent reports completed prior work.'}}]})).ok,true);
  const evidence={sources:[sourceRef],artifactDigests:[],method:'Retain the admitted historical source without replaying work'};
  const input={contextId,expectedRevision:3,idempotencyKey:'historical-completion',id,incident:{...incident,status:'completed'},evidence};
  const saved=await invoke('incident.create',input);assert.equal(saved.structuredContent.result.ok,true,JSON.stringify(saved));
  assert.deepEqual(saved.structuredContent.result.value.evidence,evidence);
  assert.deepEqual(saved.structuredContent.result,await native.call('incident.create',input));
  assert.deepEqual(saved.structuredContent.result,cliResult(root,'incident.create',input));
  const packet=await invoke('workspace.read',{target:{systemId:sourceRef.systemId,contextId,incidentId:id}});
  assert.equal(packet.structuredContent.result.value.incident.value.status,'completed');
  assert.deepEqual(packet.structuredContent.result.value.incident.evidence,evidence);
  assert.equal((await native.call('incident.list',{contextId,statuses:['open','resting'],limit:10})).value.items.length,0);
  const invalid={...input,expectedRevision:4,id:randomUUID(),idempotencyKey:'missing-history-evidence'};delete invalid.evidence;
  const refused=await invoke('incident.create',invalid);
  assert.equal(refused.structuredContent?.result.error.code,'INVALID_ARGUMENT');
  assert.deepEqual(refused.structuredContent.result,await native.call('incident.create',invalid));
  assert.deepEqual(refused.structuredContent.result,cliResult(root,'incident.create',invalid));
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
  const staleInput={...mutation,id:randomUUID(),idempotencyKey:'stale'},stale=await invoke('incident.create',staleInput);
  assert.equal(stale.isError,true);assert.equal(stale.structuredContent.result.error.code,'REVISION_CONFLICT');
  assert.deepEqual(stale.structuredContent.result,cliResult(root,'incident.create',staleInput));
  const invalid=await invoke('incident.create',{...mutation,unexpected:true});
  assert.equal(invalid.isError,true);assert.equal(invalid.structuredContent?.result.error.code,'INVALID_ARGUMENT',JSON.stringify(invalid));
  assert.deepEqual(invalid.structuredContent.result,await native.call('incident.create',{...mutation,unexpected:true}));
  assert.deepEqual(invalid.structuredContent.result,cliResult(root,'incident.create',{...mutation,unexpected:true}));
  const tooMany={contextId,expectedRevision:2,idempotencyKey:'too-many-changes',changes:Array.from({length:20001},()=>({}))};
  const refused=await invoke('graph.transact',tooMany);
  assert.deepEqual(refused.structuredContent?.result,await native.call('graph.transact',tooMany));
  assert.deepEqual(refused.structuredContent.result,cliResult(root,'graph.transact',tooMany));
  assert.equal(refused.structuredContent.result.error.code,'INVALID_ARGUMENT');
  await client.close();
  assert.equal((await native.call('context.get',{contextId})).value.revision,2);
});

test('strict framing refuses duplicates, malformed UTF-8, oversized and incomplete input before SDK decode',async t=>{
  const parent=mkdtempSync(join(tmpdir(),'moment-mcp-frame-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
  for(const bytes of [Buffer.from('{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}\n'),Buffer.from('{"a":1,"\\u0061":2}\n'),Buffer.from([123,34,120,34,58,34,255,34,125,10]),Buffer.alloc(1048578,32),Buffer.from('{')]) {
    const root=join(parent,randomUUID()),child=spawn(process.execPath,[cli.pathname,'mcp'],{env:{...process.env,MOMENT_HOME:root},stdio:['pipe','pipe','pipe']});
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

test('MCP distinguishes a successful failed-execution read from a fault and preserves real late completion after cancellation',async t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-mx-')),child=await start(root,{entrypoint:new URL('./held-provider.mjs',import.meta.url)});
  t.after(async()=>{if(child.exitCode===null && child.signalCode===null) await stop(child,'SIGKILL');rmSync(root,{recursive:true,force:true});});
  const {client}=await connect(t,root,'2025-06-18','operator'),native=createClient(root),contextId=randomUUID(),incidentId=randomUUID();
  const envelope={...recommendedLimits('USD'),cpuMillis:100000,outputBytes:100000};
  const call=async(method,input)=>{const result=await native.call(method,input);assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
  const mutate=async(method,input)=>call(method,{contextId,expectedRevision:(await call('context.get',{contextId})).revision,idempotencyKey:randomUUID(),...input});
  await call('context.create',{id:contextId,label:'Actual MCP outcome',bootstrapProfile:'owner-local',idempotencyKey:'create',limits:envelope});
  await mutate('incident.create',{id:incidentId,incident});const registration=await installVerifier(root,contextId),executionId=randomUUID();
  const bytes=Buffer.from('Real completion precedes its delayed delivery');
  await mutate('execution.request',{execution:{id:executionId,incidentId,capability:registration.capability,grant:registration.grant,input:{contentBase64:bytes.toString('base64'),expectedDigest:bytesDigest(bytes)},limits:registration.limits}});
  const until=Date.now()+5000;
  while(!existsSync(join(root,'before-finish.json'))) {assert.equal(child.exitCode,null);assert.ok(Date.now()<until,'Actual worker did not reach the owned delivery barrier');await new Promise(resolve=>setTimeout(resolve,20));}
  const cancellation={contextId,expectedRevision:(await call('context.get',{contextId})).revision,idempotencyKey:'explicit-cancel',executionId,reason:'Cancel races with a real retained result'};
  const cancelled=await client.callTool({name:'moment_execution_cancel',arguments:cancellation});assert.equal(cancelled.isError,false,JSON.stringify(cancelled));
  assert.deepEqual(cancelled.structuredContent.result,await native.call('execution.cancel',cancellation));
  writeFileSync(join(root,'release-finish'),'release',{mode:0o600});
  async function terminal(id) {
    const until=Date.now()+5000;
    do {const value=await call('execution.get',{contextId,executionId:id});if(['succeeded','failed'].includes(value.state)) return value;await new Promise(resolve=>setTimeout(resolve,20));}while(Date.now()<until);
    assert.fail('Retained execution did not reach its observed outcome');
  }
  const observed=await terminal(executionId);assert.equal(observed.state,'succeeded');assert.equal(observed.outcome.output.observedDigest,bytesDigest(bytes));
  // Retire the first test-only barrier marker; the retained release lets the
  // next real report return immediately. Provider receipts remain untouched.
  rmSync(join(root,'before-finish.json'));
  const failedId=randomUUID();
  await mutate('execution.request',{execution:{id:failedId,incidentId,capability:registration.capability,grant:registration.grant,input:{contentBase64:bytes.toString('base64'),expectedDigest:'sha256:'+'0'.repeat(64)},limits:registration.limits}});
  const failed=await terminal(failedId);
  assert.equal(failed.state,'failed');
  const read=await client.callTool({name:'moment_execution_get',arguments:{contextId,executionId:failedId}});
  assert.equal(read.isError,false,JSON.stringify(read));assert.equal(read.structuredContent.result.ok,true);assert.equal(read.structuredContent.result.value.state,'failed');
});

test('every continuity tool executes a connected admitted workflow with native-equivalent outcomes',async t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-ma-')),child=await start(root);
  t.after(async()=>{await stop(child);rmSync(root,{recursive:true,force:true});});
  const {client}=await connect(t,root),native=createClient(root),managed=createManaged({root}),seen=new Set();
  const equivalent=async(operation,input)=>{
    const mcp=await client.callTool({name:bindingMap.get(operation).mcpName,arguments:input}),result=mcp.structuredContent?.result;
    assert.equal(result?.ok,true,JSON.stringify(mcp));assert.equal(mcp.isError,false);assert.deepEqual(JSON.parse(mcp.content[0].text),mcp.structuredContent);
    const other=await (managedMethods.includes(operation)?managed:native).call(operation,input);
    if(operation==='events.read') {
      assert.equal(typeof result.value.nextCursor,'string');assert.equal(typeof other.value.nextCursor,'string');
      const {nextCursor:a,...first}=result.value,{nextCursor:b,...second}=other.value;assert.deepEqual(first,second);
    } else if(['memory.configure','memory.focus'].includes(operation)) {const {replayed:a,...first}=result.value,{replayed:b,...second}=other.value;assert.equal(a,false);assert.equal(b,true);assert.deepEqual(first,second);}
    else assert.deepEqual(result,other);
    if(!managedMethods.includes(operation)) {
      const cli=cliResult(root,operation,input);
      if(operation==='events.read') {
        const {nextCursor:a,...first}=result.value,{nextCursor:b,...second}=cli.value;assert.equal(typeof b,'string');assert.deepEqual(first,second);
      } else if(['memory.configure','memory.focus'].includes(operation)) {const {replayed:a,...first}=result.value,{replayed:b,...second}=cli.value;assert.equal(b,true);assert.deepEqual(first,second);}
      else assert.deepEqual(result,cli);
    }
    seen.add(operation);return result.value;
  };
  const contextId=randomUUID(),incidentId=randomUUID(),system=(await native.call('system.describe',{protocolVersion:'0.1'})).value;
  const ref=id=>({systemId:system.systemId,contextId,id}),context=async()=>{const result=await native.call('context.get',{contextId});assert.equal(result.ok,true);return result.value;};
  const write=async(operation,input)=>equivalent(operation,{contextId,expectedRevision:(await context()).revision,idempotencyKey:randomUUID(),...input});
  await equivalent('bindings.discover',{operationId:'workspace.read'});
  await equivalent('context.create',{id:contextId,label:'Complete continuity profile',bootstrapProfile:'owner-local',idempotencyKey:'create',limits:{...limits,cpuMillis:300000,memoryBytes:268435456,outputBytes:1048576,modelTokens:100000}});
  await write('incident.create',{id:incidentId,incident});
  const document={type:'string'},schema={name:'fixture.continuity',version:'1',digest:digest(document)};
  assert.equal((await native.call('schema.publish',{contextId,expectedRevision:(await context()).revision,idempotencyKey:'schema',schema,document})).ok,true);
  const sourceId=randomUUID(),templateId=randomUUID(),evidence={sources:[],method:'Owner admits SDK boundary fixture',artifactDigests:[]};
  await write('graph.transact',{changes:[
    {kind:'record.put',record:{kind:'atom',id:sourceId,schema,value:'Observed through the actual SDK bridge'}},
    {kind:'record.put',record:{kind:'atom',id:templateId,schema:promptSchema,value:{text:'Summarize {{source}} as quoted evidence.',sourceSlots:['source']}}},
    ...[sourceId,templateId].map(id=>({kind:'assertion.put',assertion:{id:randomUUID(),record:ref(id),evidence}})),
  ]});
  await write('incident.update',{incidentId,incident:{...incident,continuation:[ref(sourceId)]},evidence:{...evidence,sources:[ref(sourceId)]}});
  await equivalent('workspace.attach',{contextId,incidentId});
  await equivalent('workspace.read',{target:{systemId:system.systemId,contextId,incidentId},detailRefs:[ref(sourceId)]});
  await equivalent('captures.read',{target:{systemId:system.systemId,contextId,incidentId}});
  await equivalent('graph.query',{contextId,selector:{ids:[sourceId],assertionStatus:'asserted'},limit:20});
  const basis=await context(),proposalId=randomUUID(),reified=randomUUID();
  await write('transition.propose',{proposal:{id:proposalId,incidentId,basisRevision:basis.revision,policy:basis.policy,changes:[{kind:'record.put',record:{kind:'atom',id:reified,schema,value:'Admitted reification'}}],executions:[],evidence:{...evidence,sources:[ref(sourceId)]}}});
  await write('transition.commit',{proposalId});
  const messageId=randomUUID();
  await write('messages.send',{message:{id:messageId,incidentId,recipientId:system.principalId,kind:'notice',summary:'An admitted transition is available for review',detailRefs:[ref(sourceId)]}});
  await equivalent('messages.read',{contextId,limit:20,includeAcknowledged:false});
  await write('messages.ack',{messageIds:[messageId]});
  await equivalent('prompt.compose',{contextId,incidentId,template:ref(templateId),sourceRefs:[ref(sourceId)],outputSchema:schema,maximumInputBytes:16384});
  await equivalent('events.read',{contextId,limit:100,waitMillis:0});
  const memorySession={runtimeId:'sdk-fixture',sessionId:randomUUID()};
  const enrollment=await equivalent('memory.configure',{session:memorySession,expectedRevision:0,idempotencyKey:'sdk-enroll',enabled:true});
  assert.equal(enrollment.subscription.enabled,true);assert.equal(enrollment.subscription.revision,1);
  const memoryInput=await native.call('memory.observe',{session:memorySession,deliveryId:'sdk-source',message:{text:'Maybe preserve this wording as a proposal.',authorship:'human'}});
  assert.equal(memoryInput.ok,true,JSON.stringify(memoryInput));
  const memory=await equivalent('memory.read',{session:memorySession,sourceIds:memoryInput.value.sourceIds});
  assert.equal(memory.sources[0].text,'Maybe preserve this wording as a proposal.');assert.equal(memory.pending.length,1);assert.equal(memory.worker.state,'disabled');
  const component=new SessionMemory(join(root,'runtime/session-memory.sqlite'),system.systemId);
  let assessedReceipt;
  try {
    const dispatch=component.claim({id:'owned-sdk-fixture',model:'scripted'});
    assessedReceipt=component.finish(dispatch.id,{kind:'replace',entries:[{sourceId:memoryInput.value.sourceIds[0],weight:0.8}],explanation:'Retain the tentative qualification for later continuation.'});
    assert.equal(assessedReceipt.status,'succeeded');
  } finally {component.close();}
  const assessed=await equivalent('memory.read',{session:memorySession});assert.deepEqual(assessed.lastAssessment,{dispatchId:assessedReceipt.dispatchId,sequence:1,explanation:assessedReceipt.explanation,workingSetId:assessed.focus.workingSetId,incomingSourceIds:memoryInput.value.sourceIds,basisAvailability:'retained'});assert.equal(assessed.pending.length,0);
  const history=await equivalent('memory.assessments.read',{session:memorySession,assessmentId:assessedReceipt.dispatchId,maximumBytes:262144});assert.equal(history.assessment.request.sources[0].text,'Maybe preserve this wording as a proposal.');assert.equal(history.assessment.outcome.receipt.status,'succeeded');
  const workTarget={systemId:system.systemId,contextId,incidentId};
  const changed=await equivalent('memory.focus',{session:memorySession,expectedFocusRevision:0,idempotencyKey:'sdk-focus',action:{kind:'select',purposeKey:'bounded-sdk-work',seedFrom:assessed.focus.workingSetId,work:workTarget}});assert.equal(changed.focus.revision,1);
  const selected=await equivalent('memory.read',{session:memorySession,includeWorkingSets:true});assert.equal(selected.focus.workingSetId,changed.focus.workingSetId);assert.equal(selected.workingSets.length,2);assert.equal(selected.entries[0].sourceId,memoryInput.value.sourceIds[0]);
  assert.deepEqual(selected.bindings.work.target,workTarget);
  const registeredId=randomUUID();
  await write('guidance.register',{id:registeredId,definition:{label:'SDK guide',locator:{kind:'record',ref:ref(sourceId)},selection:{kind:'json-pointer',pointer:'/value'},locations:[root],classification:'private',evidence},active:true});
  await write('guidance.refresh',{sourceId:registeredId});
  const registration=await installGuidance(root,contextId,{additionalRefs:[ref(sourceId)]});assert.equal(registration.state,'ready');
  const guidance=await equivalent('guidance.read',{contextId,location:root});assert.equal(guidance.captures[0].text,'Observed through the actual SDK bridge');
  const sourceBinding={source:ref(registeredId),capture:guidance.captures[0].stored.ref,contentDigest:bytesDigest(guidance.captures[0].text),representation:'selected',applicability:'Only for this owned SDK bridge task.',materialOmissions:[]};
  await equivalent('memory.focus',{session:memorySession,expectedFocusRevision:1,idempotencyKey:'sdk-guidance-binding',action:{kind:'select',purposeKey:'bounded-sdk-work',guidance:[sourceBinding]}});
  const bound=await equivalent('memory.read',{session:memorySession});assert.deepEqual(bound.bindings.guidance[0].binding,sourceBinding);assert.deepEqual(bound.subscription,selected.subscription);
  const review=()=>({id:randomUUID(),incidentId,task:{description:'Prepare a scoped native handoff.',location:root,sourceRefs:[ref(sourceId)]},capability:registration.capability,grant:registration.grant,limits:registration.limits});
  const queued=await write('guidance.review',review());
  await equivalent('guidance.read',{contextId,executionId:queued.intent.id});
  const cancelled=await write('execution.cancel',{executionId:queued.intent.id,reason:'The native consumer withdrew this queued assessment'});assert.equal(cancelled.state,'cancelled');
  const recoverable=await write('guidance.review',review()),nativeWrite=async(operation,input)=>{
    const result=await native.call(operation,{contextId,expectedRevision:(await context()).revision,idempotencyKey:randomUUID(),...input});assert.equal(result.ok,true,JSON.stringify(result));return result.value;
  };
  const leased=await nativeWrite('execution.claim',{executionId:recoverable.intent.id,leaseMillis:30000}),lease={leaseId:leased.lease.id,fencingToken:leased.lease.fencingToken};
  await nativeWrite('execution.heartbeat',{executionId:recoverable.intent.id,...lease,leaseMillis:30000});
  const uncertain=await nativeWrite('execution.finish',{executionId:recoverable.intent.id,...lease,outcome:{kind:'unknown',detail:'Owned SDK protocol fixture',evidence:{...evidence,sources:[registration.capability]}},usage:{cpuMillis:0,memoryBytes:0,outputBytes:64,modelTokens:0,apiSpendMicrounits:0}});
  const reconciled=await write('execution.reconcile',{executionId:uncertain.intent.id,attempt:1,resolution:{kind:'observed',outcome:{kind:'cancelled',evidence:{...evidence,sources:[registration.capability]}}},usage:uncertain.usage});assert.equal(reconciled.state,'cancelled');
  assert.deepEqual([...seen].sort(),exposedOperations().sort());
});

test('the actual SDK bridge retains selected delegate scope, current revocation and missing-credential refusal',async t=>{
  const root=mkdtempSync(join(tmpdir(),'moment-md-')),child=await start(root);
  t.after(async()=>{await stop(child);rmSync(root,{recursive:true,force:true});});
  const owner=createClient(root),contextId=randomUUID(),incidentId=randomUUID(),actor=randomUUID(),allowed=randomUUID(),hidden=randomUUID();
  const call=async(method,input)=>{const result=await owner.call(method,input);assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
  const write=async(method,input)=>call(method,{contextId,expectedRevision:(await call('context.get',{contextId})).revision,idempotencyKey:randomUUID(),...input});
  await call('context.create',{id:contextId,label:'Selected MCP delegation',bootstrapProfile:'owner-local',idempotencyKey:'create',limits});
  await write('incident.create',{id:incidentId,incident});
  const system=(await call('system.describe',{protocolVersion:'0.1'})),ref=id=>({systemId:system.systemId,contextId,id}),document={type:'string'},schema={name:'fixture.delegate',version:'1',digest:digest(document)};
  await write('schema.publish',{schema,document});await write('graph.transact',{changes:[allowed,hidden].map(id=>({kind:'record.put',record:{kind:'atom',id,schema,value:id===allowed?'Selected detail':'Hidden detail'}}))});
  const context=await call('context.get',{contextId}),old=await call('control.get',{contextId,ref:context.policy}),actions=['context.get','incident.get','incident.list','graph.query'];
  const candidate=await write('policy.publish',{policy:{...old.value,id:randomUUID(),parent:context.policy,rules:[...old.value.rules,{id:'selected-mcp-actor',effect:'permit',actions,when:{kind:'equal',left:{kind:'binding',name:'principalId'},right:{kind:'literal',value:actor}}}]}});
  await write('policy.activate',{policy:candidate.ref,evidence:{sources:[],method:'Owner admits selected MCP scope',artifactDigests:[]}});
  const grant=await write('grant.issue',{grant:{id:randomUUID(),principalId:actor,actions,incidentIds:[incidentId],resourceRefs:[ref(allowed)],delegable:false,limits}}),credentialFile=issueCredential(root,actor,{[contextId]:grant.ref});
  const {client}=await connect(t,root,'2025-06-18','operator',credentialFile),native=createClient(root,{credentialFile});
  const attached=await client.callTool({name:'moment_workspace_attach',arguments:{contextId,incidentId}});
  assert.equal(attached.structuredContent.result.value.attachment.principalId,actor);
  const query={contextId,selector:{ids:[allowed,hidden],assertionStatus:'any'},limit:1};
  const selected=await client.callTool({name:'moment_graph_query',arguments:query});assert.deepEqual(selected.structuredContent.result,await native.call('graph.query',query));assert.deepEqual(selected.structuredContent.result.value.items.map(item=>item.record.ref.id),[allowed]);
  const closeInput={contextId,expectedRevision:(await call('context.get',{contextId})).revision,idempotencyKey:'denied-close',reason:'Operator profile is not an authority grant'};
  const denied=await client.callTool({name:'moment_context_close',arguments:closeInput});assert.deepEqual(denied.structuredContent.result,await native.call('context.close',closeInput));assert.equal(denied.structuredContent.result.error.code,'FORBIDDEN');
  await write('grant.revoke',{grant:grant.ref,reason:'Current authority revoked'});
  const revoked=await client.callTool({name:'moment_graph_query',arguments:query});assert.deepEqual(revoked.structuredContent.result,await native.call('graph.query',query));assert.equal(revoked.structuredContent.result.error.code,'FORBIDDEN');
  const missing=await connect(t,root,'2025-06-18','continuity',join(root,'missing.json'));
  const refused=await missing.client.callTool({name:'moment_workspace_attach',arguments:{contextId,incidentId}});
  assert.equal(refused.structuredContent.result.error.code,'UNAUTHENTICATED');assert.equal((await owner.call('context.get',{contextId})).ok,true);
});
