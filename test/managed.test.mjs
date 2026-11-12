import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createManaged } from '../runtime/managed.mjs';
import { createClient } from '../runtime/client.mjs';
import { issueCredential } from '../runtime/credentials.mjs';
import { digest, canonical } from '../runtime/json.mjs';
import { start, stop } from './daemon-fixture.mjs';
import { limits, incident } from './helpers.mjs';

const evidence={sources:[],method:'Managed boundary test',artifactDigests:[]};
async function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'moment-context-')),child=await start(root);
  t.after(async()=>{await stop(child);rmSync(root,{recursive:true,force:true});});
  const client=createClient(root),contextId=randomUUID(),projectId=randomUUID(),location=join(root,'project');mkdirSync(location);
  const domain=async(method,input)=>{const result=await client.call(method,input);assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
  await domain('context.create',{id:contextId,label:'Selected context',bootstrapProfile:'owner-local',idempotencyKey:'create',limits});
  const registry=JSON.parse(readFileSync(join(root,'registry.json')));
  registry.projects=[{id:projectId,label:'Selected project',locations:[{path:location,kind:'directory'}],origins:[],contextIds:[contextId]}];
  writeFileSync(join(root,'registry.json'),JSON.stringify(registry),{mode:0o600});
  const directory=join(root,'contexts',contextId);mkdirSync(directory,{recursive:true,mode:0o700});
  writeFileSync(join(directory,'manifest.json'),JSON.stringify({formatVersion:1,id:contextId,label:'Selected context',projectIds:[projectId]}),{mode:0o600});
  const write=async(method,input)=>domain(method,{contextId,expectedRevision:(await domain('context.get',{contextId})).revision,idempotencyKey:randomUUID(),...input});
  const createIncident=async(overrides={})=>write('incident.create',{id:randomUUID(),incident:{...incident,...overrides}});
  const managed=createManaged({root});
  const systemId=registry.systemId,owner=JSON.parse(readFileSync(join(root,'runtime/owner.json')));
  const delegate=async(incidentIds,resourceRefs=[],extra={})=>{
    const context=await domain('context.get',{contextId}),old=await domain('control.get',{contextId,ref:context.policy});
    const actions=['context.get','incident.get','incident.list','graph.query','control.get','messages.read'];
    const policy=await write('policy.publish',{policy:{...old.value,id:randomUUID(),parent:context.policy,rules:[...old.value.rules,{id:'admitted-delegates',effect:'permit',actions,when:{kind:'equal',left:{kind:'literal',value:true},right:{kind:'literal',value:true}}}]}});
    await write('policy.activate',{policy:policy.ref,evidence});
    const principalId=randomUUID(),grant=await write('grant.issue',{grant:{id:randomUUID(),principalId,actions,incidentIds,resourceRefs,delegable:false,limits,...extra}});
    const credentialFile=issueCredential(root,principalId,{[contextId]:grant.ref});
    return {principalId,grant,client:createClient(root,{credentialFile}),managed:createManaged({root,credentialFile}),credentialFile};
  };
  return {root,contextId,projectId,systemId,location,domain,write,createIncident,client,managed,delegate,owner};
}

