// Explicit opt-in: supplies one unexpired access token, never a refresh token or shared writable state.
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,openSync,fstatSync,readFileSync,closeSync,constants,existsSync,writeFileSync } from 'node:fs';
import { join,isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createClient } from '../runtime/client.mjs';
import { issueCredential } from '../runtime/credentials.mjs';
import { isolatedCodex } from '../runtime/codex.mjs';
import { installVerifier } from '../runtime/providers/bytes-runtime.mjs';
import { promptSchema } from '../runtime/builtins.mjs';
import { digest,bytesDigest,canonical } from '../runtime/json.mjs';
import { start,stop } from '../test/daemon-fixture.mjs';

const [flag,filename,...extra]=process.argv.slice(2);
if (flag!=='--credential-file' || !filename || !isAbsolute(filename) || extra.length) throw Error('Use --credential-file <absolute private Codex auth.json>; this opt-in reads only its current access session for an isolated turn');
function credentials() {
  const fd=openSync(filename,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat=fstatSync(fd);if (!stat.isFile() || stat.uid!==process.getuid() || (stat.mode&0o077) || stat.size>65536) throw Error('Credential source must be a private user-owned regular file');
    const source=JSON.parse(readFileSync(fd,'utf8')),token=source.tokens?.access_token,account=source.tokens?.account_id;
    if (typeof token!=='string' || typeof account!=='string') throw Error('Credential source has no access-token session');
    const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
    if (!Number.isFinite(claims.exp) || claims.exp*1000<Date.now()+180000) throw Error('Access session expires too soon; this check cannot refresh it');
    return { accessToken:token,chatgptAccountId:account };
  } finally { closeSync(fd); }
}
const root=mkdtempSync(join(tmpdir(),'moment-live-'));let daemon,native;
try {
  daemon=await start(root);const owner=createClient(root),contextId=randomUUID(),incidentId=randomUUID(),actor=randomUUID(),observationId=randomUUID(),assertionId=randomUUID(),templateId=randomUUID();
  const call=async(client,method,input)=>{ const result=await client.call(method,input);if (!result.ok) throw Error('Moment refused '+method+' ('+result.error.code+')');return result.value; };
  const write=async(client,method,input)=>{ for (let count=0;count<16;count++) { const revision=(await call(owner,'context.get',{ contextId })).revision,result=await client.call(method,{ contextId,expectedRevision:revision,idempotencyKey:randomUUID(),...input });if (result.ok) return result.value;if (result.error.code!=='REVISION_CONFLICT') throw Error('Moment refused '+method+' ('+result.error.code+')'); }throw Error('Moment revision did not settle'); };
  const systemId=(await call(owner,'system.describe',{ protocolVersion:'0.1' })).systemId,ref=id=>({ systemId,contextId,id });
  const limits={ concurrentExecutions:1,cpuMillis:100000,memoryBytes:268435456,outputBytes:100000,modelTokens:0,apiSpendMicrounits:0,currency:'USD' };
  await call(owner,'context.create',{ id:contextId,label:'Isolated native connection check',bootstrapProfile:'owner-local',idempotencyKey:'bootstrap',limits });
  await write(owner,'incident.create',{ id:incidentId,incident:{ purpose:'Describe an actual verifier receipt through a restricted native connection',completionCriteria:['An authorized native observation refers to a real verifier result'],status:'open',continuation:[] } });
  const registration=await installVerifier(root,contextId),bytes=Buffer.from('Moment connected native verification fixture\n'),executionId=randomUUID();
  writeFileSync(join(root,'fixture.bin'),bytes,{ mode:0o600 });
  await write(owner,'execution.request',{ execution:{ id:executionId,incidentId,capability:registration.capability,grant:registration.grant,input:{ contentBase64:bytes.toString('base64'),expectedDigest:bytesDigest(readFileSync(join(root,'fixture.bin'))) },limits:registration.limits } });
  let execution;
  for (let count=0;count<100;count++) { execution=await call(owner,'execution.get',{ contextId,executionId });if (execution.state==='succeeded') break;await new Promise(resolve=>setTimeout(resolve,25)); }
  assert.equal(execution.state,'succeeded');const receipt=execution.outcome.evidence.sources[0];
  const outputDocument={ type:'object',properties:{ observation:{ type:'string',maxLength:1024 } },required:['observation'],additionalProperties:false },outputSchema={ name:'native.observation',version:'1',digest:digest(outputDocument) };
  const outputStored=await write(owner,'schema.publish',{ schema:outputSchema,document:outputDocument });
  await write(owner,'graph.transact',{ changes:[{ kind:'record.put',record:{ kind:'atom',id:templateId,schema:promptSchema,value:{ text:'Describe the observed digest result, byte length and limits of this actual receipt: {{receipt}}',sourceSlots:['receipt'] } } },{ kind:'assertion.put',assertion:{ id:randomUUID(),record:ref(templateId),evidence:{ sources:[receipt],artifactDigests:[],method:'Operator admits bounded receipt-description instructions' } } }] });
  const context=await call(owner,'context.get',{ contextId }),policy=(await call(owner,'control.get',{ contextId,ref:context.policy })).value,actions=['prompt.compose','incident.get','graph.query','graph.transact'];
  const published=await write(owner,'policy.publish',{ policy:{ ...policy,id:randomUUID(),parent:context.policy,rules:[...policy.rules,{ id:'native-observer',effect:'permit',actions,when:{ kind:'equal',left:{ kind:'binding',name:'principalId' },right:{ kind:'literal',value:actor } } }] } });
  await write(owner,'policy.activate',{ policy:published.ref,evidence:{ sources:[],artifactDigests:[],method:'Owner permits bounded native observation' } });
  const grant=await write(owner,'grant.issue',{ grant:{ id:randomUUID(),principalId:actor,actions,incidentIds:[incidentId],resourceRefs:[receipt,ref(templateId),ref(observationId),outputStored.ref],delegable:false,limits } });
  const agent=createClient(root,{ credentialFile:issueCredential(root,actor,{ [contextId]:grant.ref }) }),promptInput={ contextId,incidentId,template:ref(templateId),sourceRefs:[receipt],outputSchema,maximumInputBytes:16384 };
  let prompt,submission;const toolNames=[];
  const tools=[{ type:'function',name:'moment_context',description:'Read the assigned incident and actual verifier receipt through current Moment authority.',inputSchema:{ type:'object',properties:{},additionalProperties:false } },{ type:'function',name:'moment_observe',description:'Submit one attributed observation to the assigned incident through schema and grant admission.',inputSchema:outputDocument }];
  native=await isolatedCodex({ credentials:credentials(),tools,onTool:async(name,args)=>{
    toolNames.push(name);
    if (name==='moment_context') { assert.deepEqual(args,{});prompt=await call(agent,'prompt.compose',promptInput);return prompt; }
    if (name==='moment_observe') {
      assert.ok(prompt,'Context must be retrieved first');
      if (submission) { assert.equal(canonical(args),canonical(submission));return { observed:true,record:ref(observationId) }; }
      await write(agent,'graph.transact',{ changes:[{ kind:'record.put',record:{ kind:'atom',id:observationId,schema:outputSchema,value:args } },{ kind:'assertion.put',assertion:{ id:assertionId,record:ref(observationId),evidence:{ sources:[receipt],artifactDigests:[prompt.digest],method:'Native model observation; not independent verification' } } }] });submission=args;return { observed:true,record:ref(observationId) };
    }
    throw Error('Unassigned tool');
  } });
  const account=await native.account();assert.equal(account.authenticated,true);assert.equal(account.persistedAuth,false);
  const result=await native.invoke({ instruction:'Call moment_context. Read its instructions and quoted actual verifier receipt. Submit a concise factual observation using moment_observe, acknowledging that Node guards are not an OS sandbox. Then return {"submitted":true}.',outputSchema:{ type:'object',properties:{ submitted:{ const:true } },required:['submitted'],additionalProperties:false } });
  assert.ok(prompt && submission);assert.ok(toolNames.includes('moment_context') && toolNames.includes('moment_observe'));
  await native.close();native=undefined;await stop(daemon,'SIGKILL');daemon=await start(root);
  const saved=await call(agent,'graph.query',{ contextId,selector:{ ids:[observationId],assertionStatus:'asserted' },limit:1 });
  assert.equal(saved.items[0].record.recordedBy,actor);assert.deepEqual(saved.items[0].record.value.value,submission);assert.equal(saved.items[0].support[0].assertion.value.evidence.sources[0].id,receipt.id);
  console.log(JSON.stringify({ ...result,promptDigest:prompt.digest,observation:submission,operations:toolNames,isolatedAccount:true,authPersisted:false,refreshTokenSupplied:false,primaryDaemonContacted:false,realVerifier:true,restartRetainedObservation:true },null,2));
} finally {
  await native?.close();if (daemon && daemon.exitCode===null && daemon.signalCode===null) await stop(daemon);rmSync(root,{ recursive:true,force:true });
}
