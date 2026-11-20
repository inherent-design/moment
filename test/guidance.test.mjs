import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,realpathSync,writeFileSync,rmSync,symlinkSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setup,schema,atom,allowDelegated,grant,delegated,limits,incident} from './helpers.mjs';
import {GuidanceBodies,selectSource} from '../runtime/guidance.mjs';
import {canonical} from '../runtime/json.mjs';
const evidence={sources:[],artifactDigests:[],method:'test-owned source'};
function fixture(t){const f=setup(t),root=realpathSync(mkdtempSync(join(tmpdir(),'moment-guidance-')));t.after(()=>rmSync(root,{recursive:true,force:true}));f.kernel.guidance.bodies=new GuidanceBodies(join(root,'bytes'));f.kernel.guidance.fileRoots=[root];return {...f,f,root};}
function registered(f,root,text='Use pnpm. Keep task-specific scope.',selection={kind:'whole'}) {
 const path=join(root,randomUUID()+'.md');writeFileSync(path,text);const id=randomUUID(),definition={label:'Project guide',locator:{kind:'file',path},selection,locations:[root],classification:'private',evidence};
 const put=f.write('guidance.register',{id,definition,active:true});assert.equal(put.ok,true,JSON.stringify(put));return {id,definition,path,ref:put.value.ref};
}
test('registered files refresh explicitly; read is inert, repeated refresh deduplicates body/capture; original and selected digests differ',t=>{
 const {f,root}=fixture(t),s=registered(f,root,'Intro\nUse pnpm.\nOther\n',{kind:'lines',first:2,last:2});
 assert.equal(f.call('guidance.read',{contextId:f.contextId,location:root}).value.sources[0].value.latest,undefined);
 const first=f.write('guidance.refresh',{sourceId:s.id});assert.equal(first.value.value.latest.state,'ready');
 const packet=f.call('guidance.read',{contextId:f.contextId,location:root}).value;
 assert.equal(packet.captures[0].text,'Use pnpm.\n');assert.notEqual(packet.captures[0].stored.value.wholeDigest,packet.captures[0].stored.value.capture.contentDigest);
 const before=f.store.read(f.contextId).context.revision;writeFileSync(s.path,'CHANGED\nNew guidance\n');
 assert.equal(f.call('guidance.read',{contextId:f.contextId,sourceIds:[s.id]}).value.captures[0].text,'Use pnpm.\n');assert.equal(f.store.read(f.contextId).context.revision,before);
 const second=f.write('guidance.refresh',{sourceId:s.id});assert.notEqual(second.value.value.latest.capture.id,first.value.value.latest.capture.id);
 f.write('guidance.refresh',{sourceId:s.id});assert.equal(Object.keys(f.store.read(f.contextId).controlState.guidanceCaptures).length,2);
 assert.equal(f.call('guidance.read',{contextId:f.contextId,captureIds:[first.value.value.latest.capture.id]}).value.captures[0].text,'Use pnpm.\n');
});
test('file capture refuses unregistered capability, symlink resolution, missing and oversize without destroying history',t=>{
 const {f,root}=fixture(t),s=registered(f,root);const first=f.write('guidance.refresh',{sourceId:s.id}).value.value.latest.capture;
 rmSync(s.path);assert.equal(f.write('guidance.refresh',{sourceId:s.id}).value.value.latest.state,'missing');
 const history=f.call('guidance.read',{contextId:f.contextId,sourceIds:[s.id]}).value;assert.equal(history.captures[0].text,'Use pnpm. Keep task-specific scope.');assert.equal(history.captures[0].freshness,'historical');
 const outside=join(root,'target');writeFileSync(outside,'new');symlinkSync(outside,s.path);
 assert.equal(f.write('guidance.refresh',{sourceId:s.id}).value.value.latest.state,'changed');rmSync(s.path);writeFileSync(s.path,'x'.repeat(262145));
 assert.equal(f.write('guidance.refresh',{sourceId:s.id}).value.value.latest.state,'too_large');
 f.kernel.guidance.fileRoots=[];writeFileSync(s.path,'old');assert.equal(f.write('guidance.refresh',{sourceId:s.id}).value.value.latest.state,'denied');
 assert.equal(f.call('guidance.read',{contextId:f.contextId,captureIds:[first.id]}).value.captures[0].text,'Use pnpm. Keep task-specific scope.');
});
test('record text fields retain decoded-string transformation and exact whole basis; reads respect dependent source permissions',t=>{
 const {f,root}=fixture(t),a={...atom(schema(f,{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false})),value:{text:'Keep “flavor”\nOriginal.'}};
 assert.equal(f.write('graph.transact',{changes:[{kind:'record.put',record:a}]}).ok,true);
 const ref=f.kernel.ref(f.contextId,a.id),id=randomUUID(),definition={label:'Recorded instruction',locator:{kind:'record',ref},selection:{kind:'json-pointer',pointer:'/value/text'},locations:[root],classification:'private',evidence};
 assert.equal(f.write('guidance.register',{id,definition,active:true}).ok,true);const fresh=f.write('guidance.refresh',{sourceId:id}).value;
 const p=f.call('guidance.read',{contextId:f.contextId,sourceIds:[id]}).value;
 assert.equal(p.captures[0].text,a.value.text);assert.equal(p.captures[0].stored.value.transformation,'json-string');
 const actor=randomUUID();allowDelegated(f);const bound=grant(f,actor,{actions:['guidance.read','guidance.refresh','control.get'],resourceRefs:[fresh.ref],limits});
 assert.equal(delegated(f,actor,bound,'guidance.read',{sourceIds:[id]}).error.code,'NOT_FOUND');
 const allowed=grant(f,actor,{actions:['guidance.read','guidance.refresh','control.get'],resourceRefs:[fresh.ref,ref,p.captures[0].stored.ref],limits});
 assert.equal(delegated(f,actor,allowed,'guidance.read',{sourceIds:[id]}).value.captures[0].text,a.value.text);
 f.write('grant.revoke',{grant:allowed.ref,reason:'test revocation'});assert.equal(delegated(f,actor,allowed,'guidance.read',{captureIds:[fresh.value.latest.capture.id]}).error.code,'FORBIDDEN');
});
test('body storage stays outside semantic snapshots; partial reads declare recoverable omissions and retain integrity',t=>{
 const {f,root}=fixture(t),baseline=Buffer.byteLength(canonical(f.store.read(f.contextId))),text='Scoped rule.\n'.repeat(4000),s=registered(f,root,text);f.write('guidance.refresh',{sourceId:s.id});
 const snapshot=f.store.read(f.contextId);assert.ok(!canonical(snapshot).includes(text));assert.ok(Buffer.byteLength(canonical(snapshot))-baseline<8192);
 const small=f.call('guidance.read',{contextId:f.contextId,sourceIds:[s.id],maximumBytes:8192});assert.equal(small.ok,true,JSON.stringify(small));assert.equal(small.value.captures[0].text,undefined);assert.equal(small.value.omitted[0].reason,'body_budget');
 const large=f.call('guidance.read',{contextId:f.contextId,sourceIds:[s.id],maximumBytes:262144}).value;assert.equal(large.captures[0].text,text);
 const hash=large.captures[0].stored.value.capture.contentDigest;writeFileSync(f.kernel.guidance.bodies.path(hash),'tampered');
 const broken=f.call('guidance.read',{contextId:f.contextId,sourceIds:[s.id]}).value;assert.equal(broken.captures[0].text,undefined);assert.equal(broken.omitted[0].reason,'body_unavailable');
});
test('UTF8 ranges, lines and JSON field selection reject invalid or ambiguous representation boundaries',()=>{
 const bytes=Buffer.from('é\nhello\n');assert.equal(selectSource(bytes,{kind:'utf8-range',offset:3,byteLength:5}).bytes.toString(),'hello');
 assert.throws(()=>selectSource(bytes,{kind:'utf8-range',offset:1,byteLength:0}),/UTF-8/);
 assert.throws(()=>selectSource(bytes,{kind:'lines',first:2,last:8}),/unavailable/);
 assert.equal(selectSource(Buffer.from('{"x":"line\\nword"}'),{kind:'json-pointer',pointer:'/x'}).transformation,'json-string');
});
test('context ceiling revisions require operator/current evidence; keep identity, policy and grants separate and survive restart',t=>{
 const f=setup(t),a=atom(schema(f));f.write('graph.transact',{changes:[{kind:'record.put',record:a}]});const ref=f.kernel.ref(f.contextId,a.id),e={...evidence,sources:[ref]},before=f.store.read(f.contextId).context;
 const larger={...limits,modelTokens:20000};const req={contextId:f.contextId,expectedRevision:before.revision,idempotencyKey:'raise',limits:larger,evidence:e};
 assert.equal(f.call('context.limits',req).ok,true);const after=f.store.read(f.contextId).context;assert.equal(after.id,before.id);assert.deepEqual(after.policy,before.policy);assert.equal(after.limits.modelTokens,20000);
 assert.equal(f.call('context.limits',req).ok,true);assert.equal(f.store.read(f.contextId).context.revision,after.revision);
 const policy=f.kernel.lookup(f.store.read(f.contextId),after.policy).value;assert.equal(policy.limits.modelTokens,0);
 const actor=randomUUID();allowDelegated(f);const bound=grant(f,actor,{actions:['context.limits'],resourceRefs:[f.kernel.ref(f.contextId,f.contextId),ref],limits});
 assert.equal(delegated(f,actor,bound,'context.limits',{limits:larger,evidence:e},true).error.code,'FORBIDDEN');
 assert.equal(f.write('context.limits',{limits:larger,evidence}).error.code,'INVALID_ARGUMENT');
 f.reopen();assert.equal(f.store.read(f.contextId).context.limits.modelTokens,20000);
});