test('offline bindings discovery does not initialize or start a personal store',async t=>{
  const parent=mkdtempSync(join(tmpdir(),'moment-offline-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));
  const root=join(parent,'absent');
  const result=await createManaged({root}).call('bindings.discover',{});
  assert.equal(result.ok,true);assert.equal(result.value.exposedOperations.length,15);assert.equal(existsSync(root),false);
});

test('explicit project/location/context selects central work without guessing the bridge directory',async t=>{
  const f=await fixture(t);
  const empty=await f.managed.call('workspace.attach',{});
  assert.deepEqual(empty.value,{kind:'needs_selection',reason:'no_context',candidates:[],more:false});
  const selected=await f.managed.call('workspace.attach',{projectId:f.projectId,location:f.location});
  assert.equal(selected.ok,true,JSON.stringify(selected));assert.equal(selected.value.kind,'attached');
  assert.equal(selected.value.attachment.contextId,f.contextId);assert.equal(selected.value.attachment.incidentId,undefined);
  const one=await f.createIncident(),two=await f.createIncident({purpose:'Another independent purpose'});
  const ambiguous=await f.managed.call('workspace.attach',{contextId:f.contextId});
  assert.equal(ambiguous.value.reason,'ambiguous_incident');assert.equal(ambiguous.value.candidates.length,2);
  const exact=await f.managed.call('workspace.attach',{contextId:f.contextId,incidentId:two.ref.id});
  assert.equal(exact.value.attachment.incidentId,two.ref.id);
  assert.equal(exact.value.attachment.principalId,f.owner.principalId);
  assert.equal((await f.managed.call('workspace.attach',{contextId:f.contextId,projectId:randomUUID()})).error.code,'NOT_FOUND');
  assert.equal((await f.managed.call('workspace.attach',{contextId:f.contextId,projectId:f.projectId,location:tmpdir()})).error.code,'INVALID_ARGUMENT');
  assert.equal(existsSync(join(f.location,'.moment')),false);
  assert.equal(one.ref.contextId,f.contextId);
});

test('incident listing filters current per-incident admission before pagination and historical reads',async t=>{
  const f=await fixture(t),hidden=await f.createIncident({purpose:'Invisible'}),visible=await f.createIncident({purpose:'Visible'});
  const d=await f.delegate([visible.ref.id]);
  const page=await d.client.call('incident.list',{contextId:f.contextId,limit:1});
  assert.equal(page.ok,true,JSON.stringify(page));assert.deepEqual(page.value.items.map(i=>i.ref.id),[visible.ref.id]);assert.equal(page.value.nextCursor,undefined);
  assert.equal((await d.client.call('incident.list',{contextId:f.contextId,limit:1,statuses:[]})).value.items.length,0);
  const selected=await d.managed.call('workspace.attach',{projectId:f.projectId});
  assert.equal(selected.value.attachment.incidentId,visible.ref.id);
  assert.equal(selected.value.attachment.principalId,d.principalId);
  assert.deepEqual(selected.value.attachment.grant,d.grant.ref);
  assert.equal((await d.managed.call('workspace.attach',{contextId:f.contextId,incidentId:hidden.ref.id})).error.code,'NOT_FOUND');
  const revision=(await f.domain('context.get',{contextId:f.contextId})).revision;
  await f.write('grant.revoke',{grant:d.grant.ref,reason:'Current authority changed'});
  assert.equal((await d.client.call('incident.list',{contextId:f.contextId,atRevision:revision,limit:10})).error.code,'FORBIDDEN');
  assert.equal((await d.managed.call('workspace.read',{target:selected.value.attachment})).error.code,'INVALID_ARGUMENT'); // authentication fields are not routing input
  assert.equal((await d.managed.call('workspace.read',{target:{systemId:f.systemId,contextId:f.contextId,incidentId:visible.ref.id}})).ok,false);
});

test('incident cursors retain their snapshot and refuse cross-selection or principal reuse',async t=>{
  const f=await fixture(t);await f.createIncident();await f.createIncident();
  const page=await f.domain('incident.list',{contextId:f.contextId,limit:1});assert.ok(page.nextCursor);
  await f.createIncident();
  const next=await f.domain('incident.list',{contextId:f.contextId,limit:1,cursor:page.nextCursor});
  assert.equal(next.snapshotRevision,page.snapshotRevision);assert.equal(next.nextCursor,undefined);
  assert.notEqual(next.items[0].ref.id,page.items[0].ref.id);
  assert.equal((await f.client.call('incident.list',{contextId:f.contextId,limit:1,cursor:page.nextCursor,statuses:['resting']})).error.code,'INVALID_ARGUMENT');
  const d=await f.delegate('all');
  assert.equal((await d.client.call('incident.list',{contextId:f.contextId,limit:1,cursor:page.nextCursor})).error.code,'INVALID_ARGUMENT');
});

test('context packets preserve exact stored digests, enforce byte bounds and refuse inaccessible explicit detail',async t=>{
  const f=await fixture(t),selected=await f.createIncident();
  const document={type:'string'},schema={name:'fixture.packet',version:'1',digest:digest(document)};await f.write('schema.publish',{schema,document});
  const id=randomUUID(),hiddenId=randomUUID();
  await f.write('graph.transact',{changes:[id,hiddenId].map(id=>({kind:'record.put',record:{kind:'atom',id,schema,value:id===hiddenId?'hidden detail':'Visible observation'}}))});
  const ref={systemId:f.systemId,contextId:f.contextId,id},target={systemId:f.systemId,contextId:f.contextId,incidentId:selected.ref.id};
  await f.write('incident.update',{incidentId:selected.ref.id,incident:{...selected.value,continuation:[ref]},evidence});
  const d=await f.delegate([selected.ref.id],[ref]);
  const result=await d.managed.call('workspace.read',{target,detailRefs:[ref]});
  assert.equal(result.ok,true,JSON.stringify(result));assert.ok(Buffer.byteLength(canonical(result.value))<=16384);
  assert.equal(result.value.records.length,1);const stored=result.value.records[0].record;
  assert.equal(stored.digest,digest(stored.value));assert.equal(stored.value.value,'Visible observation');
  assert.equal((await d.managed.call('workspace.read',{target,maximumBytes:1})).error.code,'LIMIT_EXCEEDED');
  const inaccessible={...ref,id:hiddenId};
  assert.equal((await d.managed.call('workspace.read',{target,detailRefs:[ref,inaccessible],limit:1})).error.code,'NOT_FOUND');
  assert.equal((await d.managed.call('workspace.read',{target:{...target,systemId:randomUUID()}})).error.code,'NOT_FOUND');
  assert.equal((await d.managed.call('workspace.read',{target,detailRefs:[{...ref,contextId:randomUUID()}]})).error.code,'NOT_FOUND');
  assert.equal((await d.managed.call('workspace.read',{target:{...target,projectId:randomUUID()}})).error.code,'NOT_FOUND');
  const missing=createManaged({root:f.root,credentialFile:join(f.root,'missing.json')});
  assert.equal((await missing.call('workspace.read',{target})).error.code,'UNAUTHENTICATED');
});

test('selected credential metadata cannot impersonate the authenticated owner or expand saved policy',async t=>{
  const f=await fixture(t),file=join(f.root,'claimed-principal.json');
  writeFileSync(file,JSON.stringify({...f.owner,principalId:randomUUID()}),{mode:0o600});
  const m=createManaged({root:f.root,credentialFile:file});
  const result=await m.call('workspace.attach',{contextId:f.contextId});assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.value.attachment.principalId,f.owner.principalId);
  const context=await f.domain('context.get',{contextId:f.contextId}),policy=await f.domain('control.get',{contextId:f.contextId,ref:context.policy});
  const narrowed=await f.write('policy.publish',{policy:{...policy.value,id:randomUUID(),parent:context.policy,rules:policy.value.rules.map(rule=>({...rule,actions:rule.actions.filter(action=>action!=='incident.list')}))}});
  await f.write('policy.activate',{policy:narrowed.ref,evidence});
  assert.equal((await m.call('workspace.attach',{contextId:f.contextId})).error.code,'FORBIDDEN');
});

test('attachment preserves registered worktree identity and requires a confirmed clone/move association',async t=>{
  const f=await fixture(t),git=args=>execFileSync('git',args,{stdio:'pipe'});
  git(['init','--initial-branch=main',f.location]);
  git(['-C',f.location,'-c','user.name=Moment test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-m','fixture']);
  git(['-C',f.location,'remote','add','origin','git@github.com:example/project.git']);
  const worktree=join(f.root,'worktree'),clone=join(f.root,'clone'),moved=join(f.root,'moved');
  git(['-C',f.location,'worktree','add','-b','fixture',worktree]);git(['clone',f.location,clone]);
  git(['-C',clone,'remote','set-url','origin','https://github.com/example/project.git']);
  const registry=JSON.parse(readFileSync(join(f.root,'registry.json')));registry.projects[0].origins=['git@github.com:example/project.git'];
  writeFileSync(join(f.root,'registry.json'),JSON.stringify(registry));
  assert.equal((await f.managed.call('workspace.attach',{location:worktree})).value.attachment.projectId,f.projectId);
  assert.equal((await f.managed.call('workspace.attach',{location:clone})).value.reason,'ambiguous_project');
  renameSync(clone,moved);
  assert.equal((await f.managed.call('workspace.attach',{location:moved})).value.reason,'ambiguous_project');
  registry.projects[0].locations.push({path:moved,kind:'git-worktree'});writeFileSync(join(f.root,'registry.json'),JSON.stringify(registry));
  assert.equal((await f.managed.call('workspace.attach',{location:moved})).value.attachment.projectId,f.projectId);
  assert.equal(existsSync(join(moved,'.moment')),false);
});

test('terminal incidents remain explicit, required hidden continuation refuses bytes, and expired grants never fall back',async t=>{
  const f=await fixture(t),selected=await f.createIncident();
  await f.write('incident.update',{incidentId:selected.ref.id,incident:{...selected.value,status:'cancelled'},evidence});
  const explicit=await f.managed.call('workspace.attach',{contextId:f.contextId,incidentId:selected.ref.id});
  assert.equal(explicit.value.attachment.incidentId,selected.ref.id);
  assert.equal((await f.managed.call('workspace.attach',{contextId:f.contextId})).value.attachment.incidentId,undefined);
  const d=await f.delegate('all',[],{expiresAt:new Date(Date.now()+100).toISOString()});
  await new Promise(resolve=>setTimeout(resolve,120));
  const expired=await d.managed.call('workspace.attach',{contextId:f.contextId});assert.equal(expired.error.code,'NOT_FOUND');
  const open=await f.createIncident(),hiddenRef={systemId:f.systemId,contextId:f.contextId,id:randomUUID()};
  await f.write('incident.update',{incidentId:open.ref.id,incident:{...open.value,continuation:[hiddenRef]},evidence});
  const other=await f.delegate([open.ref.id]);
  assert.equal((await other.managed.call('workspace.attach',{contextId:f.contextId,incidentId:open.ref.id})).error.code,'NOT_FOUND');
  assert.equal((await other.managed.call('workspace.read',{target:{systemId:f.systemId,contextId:f.contextId,incidentId:open.ref.id}})).error.code,'NOT_FOUND');
});