test('resource revision cannot undercut queued reservations or cumulative unmeasured use',t=>{
 const f=setup(t),source=atom(schema(f));f.write('graph.transact',{changes:[{kind:'record.put',record:source}]});const ref=f.kernel.ref(f.contextId,source.id),basis={...evidence,sources:[ref]},incidentId=randomUUID();f.write('incident.create',{id:incidentId,incident});
 const input=schema(f),cap=f.write('capability.advertise',{capability:{id:randomUUID(),providerId:f.ownerId,name:'test.reservation',version:'1',inputSchema:input,outputSchema:input,features:[],platform:{os:'test',architecture:'test'},isolation:'process',reconciliation:'manual',evidence,expiresAt:new Date(Date.now()+3600000).toISOString()}}).value;
 const s=f.store.read(f.contextId),p=f.kernel.lookup(s,s.context.policy).value,next=f.write('policy.publish',{policy:{...p,id:randomUUID(),rules:[...p.rules,{id:'test-profile',effect:'permit',actions:['test.reservation'],when:p.rules[0].when}]}}).value;
 f.write('policy.activate',{policy:next.ref,evidence});const bound=grant(f,f.ownerId,{actions:['execution.request','test.reservation'],resourceRefs:[cap.ref],limits});
 const id=randomUUID(),reservation={...limits,cpuMillis:9000};assert.equal(f.write('execution.request',{execution:{id,incidentId,capability:cap.ref,grant:bound.ref,input:'input',limits:reservation}}).ok,true);
 assert.equal(f.write('context.limits',{limits:{...limits,cpuMillis:8999},evidence:basis}).error.code,'LIMIT_EXCEEDED');
 assert.equal(f.write('context.limits',{limits:{...limits,currency:'EUR'},evidence:basis}).error.code,'FORBIDDEN');
 assert.equal(f.write('context.limits',{limits:{...limits,deadline:new Date(Date.now()+60000).toISOString()},evidence:basis}).error.code,'LIMIT_EXCEEDED');
 const leased=f.write('execution.claim',{executionId:id,leaseMillis:30000}).value,lease={leaseId:leased.lease.id,fencingToken:leased.lease.fencingToken};f.write('execution.heartbeat',{executionId:id,...lease,leaseMillis:30000});
 assert.equal(f.write('execution.finish',{executionId:id,...lease,outcome:{kind:'succeeded',output:'result',evidence},usage:{cpuMillis:0,memoryBytes:0,outputBytes:8,modelTokens:0,apiSpendMicrounits:0,unmeasured:['cpuMillis','memoryBytes']}}).ok,true);
 assert.equal(f.kernel.executions.totals(f.store.read(f.contextId)).cpuMillis,9000);assert.equal(f.kernel.executions.totals(f.store.read(f.contextId)).memoryBytes,0);
 assert.equal(f.write('context.limits',{limits:{...limits,cpuMillis:8999},evidence:basis}).error.code,'LIMIT_EXCEEDED');assert.equal(f.write('context.limits',{limits:{...limits,cpuMillis:9000},evidence:basis}).ok,true);
});


test('source pagination preserves discoverability under byte limits and binds the current reader/selector',t=>{
 const {f,root}=fixture(t);for(let i=0;i<20;i++)registered(f,root,'Guide '+i);
 let cursor,ids=[];
 do {const p=f.call('guidance.read',{contextId:f.contextId,location:root,maximumBytes:4096,limit:3,...(cursor?{cursor}:{})});assert.equal(p.ok,true,JSON.stringify(p));assert.ok(Buffer.byteLength(canonical(p.value))<=4096);ids.push(...p.value.sources.map(s=>s.ref.id));cursor=p.value.nextCursor;}while(cursor);
 assert.equal(new Set(ids).size,20);
 const first=f.call('guidance.read',{contextId:f.contextId,location:root,limit:1}).value;
 assert.equal(f.call('guidance.read',{contextId:f.contextId,location:root+'/other',cursor:first.nextCursor}).error.code,'INVALID_ARGUMENT');
});
